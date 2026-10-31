const { test, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const Subject = require("../models/Subject");
const Assessment = require("../models/Assessment");
const Submission = require("../models/Submission");
const Feedback = require("../models/Feedback");
const { subjectDetails } = require("../controllers/subjectController");
const display = () => import("../../client/src/services/subjectGradeDisplay.js");

afterEach(() => mock.restoreAll());

test("subject grade scores and percentages use the submission's earned and possible points", async () => {
  const { subjectGradeDisplay } = await display();
  for (const [earned, total, score, percentage] of [[20, 40, "20/40", "50%"], [14, 28, "14/28", "50%"], [35, 50, "35/50", "70%"], [0, 40, "0/40", "0%"], [1, 3, "1/3", "33.33%"]]) {
    const row = subjectGradeDisplay({ status: "graded", score: earned, totalPossiblePoints: total, percentage: 99 });
    assert.equal(row.score, score);
    assert.equal(row.percentage, percentage);
  }
});

test("teacher final scores, including zero and historical decimals, take priority", async () => {
  const { subjectGradeDisplay } = await display();
  for (const [finalScore, score, percentage] of [[0, "0/40", "0%"], [14, "14/40", "35%"], [7.5, "7.5/40", "18.75%"]]) {
    const row = subjectGradeDisplay({ status: "graded", finalScore, score: 20, finalPercentage: 90, totalPossiblePoints: 40 });
    assert.equal(row.score, score);
    assert.equal(row.percentage, percentage);
  }
});

test("submission totals survive assessment edits and historical records use actual point fallbacks", async () => {
  const { subjectGradeDisplay } = await display();
  const row = { status: "graded", score: 20, totalPossiblePoints: 40, answers: [{ pointsPossible: 50 }] };
  assert.equal(subjectGradeDisplay(row, { totalPoints: 100 }).score, "20/40");
  assert.equal(subjectGradeDisplay({ ...row, totalPossiblePoints: 0, answers: [{ pointsPossible: 10 }, { pointsPossible: 30 }] }, { totalPoints: 100 }).score, "20/40");
  assert.equal(subjectGradeDisplay({ status: "graded", score: 20 }, { totalPoints: 40 }).score, "20/40");
  assert.equal(subjectGradeDisplay({ status: "graded", score: 20, answers: [{ pointsPossible: 10 }, {}] }, { totalPoints: 40 }).score, "20/40");
});

test("AI review failures and pending submissions never display default failing scores", async () => {
  const { subjectGradeDisplay } = await display();
  for (const submission of [
    { status: "submitted", aiGradingStatus: "pending_review", score: null },
    { status: "graded", aiGradingStatus: "pending_review", score: 0, finalScore: 0 },
  ]) {
    const row = subjectGradeDisplay({ ...submission, totalPossiblePoints: 40 });
    assert.equal(row.score, "Pending teacher review");
    assert.equal(row.percentage, "Pending teacher review");
  }
  const reviewed = subjectGradeDisplay({ status: "graded", aiGradingStatus: "pending_review", gradedBy: "teacher", finalScore: 0, totalPossiblePoints: 40 });
  assert.equal(reviewed.score, "0/40");
  assert.equal(reviewed.percentage, "0%");
});

test("unavailable scores or point totals stay unavailable rather than becoming zero", async () => {
  const { subjectGradeDisplay } = await display();
  for (const submission of [
    { score: null, finalScore: null, totalPossiblePoints: 40 },
    { score: 20 },
    { score: 20, totalPossiblePoints: 0 },
    { score: 20, totalPossiblePoints: NaN },
  ]) {
    const row = subjectGradeDisplay({ ...submission, status: "graded" });
    assert.equal(row.score, "—");
    assert.equal(row.percentage, "—");
  }
});

test("subject grade dates show actual submission time in local time and never substitute another date", async () => {
  const { subjectGradeDisplay } = await display();
  const submittedAt = new Date(2026, 9, 19, 14, 30).toISOString();
  assert.equal(subjectGradeDisplay({ submittedAt, createdAt: "2026-01-01", gradedAt: "2026-10-20", dueDate: "2026-11-01" }).date, "Oct 19, 2026, 2:30 PM");
  for (const timestamp of [null, undefined, "", "invalid"]) {
    assert.equal(subjectGradeDisplay({ submittedAt: timestamp, createdAt: "2026-01-01", gradedAt: "2026-10-20" }).date, "—");
  }
});

test("subject details retrieves this student's grade snapshots and timestamps on every read", async () => {
  const { subjectGradeDisplay } = await display();
  const studentId = "507f1f77bcf86cd799439011";
  const subjectId = "507f1f77bcf86cd799439012";
  const assessmentId = "507f1f77bcf86cd799439013";
  const submittedAt = new Date(2026, 9, 19, 14, 30);
  const student = { _id: studentId, name: "Student", toObject() { return { _id: this._id, name: this.name }; } };
  function query(value) {
    const calls = [];
    const result = { calls, then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } };
    for (const method of ["select", "populate", "sort", "lean"]) result[method] = (...args) => { calls.push([method, ...args]); return result; };
    return result;
  }
  let subjectReads = 0;
  mock.method(Subject, "findById", () => query(++subjectReads % 2 ? { _id: subjectId, students: [studentId] } : { _id: subjectId, students: [student] }));
  const assessment = { _id: assessmentId, title: "Quiz", totalPoints: 100 };
  mock.method(Assessment, "find", () => query([assessment]));
  mock.method(Feedback, "find", () => query([]));
  let record = { assessment: assessmentId, student: studentId, status: "submitted", score: null, totalPossiblePoints: 40, submittedAt, aiGradingStatus: "pending_review" };
  const submissionQueries = [];
  mock.method(Submission, "find", (filter) => {
    assert.deepEqual(filter, { assessment: { $in: [assessmentId] }, student: studentId });
    const q = query([record]);
    submissionQueries.push(q);
    return q;
  });
  for (const [status, earned, expectedScore, expectedPercentage] of [
    ["submitted", null, "Pending teacher review", "Pending teacher review"],
    ["graded", 20, "20/40", "50%"],
    ["graded", 0, "0/40", "0%"],
  ]) {
    record = { ...record, status, score: earned, finalScore: earned, aiGradingStatus: status === "graded" ? "completed" : "pending_review" };
    const res = { status() { return this; }, json(body) { this.body = body; } };
    await subjectDetails({ params: { id: subjectId }, user: { role: "student", _id: studentId } }, res);
    const row = res.body.submissions[0];
    assert.equal(row.submittedAt, submittedAt);
    assert.equal(row.status, status);
    const result = subjectGradeDisplay(row, res.body.assessments[0]);
    assert.equal(result.score, expectedScore);
    assert.equal(result.percentage, expectedPercentage);
    assert.equal(result.date, "Oct 19, 2026, 2:30 PM");
  }
  for (const q of submissionQueries) {
    const fields = q.calls.find(([method]) => method === "select")[1].split(" ");
    for (const field of ["score", "finalScore", "totalPossiblePoints", "answers.pointsPossible", "submittedAt", "percentage", "finalPercentage", "status", "aiGradingStatus", "gradedBy"]) assert.ok(fields.includes(field), field);
    assert.equal(fields.includes("answers"), false);
    assert.equal(fields.includes("answers.answer"), false);
  }
});
