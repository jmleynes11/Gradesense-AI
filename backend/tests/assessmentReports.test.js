const { test, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const ExcelJS = require("exceljs");
const { PDFParse } = require("pdf-parse");
const Assessment = require("../models/Assessment");
const Submission = require("../models/Submission");
const Report = require("../models/Report");
const { assessmentReportData } = require("../services/assessmentReportData");
const { buildPdfReport, buildExcelReport } = require("../services/reportService");
const controller = require("../controllers/reportController");

const assessmentId = "507f1f77bcf86cd799439012";
const teacherId = "507f1f77bcf86cd799439011";
const amy = { _id: "amy", name: "Amy M. Brown", firstName: "Amy", lastName: "Brown", studentNumber: "0001" };
const ben = { _id: "ben", name: "Ben de la Cruz", firstName: "Ben", lastName: "de la Cruz", studentNumber: "0002" };
const chen = { _id: "chen", name: "Chen Santos", studentNumber: "0003" };
const dia = { _id: "dia", name: "Día Reyes", studentNumber: "0004" };
const assessment = { _id: assessmentId, title: "Unit 1 Assessment", subject: "Science", subjectRef: { students: [amy, ben, chen, dia] }, totalPoints: 40 };
const submittedAt = new Date("2026-10-25T16:30:45Z");
const records = [
  { assessment: assessmentId, student: "amy", status: "graded", finalScore: 0, score: 30, finalPercentage: 0, percentage: 75, totalPossiblePoints: 40, submittedAt },
  { assessment: assessmentId, student: "ben", status: "submitted", aiGradingStatus: "processing", score: 0, percentage: 0, totalPossiblePoints: 40, submittedAt },
  { assessment: assessmentId, student: "chen", status: "pending", score: 0, percentage: 0, createdAt: submittedAt },
  { assessment: "other-assessment", student: "dia", status: "graded", finalScore: 40, finalPercentage: 100, totalPossiblePoints: 40, submittedAt },
  { assessment: assessmentId, student: "unassigned", status: "graded", finalScore: 40, finalPercentage: 100, submittedAt },
  { assessment: assessmentId, student: "amy", status: "graded", score: 30, percentage: 75, submittedAt },
];
const generated = [];
function query(value) {
  const result = { then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } };
  for (const method of ["select", "populate", "sort", "lean"]) result[method] = () => result;
  return result;
}
afterEach(async () => {
  mock.restoreAll();
  await Promise.all(generated.splice(0).map((file) => fs.unlink(file)));
});

test("assessment reports include each eligible student once and exclude other assessments and unassigned students", async () => {
  const data = assessmentReportData(assessment, records);
  assert.deepEqual(data.summary, { totalStudents: 4, submitted: 2, notSubmitted: 2, averageScore: 0 });
  assert.deepEqual(data.rows.map((row) => row.student), ["Brown, Amy M.", "de la Cruz, Ben", "Reyes, Día", "Santos, Chen"]);
  assert.equal(data.rows[0].scoreText, "0/40");
  assert.equal(data.rows[0].percentageText, "0%");
  assert.equal(data.rows[1].scoreText, "Pending essay grading");
  for (const row of data.rows.slice(2)) {
    assert.equal(row.status, "Not Submitted");
    assert.equal(row.submittedAt, null);
    assert.equal(row.scoreText, "Not submitted");
    assert.equal(row.percentageText, "Not submitted");
  }
  const { assessmentStudentName } = await import("../../client/src/services/assessmentStudentName.js");
  const { displayScore, displayPercentage } = await import("../../client/src/services/gradeDisplay.js");
  for (const [index, student] of [amy, ben].entries()) {
    assert.equal(data.rows[index].student, assessmentStudentName(student));
    assert.equal(data.rows[index].scoreText, displayScore(records[index]));
    assert.equal(data.rows[index].percentageText, displayPercentage(records[index]));
  }
});

test("report summaries refresh from new submission and roster records and preserve unavailable grades", () => {
  const empty = assessmentReportData({ ...assessment, subjectRef: { students: [] } }, records);
  assert.deepEqual(empty.summary, { totalStudents: 0, submitted: 0, notSubmitted: 0, averageScore: null });
  const fresh = assessmentReportData(assessment, [
    { ...records[0], finalScore: 10, finalPercentage: 25 },
    { ...records[1], status: "graded", aiGradingStatus: "completed", finalScore: 30, finalPercentage: 75 },
  ]);
  assert.equal(fresh.summary.averageScore, 50);
  const changed = assessmentReportData({ ...assessment, subjectRef: { students: [ben] } }, records);
  assert.deepEqual(changed.summary, { totalStudents: 1, submitted: 1, notSubmitted: 0, averageScore: null });
  const unavailable = assessmentReportData(assessment, [{ assessment: assessmentId, student: "amy", status: "graded" }]);
  assert.equal(unavailable.rows[0].scoreText, "Score unavailable");
  assert.equal(unavailable.rows[0].percentageText, "Percentage unavailable");
  assert.equal(unavailable.summary.averageScore, null);
});

