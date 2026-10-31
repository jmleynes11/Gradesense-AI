const { mockNotificationWrites } = require("./helpers/notifications");
const { test, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const { studentAssessmentStatus } = require("../services/studentAssessmentStatus");
const Assessment = require("../models/Assessment");
const Subject = require("../models/Subject");
const Submission = require("../models/Submission");
const AssessmentSession = require("../models/AssessmentSession");
const Feedback = require("../models/Feedback");
const Notification = require("../models/Notification");
const studentController = require("../controllers/studentController");
const submissionController = require("../controllers/submissionController");

const studentId = "507f1f77bcf86cd799439011";
const assessmentId = "507f1f77bcf86cd799439012";
const subjectId = "507f1f77bcf86cd799439013";
const dueDate = new Date("2026-10-19T09:30:00+08:00");
const before = new Date(dueDate.getTime() - 1);
const after = new Date(dueDate.getTime() + 1);
const assessment = { _id: assessmentId, subjectRef: subjectId, title: "Quiz", status: "published", dueDate, attemptLimit: 1, questions: [] };
function query(value) {
  const result = { then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } };
  for (const method of ["select", "populate", "sort", "lean"]) result[method] = () => result;
  return result;
}
function response() {
  return { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}
function request(params = {}, query = {}) {
  return { user: { _id: studentId, role: "student" }, params, query, body: {} };
}
afterEach(() => { mock.restoreAll(); mock.timers.reset(); });

test("unsubmitted assessments become Missing only after the exact due timestamp", () => {
  for (const now of [before, dueDate]) {
    assert.deepEqual(studentAssessmentStatus(assessment, [], now), { studentStatus: "Not Started", attemptsUsed: 0, canSubmit: true });
  }
  assert.deepEqual(studentAssessmentStatus(assessment, [], after), { studentStatus: "Missing", attemptsUsed: 0, canSubmit: false });
});

test("submitted and graded work stays Completed regardless of deadline or teacher closure", () => {
  for (const status of ["submitted", "graded"]) {
    for (const now of [before, after]) {
      for (const teacherStatus of ["published", "closed"]) {
        assert.deepEqual(studentAssessmentStatus({ ...assessment, status: teacherStatus }, [{ status }], now), {
          studentStatus: "Completed", attemptsUsed: 1, canSubmit: false,
        });
      }
    }
  }
});

test("teacher closure is Closed before the deadline and Missing after it without submission", () => {
  const closed = { ...assessment, status: "closed" };
  assert.equal(studentAssessmentStatus(closed, [], before).studentStatus, "Closed");
  assert.equal(studentAssessmentStatus(closed, [], after).studentStatus, "Missing");
});

test("start and end access windows remain separate from the actual due date", () => {
  assert.equal(studentAssessmentStatus({ ...assessment, startDate: dueDate }, [], before).studentStatus, "Closed");
  assert.equal(studentAssessmentStatus({ ...assessment, endDate: before }, [], before).canSubmit, true);
  assert.deepEqual(studentAssessmentStatus({ ...assessment, endDate: before }, [], dueDate), {
    studentStatus: "Closed", attemptsUsed: 0, canSubmit: false,
  });
  // An existing later endDate still permits access, but cannot hide a missed dueDate.
  assert.deepEqual(studentAssessmentStatus({ ...assessment, endDate: new Date(after.getTime() + 60000) }, [], after), {
    studentStatus: "Missing", attemptsUsed: 0, canSubmit: true,
  });
  assert.equal(studentAssessmentStatus({ ...assessment, dueDate: null }, [], after).studentStatus, "Not Started");
});

test("pending records do not count as successfully submitted or hide Missing", () => {
  const pending = [{ status: "pending" }];
  assert.equal(studentAssessmentStatus(assessment, pending, before).studentStatus, "Closed");
  assert.equal(studentAssessmentStatus(assessment, pending, after).studentStatus, "Missing");
  assert.equal(studentAssessmentStatus(assessment, pending, after).attemptsUsed, 1);
});

test("summary and detail recalculate all four states from the signed-in student's records", async () => {
  mock.timers.enable({ apis: ["Date"], now: dueDate.getTime() });
  mock.method(Subject, "find", () => query([{ _id: subjectId }]));
  const records = [
    { ...assessment, _id: assessmentId, dueDate: before },
    { ...assessment, _id: "missed", dueDate: before },
    { ...assessment, _id: "upcoming", dueDate: after },
    { ...assessment, _id: "closed", status: "closed", dueDate: after },
  ];
  mock.method(Assessment, "find", (filter) => query(filter._id ? records.filter((item) => item._id === filter._id) : records));
  const findSubmissions = mock.method(Submission, "find", (filter) => {
    assert.equal(filter.student, studentId);
    return query([{ assessment: assessmentId, status: "submitted", submittedAt: before, aiGradingStatus: "pending_review" }]);
  });
  // Repeated calls model fresh reads after refresh, navigation, or a new session.
  for (let read = 0; read < 2; read += 1) {
    const res = response();
    await studentController.assignedAssessments(request({}, { view: "summary" }), res);
    assert.deepEqual(res.body.map((item) => item.studentStatus), ["Completed", "Missing", "Not Started", "Closed"]);
    assert.deepEqual(res.body.map((item) => item.attemptsUsed), [1, 0, 0, 0]);
    assert.deepEqual(res.body.map((item) => item.canSubmit), [false, false, true, false]);
  }
  const detail = response();
  await studentController.assignedAssessments(request({ id: assessmentId }), detail);
  assert.equal(detail.body.studentStatus, "Completed");
  assert.equal(detail.body.previousSubmission.status, "submitted");
  assert.equal(findSubmissions.mock.callCount(), 3);
});

test("assessment submission lookup isolates both the assessment and authenticated student across sessions", async () => {
  mock.method(Subject, "find", () => query([{ _id: subjectId }]));
  mock.method(Assessment, "find", () => query([assessment]));
  const secondStudent = "507f1f77bcf86cd799439015";
  const find = mock.method(Submission, "find", (filter) => {
    assert.deepEqual(filter, { student: filter.student, assessment: assessmentId });
    return query(filter.student === studentId ? [{ _id: "saved", assessment: assessmentId, status: "graded", finalScore: 0, finalPercentage: 0 }] : []);
  });
  for (const id of [studentId, secondStudent, studentId]) {
    const res = response();
    await studentController.assignedAssessments({ ...request({ id: assessmentId }), user: { _id: id, role: "student" } }, res);
    assert.equal(res.body.previousSubmission?._id || null, id === studentId ? "saved" : null);
    assert.equal(res.body.canSubmit, id === studentId ? false : studentAssessmentStatus(assessment, []).canSubmit);
  }
  assert.deepEqual(find.mock.calls.map((call) => call.arguments[0].student), [studentId, secondStudent, studentId]);
});

test("submission before deadline persists Completed and blocks a second submission", async () => {
  mock.method(AssessmentSession, "findOne", async () => ({ startedAt: before, expiresAt: after }));
  mock.timers.enable({ apis: ["Date"], now: before.getTime() });
  const question = { _id: "507f1f77bcf86cd799439014", type: "true_false", text: "Water is a liquid.", answerKey: "True", points: 1 };
  const item = { ...assessment, questions: [question], totalPoints: 1 };
  let saved = null;
  mock.method(Assessment, "findById", () => query(item));
  mock.method(Subject, "exists", async () => true);
  mock.method(Submission, "findOne", async () => saved);
  const create = mock.method(Submission, "create", async (data) => {
    saved = new Submission(data);
    return saved;
  });
  mock.method(Feedback, "findOneAndUpdate", async () => ({}));
  mockNotificationWrites(mock);
  const req = request({ assessmentId });
  req.body.answers = [{ question: question._id, answer: "True" }];
  const res = response();
  await submissionController.submitAssessment(req, res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.studentStatus, "Completed");
  assert.equal(res.body.attemptsUsed, 1);
  assert.equal(res.body.canSubmit, false);
  assert.equal(saved.status, "graded");
  assert.equal(saved.submittedAt.getTime(), before.getTime());
  const retry = response();
  await submissionController.submitAssessment(req, retry);
  assert.equal(retry.statusCode, 403);
  assert.equal(create.mock.callCount(), 1);
  mock.timers.setTime(after.getTime());
  assert.equal(studentAssessmentStatus(item, [saved]).studentStatus, "Completed");
});

test("server rejects unavailable submissions regardless of the student's supplied clock", async () => {
  mock.timers.enable({ apis: ["Date"], now: after.getTime() });
  let item = assessment;
  mock.method(Assessment, "findById", () => query(item));
  mock.method(Subject, "exists", async () => true);
  const create = mock.method(Submission, "create", async () => ({}));
  for (const override of [{}, { status: "closed" }, { dueDate: null, startDate: new Date(after.getTime() + 60000) }, { dueDate: null, endDate: before }]) {
    item = { ...assessment, ...override };
    const req = request({ assessmentId });
    req.body.startedAt = before.toISOString();
    const res = response();
    await submissionController.submitAssessment(req, res);
    assert.equal(res.statusCode, 400);
  }
  assert.equal(create.mock.callCount(), 0);
});

test("concurrent duplicate submissions remain rejected by the existing unique index", async () => {
  mock.method(AssessmentSession, "findOne", async () => ({ startedAt: before, expiresAt: after }));
  mock.timers.enable({ apis: ["Date"], now: before.getTime() });
  mock.method(Assessment, "findById", () => query(assessment));
  mock.method(Subject, "exists", async () => true);
  mock.method(Submission, "findOne", async () => null);
  mock.method(Submission, "create", async () => { throw Object.assign(new Error("duplicate"), { code: 11000 }); });
  const res = response();
  await submissionController.submitAssessment(request({ assessmentId }), res);
  assert.equal(res.statusCode, 403);
  assert.match(res.body.message, /already submitted/);
  assert.ok(Submission.schema.indexes().some(([keys, options]) => keys.assessment === 1 && keys.student === 1 && options.unique));
});
