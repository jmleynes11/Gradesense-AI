const { test, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const Assessment = require("../models/Assessment");
const Subject = require("../models/Subject");
const Submission = require("../models/Submission");
const AssessmentSession = require("../models/AssessmentSession");
const controller = require("../controllers/studentController");
const submissionController = require("../controllers/submissionController");
const { assessmentStartAccess } = require("../services/assessmentStartAccess");

const student = "507f1f77bcf86cd799439011";
const assessmentId = "507f1f77bcf86cd799439012";
const subject = "507f1f77bcf86cd799439013";
const now = new Date("2026-11-01T10:00:00Z");
const assessment = { _id: assessmentId, title: "Exam", assessmentType: "exam", subjectRef: subject,
  status: "published", durationMinutes: 40, attemptLimit: 1, questions: ["question"], dueDate: new Date(now.getTime() + 3600000) };
function query(value, calls = []) {
  const result = { then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } };
  for (const name of ["select", "populate", "sort", "lean"]) result[name] = (...args) => { calls.push([name, ...args]); return result; };
  return result;
}
function request() { return { user: { _id: student, role: "student" }, params: { id: assessmentId }, query: {}, body: {} }; }
function response() { return { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } }; }
function assigned(item = assessment, submissions = []) {
  mock.method(Subject, "find", () => query([{ _id: subject }]));
  mock.method(Assessment, "findOne", (filter) => {
    assert.equal(filter._id, assessmentId);
    assert.deepEqual(filter.subjectRef, { $in: [subject] });
    return query(item);
  });
  mock.method(Submission, "find", (filter) => {
    assert.deepEqual(filter, { assessment: assessmentId, student });
    return query(submissions);
  });
}
afterEach(() => { mock.restoreAll(); mock.timers.reset(); });

test("instructions return configured metadata without questions, sessions, or submission writes", async () => {
  mock.timers.enable({ apis: ["Date"], now: now.getTime() });
  mock.method(Subject, "find", () => query([{ _id: subject }]));
  mock.method(Submission, "find", () => query([]));
  const calls = [];
  mock.method(Assessment, "find", () => query([{ ...assessment, instructions: "Use complete sentences." }], calls));
  const start = mock.method(AssessmentSession, "findOneAndUpdate", () => assert.fail("Instructions must not start an attempt"));
  const create = mock.method(Submission, "create", () => assert.fail("Instructions must not create a submission"));
  const req = request(); req.query.view = "instructions";
  const res = response(); await controller.assignedAssessments(req, res);
  assert.equal(res.body.questions, undefined);
  assert.equal(res.body.numberOfQuestions, 1);
  assert.equal(res.body.durationMinutes, 40);
  assert.equal(res.body.attemptLimit, 1);
  assert.equal(res.body.canStart, true);
  assert.equal(res.body.instructions, "Use complete sentences.");
  assert.equal(calls.some(([name, field]) => name === "populate" && field === "questions"), false);
  assert.equal(start.mock.callCount(), 0); assert.equal(create.mock.callCount(), 0);
});

test("first start records the server clock; concurrent clicks and refreshes retain the original expiry", async () => {
  mock.timers.enable({ apis: ["Date"], now: now.getTime() });
  assigned();
  let stored;
  const update = mock.method(AssessmentSession, "findOneAndUpdate", async (key, changes, options) => {
    assert.deepEqual(key, { assessment: assessmentId, student });
    assert.deepEqual(Object.keys(changes), ["$setOnInsert"]);
    assert.equal(options.upsert, true); assert.equal(options.new, true);
    stored ||= { _id: "session", ...changes.$setOnInsert };
    return stored;
  });
  const create = mock.method(Submission, "create", () => assert.fail("Starting must not create a submission"));
  const first = response(), duplicate = response();
  await Promise.all([controller.startAssessment(request(), first), controller.startAssessment(request(), duplicate)]);
  assert.deepEqual(first.body, duplicate.body);
  assert.equal(first.body.startedAt.getTime(), now.getTime());
  assert.equal(first.body.expiresAt.getTime(), now.getTime() + 40 * 60000);
  // Resuming an expired timer follows the existing expired-submission flow.
  mock.timers.setTime(now.getTime() + 45 * 60000);
  const resumed = response(); await controller.startAssessment(request(), resumed);
  assert.equal(resumed.body.startedAt.getTime(), first.body.startedAt.getTime());
  assert.equal(resumed.body.expiresAt.getTime(), first.body.expiresAt.getTime());
  assert.ok(resumed.body.serverNow > resumed.body.expiresAt);
  assert.equal(update.mock.callCount(), 3); assert.equal(create.mock.callCount(), 0);
  assert.ok(AssessmentSession.schema.indexes().some(([key, options]) => key.assessment === 1 && key.student === 1 && options.unique));
});