test("both download endpoints require a valid assessment and scope database reads to its owner", async () => {
  const findAssessment = mock.method(Assessment, "findOne", () => query(assessment));
  const findSubmissions = mock.method(Submission, "find", () => query(records));
  const create = mock.method(Report, "create", async (item) => item);
  for (const [handler, type] of [[controller.pdfReport, "pdf"], [controller.excelReport, "excel"]]) {
    const req = { user: { _id: teacherId }, query: { assessmentId, timeZone: "Asia/Manila" } };
    const res = { download(filePath, fileName) { this.filePath = filePath; this.fileName = fileName; generated.push(filePath); } };
    await handler(req, res);
    assert.deepEqual(findAssessment.mock.calls.at(-1).arguments[0], { _id: assessmentId, teacher: teacherId });
    assert.deepEqual(findSubmissions.mock.calls.at(-1).arguments[0], { assessment: assessmentId });
    assert.equal(create.mock.calls.at(-1).arguments[0].type, type);
    assert.equal(create.mock.calls.at(-1).arguments[0].teacher, teacherId);
    assert.ok((await fs.stat(res.filePath)).size > 1000, "Download begins only after the file has finished writing");
  }
});

test("missing, malformed and foreign assessment IDs cannot produce an unscoped report", async () => {
  const findAssessment = mock.method(Assessment, "findOne", () => query(null));
  const findSubmissions = mock.method(Submission, "find", () => { throw new Error("Must not read submissions"); });
  const create = mock.method(Report, "create", () => { throw new Error("Must not create a report"); });
  for (const handler of [controller.pdfReport, controller.excelReport]) {
    for (const value of [undefined, "", "bad-id", [assessmentId]]) {
      await assert.rejects(handler({ user: { _id: teacherId }, query: { assessmentId: value } }, {}), { status: 400 });
    }
    await assert.rejects(handler({ user: { _id: teacherId }, query: { assessmentId } }, {}), { status: 404 });
    await assert.rejects(handler({ user: { _id: teacherId }, query: { assessmentId, timeZone: "Invalid/Zone" } }, {}), { status: 400 });
  }
  assert.equal(findAssessment.mock.callCount(), 2);
  assert.equal(findSubmissions.mock.callCount(), 0);
  assert.equal(create.mock.callCount(), 0);
});

test("Excel download retains both sheets, roster, text identifiers, numeric grades and local typed dates", async () => {
  const data = assessmentReportData(assessment, records);
  const file = await buildExcelReport(data); generated.push(file.filePath);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file.filePath);
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ["Assessment Summary", "Student Submissions"]);
  const summary = workbook.getWorksheet("Assessment Summary");
  assert.equal(summary.getCell("B4").value, assessment.title);
  assert.equal(summary.getCell("B5").value, assessment.subject);
  assert.deepEqual([6, 7, 8, 9].map((row) => summary.getCell(`B${row}`).value), [4, 2, 2, 0]);
  const sheet = workbook.getWorksheet("Student Submissions");
  assert.equal(sheet.rowCount, 5);
  assert.equal(sheet.getCell("B2").value, "0001");
  assert.equal(sheet.getCell("G2").value, 0);
  assert.match(sheet.getCell("G2").numFmt, /\/40/);
  assert.equal(sheet.getCell("H2").value, 0);
  assert.match(sheet.getCell("H2").numFmt, /%/);
  assert.ok(sheet.getCell("E2").value instanceof Date);
  assert.equal(sheet.getCell("E2").value.toISOString(), "2026-10-26T00:30:45.000Z");
  assert.equal(sheet.getCell("G3").value, "Pending essay grading");
  assert.deepEqual(["E4", "F4", "G4", "H4"].map((cell) => sheet.getCell(cell).value), ["Not recorded", "Not Submitted", "Not submitted", "Not submitted"]);
  assert.equal(sheet.views[0].ySplit, 1);
  assert.ok(sheet.autoFilter);
});

test("multipage PDF repeats headings and includes every student without clipping table text", async () => {
  const students = Array.from({ length: 80 }, (_, index) => ({ _id: `s${index}`, firstName: `Given${index}`, lastName: `Surname${index}`, studentNumber: `2026-${String(index).padStart(4, "0")}` }));
  const data = assessmentReportData({ ...assessment, subjectRef: { students } }, []);
  const file = await buildPdfReport(data); generated.push(file.filePath);
  const parser = new PDFParse({ data: await fs.readFile(file.filePath) });
  try {
    const pdf = await parser.getText();
    assert.ok(pdf.total >= 3);
    for (const student of students) {
      assert.ok(pdf.text.includes(`${student.lastName}, ${student.firstName}`), `Missing ${student._id}`);
      assert.ok(pdf.text.includes(student.studentNumber));
    }
    for (const page of pdf.pages) {
      assert.ok(page.text.includes(assessment.title));
      assert.ok(page.text.includes("Student Name"));
      assert.match(page.text, /Page \d+ of \d+/);
    }
    assert.ok(pdf.text.includes("Not recorded"));
    assert.ok(pdf.text.indexOf("Total students") < pdf.text.indexOf("Student Name"));
  } finally { await parser.destroy(); }
});
