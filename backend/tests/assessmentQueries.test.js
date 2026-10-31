const { mockNotificationWrites } = require("./helpers/notifications");
const { test, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const Assessment = require("../models/Assessment");
const Subject = require("../models/Subject");
const Submission = require("../models/Submission");
const AssessmentSession = require("../models/AssessmentSession");
const AuditLog = require("../models/AuditLog");
const Notification = require("../models/Notification");
const Feedback = require("../models/Feedback");
const controller = require("../controllers/assessmentController");
const subjectController = require("../controllers/subjectController");
const studentController = require("../controllers/studentController");
const submissionController = require("../controllers/submissionController");
const submissionGrading = require("../services/submissionGrading");
const { assessmentSnapshot } = require("../services/assessmentSnapshot");
const { pagination } = require("../utils/queryOptions");

const teacher = "507f1f77bcf86cd799439011";
const subject = "507f1f77bcf86cd799439012";
const assessment = "507f1f77bcf86cd799439013";
function req(query = {}, params = {}) { return { user: { _id: teacher, role: "teacher" }, query, params, body: {} }; }
function res() { return { status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } }; }
function query(value) {
  const calls = [];
  const result = { calls, then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } };
  for (const name of ["select", "populate", "sort", "lean", "skip", "limit"]) result[name] = (...args) => { calls.push([name, ...args]); return result; };
  return result;
}
afterEach(() => mock.restoreAll());

test("assessment summaries use bounded stable pagination and never populate questions", async () => {
  const records = Array.from({ length: 3 }, (_, index) => ({ _id: index, questions: ["q1", "q2"], status: "draft" }));
  const q = query(records);
  const find = mock.method(Assessment, "find", () => q);
  const response = res();
  await controller.listAssessments(req({ view: "summary", page: "2", limit: "2", status: "draft", subjectRef: subject }), response);
  assert.deepEqual(find.mock.calls[0].arguments[0], { teacher, status: "draft", $and: [{ subjectRef: subject }] });
  assert.ok(q.calls.some((call) => call[0] === "skip" && call[1] === 2));
  assert.ok(q.calls.some((call) => call[0] === "limit" && call[1] === 3));
  assert.equal(q.calls.some((call) => call[0] === "populate" && call[1] === "questions"), false);
  const projection = q.calls.find((call) => call[0] === "select")[1];
  for (const field of ["lessonContent", "versionHistory", "originalAiVersion", "teacherModifiedVersion"]) assert.equal(projection.includes(field), false);
  assert.equal(response.body.items.length, 2);
  assert.equal(response.body.items[0].numberOfQuestions, 2);
  assert.equal(response.body.hasMore, true);
});

test("invalid query parameters fail before a database lookup", async () => {
  const find = mock.method(Assessment, "find", () => query([]));
  for (const input of [{ view: "summary", limit: "1000" }, { view: "summary", page: "-1" }, { status: "invalid" }, { subjectRef: "not-an-id" }]) {
    await assert.rejects(controller.listAssessments(req(input), res()), (error) => error.status === 400);
  }
  assert.equal(find.mock.callCount(), 0);
  assert.throws(() => pagination({ limit: "1.5" }), { code: "INVALID_PAGINATION" });
});

test("assessment detail excludes source/version duplication but loads this assessment's questions", async () => {
  const q = query({ _id: assessment, questions: [] });
  const find = mock.method(Assessment, "findOne", () => q);
  await controller.getAssessment(req({}, { id: assessment }), res());
  assert.deepEqual(find.mock.calls[0].arguments[0], { _id: assessment, teacher });
  const projection = q.calls.find((call) => call[0] === "select")[1];
  assert.match(projection, /-versionHistory/);
  assert.match(projection, /-lessonContent/);
  assert.ok(q.calls.some((call) => call[0] === "populate" && call[1] === "questions"));
});