test("a competing insert resumes the saved session instead of producing a second attempt", async () => {
  mock.timers.enable({ apis: ["Date"], now: now.getTime() }); assigned();
  mock.method(AssessmentSession, "findOneAndUpdate", async () => { throw Object.assign(new Error("duplicate"), { code: 11000 }); });
  mock.method(AssessmentSession, "findOne", async () => ({ _id: "original", startedAt: now, expiresAt: new Date(now.getTime() + 2400000) }));
  const res = response(); await controller.startAssessment(request(), res);
  assert.equal(res.body._id, "original");
});

test("start rechecks deadlines, availability, teacher closure, and prior submissions before writing", async () => {
  mock.timers.enable({ apis: ["Date"], now: now.getTime() });
  let item = assessment, submissions = [];
  mock.method(Subject, "find", () => query([{ _id: subject }]));
  mock.method(Assessment, "findOne", () => query(item));
  mock.method(Submission, "find", () => query(submissions));
  const start = mock.method(AssessmentSession, "findOneAndUpdate", () => assert.fail("Unavailable starts must not write"));
  for (const changes of [
    { dueDate: new Date(now.getTime() - 1) },
    { startDate: new Date(now.getTime() + 1) },
    { endDate: new Date(now.getTime() - 1) },
    { status: "closed" }, { questions: [] },
  ]) {
    item = { ...assessment, ...changes };
    const res = response(); await controller.startAssessment(request(), res);
    assert.equal(res.statusCode, 403); assert.ok(res.body.message);
  }
  item = { ...assessment, attemptLimit: 3 }; submissions = [{ status: "submitted" }];
  const used = response(); await controller.startAssessment(request(), used);
  assert.equal(used.statusCode, 403); assert.match(used.body.message, /already submitted/);
  assert.equal(start.mock.callCount(), 0);
});

test("start rejects unassigned assessments and invalid durations without creating sessions", async () => {
  mock.timers.enable({ apis: ["Date"], now: now.getTime() }); assigned(null);
  const start = mock.method(AssessmentSession, "findOneAndUpdate", () => assert.fail("Unauthorized starts must not write"));
  const missing = response(); await controller.startAssessment(request(), missing);
  assert.equal(missing.statusCode, 404);
  Assessment.findOne.mock.mockImplementation(() => query({ ...assessment, durationMinutes: 0 }));
  const invalid = response(); await controller.startAssessment(request(), invalid);
  assert.equal(invalid.statusCode, 400);
  assert.equal(start.mock.callCount(), 0);
});

test("the existing later end date permits late starts only until that exact closing timestamp", () => {
  const closing = new Date(now.getTime() + 60000);
  const late = { ...assessment, dueDate: new Date(now.getTime() - 1), endDate: closing };
  assert.equal(assessmentStartAccess(late, [], now).canStart, true);
  assert.equal(assessmentStartAccess(late, [], closing).canStart, true);
  assert.equal(assessmentStartAccess(late, [], new Date(closing.getTime() + 1)).canStart, false);
  assert.match(assessmentStartAccess({ ...assessment, startDate: closing }, [], now).startBlockedReason, /Available from/);
});

test("submission requires a started session and ignores forged client start and expiry fields", async () => {
  mock.timers.enable({ apis: ["Date"], now: now.getTime() });
  mock.method(Assessment, "findById", () => query({ ...assessment, questions: [] }));
  mock.method(Subject, "exists", async () => true);
  mock.method(Submission, "findOne", async () => null);
  let session = null;
  mock.method(AssessmentSession, "findOne", async () => session);
  const create = mock.method(Submission, "create", async (data) => new Submission(data));
  mock.method(require("../services/submissionGrading"), "publishResult", async () => {});
  const req = { ...request(), params: { assessmentId }, body: { answers: [], startedAt: "2099-01-01", timeExpired: false } };
  const blocked = response(); await submissionController.submitAssessment(req, blocked);
  assert.equal(blocked.statusCode, 403); assert.equal(create.mock.callCount(), 0);
  session = { startedAt: new Date(now.getTime() - 2500000), expiresAt: new Date(now.getTime() - 100000) };
  const res = response(); await submissionController.submitAssessment(req, res);
  assert.equal(res.statusCode, 201);
  assert.equal(create.mock.calls[0].arguments[0].startedAt, session.startedAt);
  assert.equal(create.mock.calls[0].arguments[0].timeExpired, true);
});
