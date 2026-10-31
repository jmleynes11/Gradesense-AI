const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const AdmZip = require("adm-zip");
const { processPlainLessonText, processUploadedDocument } = require("../services/documentProcessingService");
const { analyzeLesson, compactLessonForAi } = require("../services/lessonAnalysisService");

const lines = [
  "Solar panels convert sunlight into electrical energy",
  "Wind turbines convert moving air into electrical energy",
  "Hydro turbines convert moving water into electrical energy",
];
const lesson = lines.join("\n");

async function withFile(buffer, extension, inspect) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "gradesense-document-test-"));
  const filePath = path.join(directory, `lesson${extension}`);
  try {
    await fs.writeFile(filePath, buffer);
    return await inspect({ originalname: `lesson${extension}`, path: filePath });
  } finally {
    // Remove the two exact paths created by this test; no recursive operations.
    await fs.unlink(filePath).catch(() => {});
    await fs.rmdir(directory);
  }
}

test("bullet/line-based lessons retain boundaries and complete readable model text", () => {
  const processed = processPlainLessonText(lesson);
  assert.equal(processed.text, lesson);
  const analysis = analyzeLesson(processed.text);
  assert.equal(analysis.sourceSentences.length, 3);
  const payload = compactLessonForAi(analysis, processed.text);
  assert.equal(payload.lessonText, lines.join(" "));
  assert.equal(processed.metadata.truncated, false);
});

test("longer lessons retain facts beyond the original twelve selected concepts", () => {
  const source = Array.from({ length: 20 }, (_, index) => `Chapter ${index} explains the distinct renewable energy concept number ${index}.`).join(" ");
  const payload = compactLessonForAi(analyzeLesson(source));
  assert.equal(payload.lessonText, source);
  assert.match(payload.lessonText, /Chapter 19/);
});

test("oversized documents are rejected instead of silently truncated", () => {
  assert.throws(() => processPlainLessonText("Readable lesson sentence about renewable energy. ".repeat(600)), { status: 413, code: "DOCUMENT_TOO_LARGE" });
});

test("empty and unreadable content have controlled document errors", () => {
  assert.throws(() => processPlainLessonText(""), { status: 422, code: "DOCUMENT_EMPTY_OR_CORRUPT" });
  assert.throws(() => processPlainLessonText("12345 $%^&* ".repeat(20)), { status: 422, code: "DOCUMENT_UNREADABLE" });
  assert.throws(() => processPlainLessonText("\uFFFD".repeat(80) + lesson), { status: 422, code: "DOCUMENT_UNREADABLE" });
});

test("valid Unicode lesson text is not rejected by an ASCII-only readability check", () => {
  const source = "Ang enerhiya ay mahalaga sa ating pang-araw-araw na buhay. Ang araw at hangin ay pinagkukunan ng nababagong enerhiya. ".repeat(2);
  assert.equal(processPlainLessonText(source).metadata.truncated, false);
  const unicode = "这是一个关于可再生能源的完整教学材料。太阳和风可以用来产生清洁的电力。".repeat(4);
  assert.ok(processPlainLessonText(unicode).text.length > 80);
});

test("UTF-8 TXT is extracted once as text, and binary disguised as TXT is rejected", async () => {
  await withFile(Buffer.from(lesson), ".txt", async (file) => {
    const result = await processUploadedDocument(file);
    assert.equal(result.text, lesson);
    assert.equal(result.metadata.extension, ".txt");
  });
  await withFile(Buffer.from(lesson + "\0binary"), ".txt", (file) => assert.rejects(processUploadedDocument(file), { status: 422, code: "DOCUMENT_UNREADABLE" }));
});

test("PPTX ZIP/XML is decoded to plain lesson text in slide-number order", async () => {
  const zip = new AdmZip();
  zip.addFile("ppt/slides/slide10.xml", Buffer.from(`<p:sld><a:t>${lines[2]}</a:t></p:sld>`));
  zip.addFile("ppt/slides/slide2.xml", Buffer.from(`<p:sld><a:t>${lines[1]}</a:t></p:sld>`));
  zip.addFile("ppt/slides/slide1.xml", Buffer.from(`<p:sld><a:t>${lines[0]}</a:t></p:sld>`));
  await withFile(zip.toBuffer(), ".pptx", async (file) => {
    const result = await processUploadedDocument(file);
    assert.equal(result.text, lesson);
    assert.equal(compactLessonForAi(analyzeLesson(result.text)).lessonText, lines.join(" "));
  });
});

test("DOCX compressed document is decoded into readable lesson paragraphs", async () => {
  const zip = new AdmZip();
  zip.addFile("[Content_Types].xml", Buffer.from('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'));
  zip.addFile("_rels/.rels", Buffer.from('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'));
  zip.addFile("word/document.xml", Buffer.from(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${lines.map((line) => `<w:p><w:r><w:t>${line}</w:t></w:r></w:p>`).join("")}</w:body></w:document>`));
  await withFile(zip.toBuffer(), ".docx", async (file) => {
    const result = await processUploadedDocument(file);
    assert.equal(result.text, lesson);
  });
});

test("one-slide PPTX paragraphs and encoded XML characters remain readable", async () => {
  const zip = new AdmZip();
  zip.addFile("ppt/slides/slide1.xml", Buffer.from('<p:sld><a:p><a:t>Solar panels convert sunlight into electrical energy</a:t></a:p><a:p><a:t>Wind &amp; hydro energy use turbines to produce electricity</a:t></a:p><a:p><a:t>Earth&#8217;s heat supplies geothermal energy for electrical generation</a:t></a:p></p:sld>'));
  await withFile(zip.toBuffer(), ".pptx", async (file) => {
    const result = await processUploadedDocument(file);
    assert.match(result.text, /Wind & hydro/);
    assert.match(result.text, /Earth’s heat/);
    assert.equal(analyzeLesson(result.text).sourceSentences.length, 3);
  });
});

test("text-based PDF is extracted and the parser resources are released", async () => {
  const PDFDocument = require("pdfkit");
  const document = new PDFDocument();
  const chunks = [];
  const buffer = new Promise((resolve, reject) => {
    document.on("data", (chunk) => chunks.push(chunk));
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
  });
  document.text(lesson);
  document.end();
  await withFile(await buffer, ".pdf", async (file) => {
    const result = await processUploadedDocument(file);
    for (const line of lines) assert.ok(result.text.includes(line));
  });
});

test("corrupt PDF and DOCX have controlled extraction errors before AI requests", async () => {
  for (const extension of [".pdf", ".docx"]) {
    await withFile(Buffer.from("This is not a valid document."), extension, (file) => assert.rejects(processUploadedDocument(file), { status: 422, code: "DOCUMENT_EXTRACTION_FAILED" }));
  }
});