test("manual creation remains draft even if the request attempts to publish", async () => {
  mock.method(Subject, "findOne", () => query({ _id: subject, name: "Science" }));
  mock.method(AuditLog, "create", async () => ({}));
  const create = mock.method(Assessment, "create", async (data) => data);
  const request = req();
  request.body = { title: "Draft", dueDate: "2026-11-01", subjectRef: subject, assessmentType: "quiz", status: "published", isPublished: true };
  await controller.createAssessment(request, res());
  const data = create.mock.calls[0].arguments[0];
  assert.equal(data.status, "draft");
  assert.equal(data.isPublished, false);
  assert.equal(data.publishedAt, undefined);
});

test("updates cannot bypass the explicit publish action", async () => {
  const find = mock.method(Assessment, "findOne", () => query(null));
  const request = req({}, { id: assessment });
  request.body = { status: "published" };
  await assert.rejects(controller.updateAssessment(request, res()), { code: "EXPLICIT_PUBLISH_REQUIRED" });
  assert.equal(find.mock.callCount(), 0);
});

test("dedicated publish action validates questions and explicitly changes draft state", async () => {
  const item = { _id: assessment, title: "Draft", status: "draft", isPublished: false, subjectRef: subject, assessmentType: "quiz",
    questions: [{ order: 1, toObject: () => ({ type: "true_false", text: "Solar panels convert sunlight into electricity.", answerKey: "True" }) }], save: mock.fn(async () => {}) };
  mock.method(Assessment, "findOne", () => query(item));
  mock.method(Subject, "findOne", () => query({ _id: subject, name: "Science", students: [] }));
  mockNotificationWrites(mock);
  mock.method(AuditLog, "create", async () => ({}));
  const response = res();
  await controller.publishAssessment(req({}, { id: assessment }), response);
  assert.equal(item.save.mock.callCount(), 1);
  assert.equal(response.body.status, "published");
  assert.equal(response.body.isPublished, true);
  assert.ok(response.body.publishedAt instanceof Date);
});

test("quiz arena participant counts are aggregated once, without populating lobby questions", async () => {
  const QuizGame = require("../models/QuizGame");
  const QuizGameAttempt = require("../models/QuizGameAttempt");
  const gameController = require("../controllers/quizGameController");
  mock.method(Subject, "find", () => query([{ _id: subject }]));
  const games = query([{ _id: assessment, questions: ["q1"], scoring: { correctPoints: 100 }, status: "active" }]);
  mock.method(QuizGame, "find", () => games);
  mock.method(QuizGameAttempt, "find", () => query([]));
  const aggregate = mock.method(QuizGameAttempt, "aggregate", async () => [{ _id: assessment, count: 7 }]);
  const distinct = mock.method(QuizGameAttempt, "distinct", async () => []);
  const request = req(); request.user.role = "student";
  const response = res();
  await gameController.studentDashboard(request, response);
  assert.equal(aggregate.mock.callCount(), 1);
  assert.equal(distinct.mock.callCount(), 0);
  assert.equal(response.body.games[0].participants, 7);
  assert.equal(games.calls.some((call) => call[0] === "populate" && call[1] === "questions"), false);
});

test("snapshots remain bounded across repeated edits and omit recursive/source fields", () => {
  const record = { _id: assessment, title: "Draft", questions: ["q1"], versionHistory: [], originalAiVersion: { text: "x".repeat(50000) }, lessonContent: "x".repeat(25000) };
  for (let index = 0; index < 40; index += 1) {
    record.teacherModifiedVersion = assessmentSnapshot(record);
    record.versionHistory.push({ snapshot: assessmentSnapshot(record) });
  }
  for (const row of record.versionHistory) {
    assert.equal(row.snapshot.versionHistory, undefined);
    assert.equal(row.snapshot.teacherModifiedVersion, undefined);
    assert.equal(row.snapshot.lessonContent, undefined);
    assert.ok(JSON.stringify(row.snapshot).length < 200);
  }
});

