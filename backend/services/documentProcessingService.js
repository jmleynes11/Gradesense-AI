const fs = require("fs/promises");
const path = require("path");
const AdmZip = require("adm-zip");

const SUPPORTED_EXTENSIONS = new Set([".pdf", ".docx", ".pptx", ".txt"]);
const MAX_EXTRACTED_CHARS = 25000;
const MIN_CONTENT_CHARS = 80;

function createHttpError(message, status = 400, details = {}) {
  const error = new Error(message);
  error.status = status;
  Object.assign(error, details);
  return error;
}

function stripXml(value = "") {
  return value
    .replace(/<\/a:p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, entity) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" })[entity])
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, entity) => {
      const code = entity[0].toLowerCase() === "x" ? parseInt(entity.slice(1), 16) : Number(entity);
      return code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : "\uFFFD";
    })
    .replace(/[^\S\n]+/g, " ")
    .trim();
}

function normalizeLines(text = "") {
  return String(text)
    .replace(/\u0000/g, " ")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function removeBoilerplate(lines) {
  const counts = new Map();
  lines.forEach((line) => counts.set(line.toLowerCase(), (counts.get(line.toLowerCase()) || 0) + 1));

  return lines
    .filter((line) => !/^(?:--\s*)?(?:page\s*)?\d+(?:\s+of\s+\d+)?(?:\s*--)?$/i.test(line))
    .filter((line) => !/^[-_\s\d]+$/.test(line))
    .filter((line) => {
      const repeated = counts.get(line.toLowerCase()) >= 3;
      const likelyHeaderFooter = line.length <= 80;
      return !(repeated && likelyHeaderFooter);
    })
    .filter((line, index, list) => line.toLowerCase() !== list[index - 1]?.toLowerCase());
}

function cleanExtractedText(text = "") {
  const cleaned = removeBoilerplate(normalizeLines(text))
    .join("\n")
    .replace(/\bPage\s+\d+\b/gi, " ")
    .replace(/[^\S\n]+/g, " ")
    .trim();

  if (cleaned.length > MAX_EXTRACTED_CHARS) {
    throw createHttpError("Lesson text exceeds the supported size. Split the lesson into smaller sections before generating a quiz.", 413, { code: "DOCUMENT_TOO_LARGE", maxCharacters: MAX_EXTRACTED_CHARS });
  }
  return cleaned;
}

function validateProcessedText(text, sourceType) {
  if (!text || text.length < MIN_CONTENT_CHARS) {
    throw createHttpError(
      `The uploaded ${sourceType} does not contain enough readable lesson text.`,
      422,
      { code: "DOCUMENT_EMPTY_OR_CORRUPT" },
    );
  }

  const alphaCount = (text.match(/\p{L}/gu) || []).length;
  const invalidCount = (text.match(/[\uFFFD\u0000-\u0008\u000B\u000C\u000E-\u001F]/g) || []).length;
  if (alphaCount / Math.max(text.length, 1) < 0.35 || invalidCount / Math.max(text.length, 1) > 0.01) {
    throw createHttpError(
      `The uploaded ${sourceType} appears corrupted or unsupported.`,
      422,
      { code: "DOCUMENT_UNREADABLE" },
    );
  }
}

async function extractPdf(buffer) {
  const { PDFParse } = require("pdf-parse");
  const parser = new PDFParse({ data: buffer });
  try {
    const data = await parser.getText();
    return data.text || "";
  } finally {
    await parser.destroy();
  }
}

async function extractDocx(buffer) {
  const mammoth = require("mammoth");
  const data = await mammoth.extractRawText({ buffer });
  return data.value || "";
}

function extractPptx(buffer) {
  const zip = new AdmZip(buffer);
  return zip
    .getEntries()
    .filter(
      (entry) =>
        entry.entryName.startsWith("ppt/slides/slide") &&
        entry.entryName.endsWith(".xml"),
    )
    .sort((a, b) => Number(a.entryName.match(/slide(\d+)\.xml$/)?.[1] || 0) - Number(b.entryName.match(/slide(\d+)\.xml$/)?.[1] || 0))
    .map((entry) => stripXml(entry.getData().toString("utf8")))
    .join("\n");
}

async function processUploadedDocument(file) {
  if (!file) return { text: "", metadata: null };

  const ext = path.extname(file.originalname).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    throw createHttpError("Unsupported lesson file type.", 415, {
      code: "UNSUPPORTED_DOCUMENT_TYPE",
    });
  }

  let extracted = "";

  try {
    const buffer = await fs.readFile(file.path);
    if (ext === ".pdf") extracted = await extractPdf(buffer);
    if (ext === ".docx") extracted = await extractDocx(buffer);
    if (ext === ".pptx") extracted = extractPptx(buffer);
    if (ext === ".txt") {
      if (buffer.includes(0)) throw createHttpError("The TXT file contains binary data instead of readable lesson text.", 422, { code: "DOCUMENT_UNREADABLE" });
      extracted = buffer.toString("utf8");
    }
  } catch (error) {
    if (error.status) throw error;
    const failure = createHttpError("The uploaded document could not be read. Use a text-based PDF, DOCX, PPTX, or UTF-8 TXT document. Scanned PDFs require text extraction before upload.", 422, { code: "DOCUMENT_EXTRACTION_FAILED" });
    failure.cause = error;
    throw failure;
  }

  const text = cleanExtractedText(extracted);
  validateProcessedText(text, ext.slice(1).toUpperCase());

  return {
    text,
    metadata: {
      originalName: file.originalname,
      extension: ext,
      extractedChars: extracted.length,
      cleanedChars: text.length,
      truncated: false,
    },
  };
}

function processPlainLessonText(content = "") {
  const text = cleanExtractedText(content);
  validateProcessedText(text, "text input");
  return {
    text,
    metadata: {
      source: "text",
      extractedChars: String(content).length,
      cleanedChars: text.length,
      truncated: false,
    },
  };
}

module.exports = {
  cleanExtractedText,
  processPlainLessonText,
  processUploadedDocument,
};
