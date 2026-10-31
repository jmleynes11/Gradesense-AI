const { mockNotificationWrites } = require("./helpers/notifications");
const { test, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const Assessment = require("../models/Assessment");
const Submission = require("../models/Submission");
const AssessmentSession = require("../models/AssessmentSession");
const Subject = require("../models/Subject");
const Feedback = require("../models/Feedback");
const Notification = require("../models/Notification");
const groq = require("../services/groqService");
const grading = require("../services/submissionGrading");
const controller = require("../controllers/submissionController");
const { submissionResult } = require("../services/submissionResults");
const { question: essayQuestion, lessonContent, cases } = require("../utils/essayGradingCases");
const question = { ...essayQuestion, _id: "507f1f77bcf86cd799439014" };

const assessmentId = "507f1f77bcf86cd799439011";
const studentId = "507f1f77bcf86cd799439012";
const submissionId = "507f1f77bcf86cd799439013";
const assessment = { _id: assessmentId, title: "Matter", subject: "Science", status: "published",
  subjectRef: assessmentId, questions: [question], totalPoints: 10, lessonContent };
const savedEnv = { ...process.env };
function query(value) {
  const result = { then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } };
  for (const method of ["populate", "select", "lean", "sort", "limit"]) result[method] = () => result;
  return result;
}
function response() { return { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } }; }
function request() { return { user: { _id: studentId, role: "student" }, params: { assessmentId }, body: {
  answers: [{ question: question._id, answer: cases[0].answer }],
} }; }
afterEach(() => {
  mock.restoreAll();
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
});

test("submission responds with persisted metadata before any essay provider call", async () => {
  mock.method(AssessmentSession, "findOne", async () => ({ startedAt: new Date(), expiresAt: new Date(Date.now() + 1800000) }));
  mock.method(Assessment, "findById", () => query(assessment));
  mock.method(Subject, "exists", async () => true);
  mock.method(Submission, "findOne", async () => null);
  mock.method(Submission, "create", async (data) => new Submission({ ...data, _id: submissionId }));
  const provider = mock.method(groq, "createCompletion", () => { throw new Error("Must run after response"); });
  const queued = mock.method(grading, "queueSubmissionGrading", () => assert.equal(res.statusCode, 201));
  const res = response();
  await controller.submitAssessment(request(), res);
  assert.equal(res.body._id.toString(), submissionId);
  assert.equal(res.body.assessment.title, "Matter");
  assert.equal(res.body.assessment.subject, "Science");
  assert.ok(res.body.submittedAt instanceof Date);
  assert.equal(res.body.score, null);
  assert.equal(res.body.finalScore, null);
  assert.equal(res.body.totalPossiblePoints, 10);
  assert.equal(res.body.aiGradingStatus, "processing");
  assert.equal(res.body.studentStatus, "Completed");
  assert.equal(res.body.canSubmit, false);
  assert.equal(provider.mock.callCount(), 0);
  assert.equal(queued.mock.callCount(), 1);
});

function workerStore() {
  let stored = new Submission({ _id: submissionId, assessment: assessmentId, student: studentId,
    status: "submitted", aiGradingStatus: "processing", score: null, finalScore: null,
    percentage: null, finalPercentage: null, totalPossiblePoints: 10, updatedAt: new Date(),
    answers: [{ question: question._id, questionType: "essay", questionText: question.text,
      answer: cases[0].answer, pointsPossible: 10, score: null, finalScore: null, aiStatus: "processing" }] });
  const read = () => new Submission(stored.toObject());
  mock.method(Assessment, "findById", () => query(assessment));
  mock.method(Submission, "find", () => query([]));
  mock.method(Submission, "findById", async () => read());
  mock.method(Submission, "findOneAndUpdate", async (_filter, update) => {
    if (stored.gradingLeaseUntil > new Date()) return null;
    Object.assign(stored, update.$set);
    return read();
  });
  mock.method(Submission, "updateOne", async (filter, update) => {
    if (filter.status && stored.status !== filter.status) return { matchedCount: 0 };
    if (stored.gradingLeaseOwner !== filter.gradingLeaseOwner) return { matchedCount: 0 };
    for (const [key, value] of Object.entries(update.$set || {})) {
      if (key === "answers.$") stored.answers[0] = value;
      else stored[key] = value;
    }
    for (const key of Object.keys(update.$unset || {})) stored[key] = undefined;
    return { matchedCount: 1 };
  });
  mock.method(Feedback, "findOneAndUpdate", async () => ({}));
  mockNotificationWrites(mock);
  mock.method(console, "info", () => {});
  return { read, get stored() { return stored; } };
}