test("assessment update uses an atomic finite snapshot and rejects stale status", async () => {
  mock.method(Assessment, "findOne", () => query({ _id: assessment, status: "draft", title: "Draft", questions: [] }));
  const update = mock.method(Assessment, "updateOne", async () => ({ matchedCount: 1 }));
  const request = req({}, { id: assessment });
  request.body = { title: "Edited", teacher: "different-owner", lessonContent: "injected" };
  const response = res();
  await controller.updateAssessment(request, response);
  const [filter, changes] = update.mock.calls[0].arguments;
  assert.deepEqual(filter, { _id: assessment, teacher, status: "draft" });
  assert.equal(changes.$set.teacher, undefined);
  assert.equal(changes.$set.lessonContent, undefined);
  assert.equal(changes.$push.versionHistory.snapshot.versionHistory, undefined);
  assert.equal(response.body.title, "Edited");
  update.mock.mockImplementation(async () => ({ matchedCount: 0 }));
  await assert.rejects(controller.updateAssessment(request, res()), { code: "ASSESSMENT_CHANGED", status: 409 });
});

test("subject list uses one assessment query rather than one per subject", async () => {
  mock.method(Subject, "find", () => query(Array.from({ length: 30 }, (_, index) => ({ _id: `subject-${index}`, students: [] }))));
  const find = mock.method(Assessment, "find", () => query([{ _id: assessment, subjectRef: "subject-0" }]));
  const response = res();
  await subjectController.listSubjects(req(), response);
  assert.equal(find.mock.callCount(), 1);
  assert.equal(response.body.length, 30);
  assert.equal(response.body[0].assessmentCount, 1);
});

test("teacher submission list scopes ownership in MongoDB before populating results", async () => {
  mock.method(Assessment, "find", () => query([{ _id: assessment }]));
  const find = mock.method(Submission, "find", () => query([]));
  await submissionController.listSubmissions(req({ assessmentId: assessment }), res());
  assert.deepEqual(find.mock.calls[0].arguments[0], { assessment: { $in: [assessment] } });
});

test("student summaries never populate questions; detail remains enrollment/status restricted", async () => {
  mock.method(Subject, "find", () => query([{ _id: subject }]));
  mock.method(Submission, "find", () => query([]));
  const summaryQuery = query([{ _id: assessment, questions: ["q1"], totalPoints: 1, status: "published" }]);
  const find = mock.method(Assessment, "find", () => summaryQuery);
  const request = req({ view: "summary" }); request.user.role = "student";
  const response = res();
  await studentController.assignedAssessments(request, response);
  assert.equal(summaryQuery.calls.some((call) => call[0] === "populate" && call[1] === "questions"), false);
  assert.equal(response.body[0].questions, undefined);
  assert.equal(response.body[0].numberOfQuestions, 1);
  const detailQuery = query([]);
  find.mock.mockImplementation(() => detailQuery);
  request.params = { id: assessment };
  await studentController.assignedAssessments(request, res());
  const filter = find.mock.calls.at(-1).arguments[0];
  assert.deepEqual(filter.subjectRef, { $in: [subject] });
  assert.deepEqual(filter.status, { $in: ["published", "closed"] });
  const selected = detailQuery.calls.find((call) => call[0] === "populate" && call[1] === "questions")[2];
  assert.equal(selected.includes("answerKey"), false);
  assert.equal(selected.includes("suggestedAnswer"), false);
});

