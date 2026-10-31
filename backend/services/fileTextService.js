const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");

function stripXml(value = "") {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function extractText(file) {
  if (!file) return "";
  const ext = path.extname(file.originalname).toLowerCase();
  const buffer = fs.readFileSync(file.path);

  if (ext === ".txt") return buffer.toString("utf8");

  if (ext === ".pdf") {
    const { PDFParse } = require("pdf-parse");
    const parser = new PDFParse({ data: buffer });
    const data = await parser.getText();

    let text = data.text || "";

    text = text
      .replace(/Page\s+\d+/gi, "")
      .replace(/\n+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const MAX_CHARS = 25000;

    return text.slice(0, MAX_CHARS);
  }

  if (ext === ".docx") {
    const mammoth = require("mammoth");
    const data = await mammoth.extractRawText({ buffer });
    return data.value;
  }

  if (ext === ".pptx") {
    const zip = new AdmZip(buffer);
    return zip
      .getEntries()
      .filter(
        (entry) =>
          entry.entryName.startsWith("ppt/slides/slide") &&
          entry.entryName.endsWith(".xml"),
      )
      .map((entry) => stripXml(entry.getData().toString("utf8")))
      .join("\n");
  }

  return buffer.toString("utf8");
}

module.exports = { extractText };
