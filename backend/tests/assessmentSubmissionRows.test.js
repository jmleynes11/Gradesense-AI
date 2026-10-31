const { test, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const { assessmentSubmissionRows } = require("../services/assessmentSubmissionRows");
const Assessment = require("../models/Assessment");
const Submission = require("../models/Submission");
const controller = require("../controllers/submissionController");

const teacher = "507f1f77bcf86cd799439011";
const assessmentId = "507f1f77bcf86cd799439012";
const anna = { _id: "anna", name: "Anna Zulu", firstName: "Anna", lastName: "Zulu", studentNumber: "001" };
const zoe = { _id: "zoe", name: "Zoe Adams", firstName: "Zoe", lastName: "Adams", studentNumber: "002" };
const amy = { _id: "amy", name: "Amy Adams", firstName: "Amy", lastName: "Adams", studentNumber: "003" };
const assessment = { _id: assessmentId, teacher, title: "Quiz", subject: "Science", totalPoints: 10,
  subjectRef: { _id: "science", name: "Science", students: [anna, zoe, amy] } };
function query(value) {
  const calls = [];
  const result = { calls, then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } };
  for (const method of ["select", "populate", "sort", "lean"]) result[method] = (...args) => { calls.push([method, ...args]); return result; };
  return result;
}
afterEach(() => mock.restoreAll());

test("combines enrolled students and recorded submissions, sorted by last then first name", () => {
  const graded = { _id: "graded", assessment, student: anna, status: "graded", score: 0, finalScore: 0,
    percentage: 0, finalPercentage: 0, totalPossiblePoints: 10, submittedAt: "2026-10-21T12:00:00Z" };
  const pending = { _id: "pending", assessment, student: amy, status: "submitted", aiGradingStatus: "processing", score: null };
  const submissions = [graded, pending];
  const rows = assessmentSubmissionRows(submissions, [assessment]);
  assert.deepEqual(rows.map((row) => row.student._id), ["amy", "zoe", "anna"]);
  assert.strictEqual(rows[0], pending);
  assert.strictEqual(rows[2], graded);
  assert.equal(rows[1].status, "not_submitted");
  assert.equal(rows[1].submittedAt, null);
  assert.equal(rows[1].score, null);
  assert.equal(rows[1].percentage, null);
  assert.equal(rows[1].student.studentNumber, "002");
  assert.equal(rows[1].assessment.title, "Quiz");
  assert.equal(rows[1].assessment.subject, "Science");
  assert.equal(submissions.length, 2);
  assert.equal(assessment.subjectRef.students.length, 3);
});

test("preserves records outside the current roster and does not duplicate students with pending records", () => {
  const former = { _id: "former", name: "Former Brown" };
  const records = [
    { _id: "old", assessment, student: former, status: "graded", finalScore: 8 },
    { _id: "pending", assessment, student: anna, status: "pending" },
  ];
  const rows = assessmentSubmissionRows(records, [assessment]);
  assert.equal(rows.length, 4);
  assert.strictEqual(rows.find((row) => row._id === "old"), records[0]);
  assert.deepEqual(rows.filter((row) => row.student._id === "anna"), [records[1]]);
});

test("uses explicit compound surnames and supports legacy full names and surname-first names", () => {
  const students = [
    { _id: "z", name: "Aaron Zulu" },
    { _id: "d", name: "Zoe de la Cruz", firstName: "Zoe", lastName: "de la Cruz" },
    { _id: "b", name: "Brown, Amy" },
    { _id: "a", name: "Zoe Adams" },
    { _id: "single", name: "Chen" },
  ];
  const rows = assessmentSubmissionRows([], [{ ...assessment, subjectRef: { students } }]);
  assert.deepEqual(rows.map((row) => row.student._id), ["a", "b", "single", "d", "z"]);
});

test("keeps one enrollment row per assessment in the all-submissions view", () => {
  const other = { ...assessment, _id: "other", title: "Exam" };
  const rows = assessmentSubmissionRows([], [assessment, other]);
  assert.equal(rows.length, 6);
  assert.equal(new Set(rows.map((row) => row._id)).size, 6);
  assert.equal(rows.filter((row) => row.student._id === "amy").length, 2);
  assert.deepEqual(assessmentSubmissionRows([], [{ ...assessment, subjectRef: null }]), []);
});

test("teacher list loads roster names and keeps both filtered and all-assessment results ownership restricted", async () => {
  const owned = query([assessment]);
  const findAssessments = mock.method(Assessment, "find", () => owned);
  const graded = { _id: "graded", assessment, student: anna, status: "graded", score: 7 };
  const items = query([graded, { _id: "foreign", assessment: { _id: "foreign", teacher: "another" }, student: zoe }]);
  const findSubmissions = mock.method(Submission, "find", () => items);
  for (const params of [{}, { assessmentId }]) {
    const response = { json(body) { this.body = body; } };
    await controller.listSubmissions({ user: { _id: teacher, role: "teacher" }, query: params }, response);
    assert.deepEqual(response.body.map((row) => row.student._id), ["amy", "zoe", "anna"]);
    assert.strictEqual(response.body[2], graded);
    assert.equal(response.body.filter((row) => row.status === "not_submitted").length, 2);
  }
  assert.deepEqual(findAssessments.mock.calls.map((call) => call.arguments[0]), [{ teacher }, { teacher, _id: assessmentId }]);
  assert.deepEqual(findSubmissions.mock.calls[0].arguments[0], { assessment: { $in: [assessmentId] } });
  assert.match(owned.calls.find(([method]) => method === "populate")[1].populate.select, /firstName lastName/);
  assert.match(items.calls.find(([method]) => method === "populate")[2], /firstName lastName/);
});

test("student submission reads never include synthetic rows or other students' records", async () => {
  const findAssessments = mock.method(Assessment, "find", () => { throw new Error("Student must not read rosters"); });
  const records = [{ _id: "saved", student: anna, assessment, status: "graded" }];
  const find = mock.method(Submission, "find", () => query(records));
  const response = { json(body) { this.body = body; } };
  await controller.listSubmissions({ user: { _id: "anna", role: "student" }, query: {} }, response);
  assert.deepEqual(find.mock.calls[0].arguments[0], { student: "anna" });
  assert.deepEqual(response.body, records);
  assert.equal(findAssessments.mock.callCount(), 0);
});