test("pending essays persist as submitted with no failing score or graded notification", async () => {
  mock.method(AssessmentSession, "findOne", async () => ({ startedAt: new Date(), expiresAt: new Date(Date.now() + 1800000) }));
  const oldGroq = process.env.GROQ_API_KEY;
  const oldOpenAi = process.env.OPENAI_API_KEY;
  delete process.env.GROQ_API_KEY;
  delete process.env.OPENAI_API_KEY;
  mock.method(console, "info", () => {});
  try {
    const question = { _id: "507f1f77bcf86cd799439014", type: "essay", text: "Explain solids.", points: 10 };
    mock.method(Assessment, "findById", () => query({ _id: assessment, subjectRef: subject, status: "published", title: "Matter", questions: [question] }));
    mock.method(Subject, "exists", async () => true);
    mock.method(Submission, "findOne", async () => null);
    mock.method(Submission, "find", () => query([]));
    const create = mock.method(Submission, "create", async (data) => ({ ...data, _id: "submission", toObject: () => data }));
    const feedback = mock.method(Feedback, "findOneAndUpdate", async () => ({}));
    const notifications = mockNotificationWrites(mock);
    const queued = mock.method(submissionGrading, "queueSubmissionGrading", () => {});
    const request = req({}, { assessmentId: assessment });
    request.user.role = "student";
    request.body.answers = [{ question: question._id, answer: "Solids have fixed shape and volume." }];
    const response = res();
    await submissionController.submitAssessment(request, response);
    const data = create.mock.calls[0].arguments[0];
    assert.equal(response.statusCode, 201);
    assert.equal(data.status, "submitted");
    assert.equal(data.score, null);
    assert.equal(data.percentage, null);
    assert.equal(data.gradedAt, undefined);
    assert.equal(data.answers[0].score, null);
    assert.equal(data.passStatus, "not_applicable");
    assert.equal(response.body.numberIncorrect, 0);
    assert.equal(data.aiGradingStatus, "processing");
    assert.equal(data.answers[0].aiStatus, "processing");
    assert.equal(response.body.studentStatus, "Completed");
    assert.equal(queued.mock.callCount(), 1);
    assert.equal(feedback.mock.callCount(), 0);
    assert.equal(notifications.mock.callCount(), 0);
  } finally {
    if (oldGroq !== undefined) process.env.GROQ_API_KEY = oldGroq;
    if (oldOpenAi !== undefined) process.env.OPENAI_API_KEY = oldOpenAi;
  }
});

test("assessment average excludes pending reviews but includes earned zero grades", async () => {
  const students = [{ _id: "a" }, { _id: "b" }, { _id: "c" }];
  mock.method(Assessment, "findOne", () => query({ _id: assessment, subjectRef: { students } }));
  mock.method(Submission, "find", () => query([
    { student: "a", status: "submitted", aiGradingStatus: "pending_review", score: null, percentage: null },
    { student: "b", status: "graded", score: 0, percentage: 0 },
    { student: "c", status: "graded", score: 10, percentage: 100 },
  ]));
  const response = res();
  await controller.submissionStatus(req({}, { id: assessment }), response);
  assert.equal(response.body.turnedIn, 3);
  assert.equal(response.body.averageScore, 50);
  assert.equal(response.body.students.find((item) => item.student._id === "a").score, null);
});

test("teacher essay overrides reject decimal scores before changing a saved submission", async () => {
  const answer = { question: "essay-question", questionType: "essay", score: 8, finalScore: 8, pointsPossible: 10 };
  const save = mock.fn(async () => {});
  const submission = { assessment: { teacher }, answers: [answer], save };
  mock.method(Submission, "findById", () => query(submission));
  const update = mock.method(Submission, "findByIdAndUpdate", async () => ({}));
  const request = req({}, { id: "submission", questionId: "essay-question" });
  request.body = { finalScore: 7.5, score: 7.5 };
  const answerResponse = res();
  await submissionController.updateAnswerOverride(request, answerResponse);
  assert.equal(answerResponse.statusCode, 400);
  assert.equal(answer.score, 8);
  assert.equal(save.mock.callCount(), 0);
  const totalResponse = res();
  await submissionController.overrideScore(request, totalResponse);
  assert.equal(totalResponse.statusCode, 400);
  assert.equal(update.mock.callCount(), 0);
});