function completion(scores) {
  return { choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
    criteria: scores.map((score) => ({ score, feedback: "Checked against lesson evidence.", evidence: score ? [cases[0].answer] : [] })),
    overallFeedback: "Evaluated against lesson concepts.", hasCreditworthyContent: scores.some((score) => score > 0),
    strengths: scores.some((score) => score > 0) ? ["Correct concepts."] : [],
    weaknesses: scores.reduce((sum, score) => sum + score, 0) < 10 ? ["Missing concepts."] : [],
    missingOrIncorrectConcepts: scores.reduce((sum, score) => sum + score, 0) < 10 ? ["Missing concepts."] : [],
    suggestions: scores.reduce((sum, score) => sum + score, 0) < 10 ? ["Review missing concepts."] : [],
  }) } }] };
}

for (const [label, scores, expected] of [["full", [3, 3, 4], 10], ["partial", [3, 1, 2], 6], ["genuine zero", [0, 0, 0], 0]]) {
  test(`background grading persists ${label} scores and feedback`, async () => {
    const store = workerStore();
    process.env.GROQ_API_KEY = "test-key";
    mock.method(groq, "createCompletion", async () => completion(scores));
    await grading.processSubmission(submissionId);
    const saved = store.read();
    assert.equal(saved.status, "graded");
    assert.equal(saved.aiGradingStatus, "completed");
    assert.equal(saved.score, expected);
    assert.equal(saved.finalScore, expected);
    assert.equal(saved.aiScore, expected);
    assert.equal(saved.percentage, expected * 10);
    assert.equal(saved.answers[0].aiScore, expected);
    assert.match(saved.answers[0].feedback, /lesson/);
    assert.ok(saved.gradedAt instanceof Date);
    assert.equal(saved.gradingLeaseOwner, undefined);
  });
}

test("provider failure remains pending with null totals and preserves student answers", async () => {
  const store = workerStore();
  delete process.env.GROQ_API_KEY;
  delete process.env.OPENAI_API_KEY;
  await grading.processSubmission(submissionId);
  const saved = store.read();
  assert.equal(saved.status, "submitted");
  assert.equal(saved.aiGradingStatus, "pending_review");
  assert.equal(saved.score, null);
  assert.equal(saved.percentage, null);
  assert.equal(saved.answers[0].answer, cases[0].answer);
  assert.equal(saved.answers[0].finalScore, null);
  assert.equal(saved.passStatus, "not_applicable");
});

test("a teacher total entered during AI evaluation cannot be overwritten", async () => {
  const store = workerStore();
  process.env.GROQ_API_KEY = "test-key";
  mock.method(groq, "createCompletion", async () => {
    store.stored.status = "graded";
    store.stored.finalScore = store.stored.score = 7;
    return completion([3, 3, 4]);
  });
  await grading.processSubmission(submissionId);
  assert.equal(store.read().finalScore, 7);
});

test("an active persisted grading lease prevents a second worker from grading", async () => {
  const store = workerStore();
  store.stored.gradingLeaseUntil = new Date(Date.now() + 60000);
  const provider = mock.method(groq, "createCompletion", async () => completion([3, 3, 4]));
  await grading.processSubmission(submissionId);
  assert.equal(provider.mock.callCount(), 0);
});

test("student answer review uses snapshots and omits internal data and disabled reviews", () => {
  const saved = { _id: submissionId, score: 0, gradingLeaseOwner: "private", answers: [{
    question: { _id: question._id, answerKey: "Live key" }, correctAnswer: "Saved key", questionText: "Saved question",
    answer: "Wrong", isCorrect: false, aiError: "Provider details", plagiarismReport: { matchingStudentName: "Other student" },
  }] };
  const visible = submissionResult(saved, assessment);
  assert.equal(visible.answers[0].correctAnswer, "Saved key");
  assert.equal(visible.answers[0].questionText, "Saved question");
  assert.equal(visible.answers[0].question, question._id);
  assert.equal(visible.answers[0].aiError, undefined);
  assert.equal(visible.answers[0].plagiarismReport, undefined);
  assert.equal(visible.gradingLeaseOwner, undefined);
  assert.deepEqual(submissionResult(saved, { ...assessment, allowAnswerReview: false }).answers, []);
  assert.deepEqual(submissionResult(saved, assessment, "teacher"), saved);
});

test("missing scores are unavailable while processing and earned zero are distinct", async () => {
  const { displayScore, displayPercentage } = await import("../../client/src/services/gradeDisplay.js");
  assert.equal(displayScore({ status: "graded", totalPossiblePoints: 10 }), "Score unavailable");
  assert.equal(displayPercentage({ status: "graded" }), "Percentage unavailable");
  assert.equal(displayScore({ status: "submitted", aiGradingStatus: "processing", score: 0 }), "Pending essay grading");
  assert.equal(displayScore({ status: "graded", finalScore: 0, totalPossiblePoints: 10 }), "0/10");
});
