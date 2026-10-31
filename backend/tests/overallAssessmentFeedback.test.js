const { test, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const Submission = require("../models/Submission");
const overall = require("../services/overallAssessmentFeedback");
const generation = require("../services/overallFeedbackGeneration");
const groq = require("../services/groqService");
const openai = require("../services/openaiService");
const controller = require("../controllers/submissionController");
const { submissionResult } = require("../services/submissionResults");

const assessment = { _id: "assessment", title: "Matter", subject: "Science", allowAnswerReview: true };
const submission = { _id: "saved", assessment: "assessment", student: "student", status: "graded",
  finalScore: 1, finalPercentage: 50, totalPossiblePoints: 2, updatedAt: new Date("2026-11-01T00:00:00Z"),
  answers: [
    { question: "mass", questionType: "identification", questionText: "What property measures the amount of matter?", answer: "Mass", correctAnswer: "Mass", finalScore: 1, pointsPossible: 1, isCorrect: true, aiStatus: "not_applicable", feedback: "Correct answer." },
    { question: "volume", questionType: "identification", questionText: "What property measures occupied space?", answer: "Mass", correctAnswer: "Volume", finalScore: 0, pointsPossible: 1, isCorrect: false, aiStatus: "not_applicable", feedback: "Correct answer: Volume" },
  ],
};
const generated = { summary: "You identified mass correctly but confused it with volume.", strengths: ["You recognized mass as the amount of matter."], weaknesses: ["Volume was confused with mass."], recommendations: ["Compare mass and volume using two sample objects."] };
const providerResult = { outcome: "partial_credit", summary: generated.summary,
  strengths: [{ text: generated.strengths[0], questionIds: ["mass"] }],
  weaknesses: [{ text: generated.weaknesses[0], questionIds: ["volume"] }],
  recommendations: [{ text: generated.recommendations[0], questionIds: ["volume"] }],
};
function completion(value = providerResult) { return { choices: [{ finish_reason: "stop", message: { content: JSON.stringify(value) } }] }; }
function query(value) {
  const result = { then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } };
  for (const method of ["populate", "select", "lean"]) result[method] = () => result;
  return result;
}
function response() { return { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } }; }
function store(initial = submission) {
  let saved = structuredClone(initial);
  let revision = 0;
  const read = () => structuredClone(saved);
  const claim = mock.method(Submission, "findOneAndUpdate", async (filter, changes) => {
    if (saved.status !== "graded" || +filter.updatedAt !== +saved.updatedAt) return null;
    const feedback = saved.overallFeedback;
    const sameHash = feedback?.inputHash === changes.$set.overallFeedback.inputHash;
    const retryAllowed = filter.$or.some((condition) => condition["overallFeedback.status"] === "failed");
    if (sameHash && feedback.status === "completed") return null;
    if (sameHash && feedback.status === "failed" && !retryAllowed) return null;
    if (sameHash && feedback.status === "processing" && feedback.leaseUntil > new Date()) return null;
    Object.assign(saved, changes.$set); saved.updatedAt = new Date(++revision);
    return read();
  });
  mock.method(Submission, "findById", () => query(read()));
  const update = mock.method(Submission, "updateOne", async (filter, changes) => {
    if (+filter.updatedAt !== +saved.updatedAt || filter["overallFeedback.leaseOwner"] !== saved.overallFeedback.leaseOwner) return { matchedCount: 0 };
    Object.assign(saved, changes.$set); saved.updatedAt = new Date(++revision);
    return { matchedCount: 1 };
  });
  return { read, claim, update, get saved() { return saved; } };
}
const env = { ...process.env };
afterEach(() => {
  mock.restoreAll();
  for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
  Object.assign(process.env, env);
});

test("overall feedback uses saved answers, question results and criteria without changing scores", async () => {
  const storage = store();
  const generate = mock.method(generation, "generateOverallFeedback", async (input) => {
    assert.equal(input.score, 1); assert.equal(input.percentage, 50);
    assert.equal(input.answers[0].question, submission.answers[0].questionText);
    assert.equal(input.answers[1].answer, "Mass"); assert.equal(input.answers[1].score, 0);
    return generated;
  });
  await overall.processOverallFeedback(storage.read(), assessment);
  assert.equal(generate.mock.callCount(), 1);
  assert.equal(storage.saved.finalScore, 1); assert.equal(storage.saved.finalPercentage, 50);
  assert.deepEqual(storage.saved.answers, submission.answers);
  assert.equal(storage.saved.overallFeedback.status, "completed");
  assert.equal(storage.saved.overallFeedback.summary, generated.summary);
  assert.ok(storage.saved.overallFeedback.generatedAt instanceof Date);
  const state = overall.queueOverallFeedback(storage.read(), assessment);
  assert.equal(state.status, "completed"); assert.equal(generate.mock.callCount(), 1);
  assert.equal(state.inputHash, undefined); assert.equal(state.leaseOwner, undefined);
});

test("feedback waits for all required grading results and never treats missing grades as zero", async () => {
  const generate = mock.method(generation, "generateOverallFeedback", () => assert.fail("Must wait for real grades"));
  for (const changes of [
    { status: "submitted", aiGradingStatus: "processing" },
    { finalScore: null, score: null },
    { answers: [{ ...submission.answers[0], finalScore: null, score: null }] },
    { answers: [{ ...submission.answers[0], aiStatus: "pending_review" }] },
  ]) {
    const pending = { ...submission, ...changes };
    assert.equal(overall.overallFeedbackState(pending, assessment).status, "waiting_for_grading");
    await overall.processOverallFeedback(pending, assessment);
  }
  assert.equal(generate.mock.callCount(), 0);
});

test("simultaneous jobs acquire only one persisted lease and expired leases can resume", async () => {
  const storage = store();
  const generate = mock.method(generation, "generateOverallFeedback", async () => generated);
  await Promise.all([overall.processOverallFeedback(storage.read(), assessment), overall.processOverallFeedback(storage.read(), assessment)]);
  assert.equal(generate.mock.callCount(), 1); assert.equal(storage.saved.overallFeedback.status, "completed");
  storage.saved.overallFeedback = { status: "processing", inputHash: overall.inputHash(storage.read(), assessment), leaseUntil: new Date(0) };
  await overall.processOverallFeedback(storage.read(), assessment);
  assert.equal(generate.mock.callCount(), 2);
});

test("provider failure is persisted without fabricated feedback and retries do not resubmit or regrade", async () => {
  const storage = store();
  const generate = mock.method(generation, "generateOverallFeedback", async () => { throw new Error("private provider failure"); });
  await overall.processOverallFeedback(storage.read(), assessment);
  assert.equal(storage.saved.overallFeedback.status, "failed");
  assert.equal(storage.saved.overallFeedback.summary, undefined);
  const failed = overall.queueOverallFeedback(storage.read(), assessment);
  assert.equal(failed.status, "failed"); assert.doesNotMatch(failed.message, /private/);
  assert.equal(generate.mock.callCount(), 1);
  generate.mock.mockImplementation(async () => generated);
  await overall.processOverallFeedback(storage.read(), assessment, true);
  assert.equal(storage.saved.overallFeedback.status, "completed"); assert.equal(generate.mock.callCount(), 2);
  assert.equal(storage.saved.finalScore, 1); assert.deepEqual(storage.saved.answers, submission.answers);
});

test("teacher edits invalidate cached feedback and cannot be overwritten by a stale generation", async () => {
  const storage = store();
  mock.method(generation, "generateOverallFeedback", async () => {
    storage.saved.finalScore = 0; storage.saved.finalPercentage = 0;
    return generated;
  });
  await overall.processOverallFeedback(storage.read(), assessment);
  assert.equal(storage.update.mock.callCount(), 0);
  assert.equal(storage.saved.finalScore, 0);
  assert.equal(overall.overallFeedbackState(storage.read(), assessment).status, "processing");
});

test("zero grades remain real zero grades and never produce unsupported strengths", () => {
  const zero = { ...submission, finalScore: 0, finalPercentage: 0, answers: submission.answers.map((answer) => ({ ...answer, finalScore: 0 })) };
  const input = overall.feedbackInput(zero, assessment);
  assert.equal(overall.readyForFeedback(zero), true);
  assert.throws(() => generation.normalizeFeedback({ ...providerResult, outcome: "no_credit" }, input));
  const result = generation.normalizeFeedback({ ...providerResult, outcome: "no_credit", strengths: [] }, input);
  assert.deepEqual(result.strengths, []);
});

test("feedback validation rejects unknown evidence, incorrect strengths and contradictions with final scores", () => {
  const input = overall.feedbackInput(submission, assessment);
  assert.deepEqual(generation.normalizeFeedback(providerResult, input), generated);
  for (const changes of [
    { outcome: "full_credit" },
    { strengths: [{ text: "Good volume understanding", questionIds: ["volume"] }] },
    { weaknesses: [{ text: "Mass was incorrect", questionIds: ["mass"] }] },
    { recommendations: [{ text: "Study unrelated material", questionIds: ["unknown"] }] },
    { summary: "" },
  ]) assert.throws(() => generation.normalizeFeedback({ ...providerResult, ...changes }, input));
});

test("generation reuses the configured grading providers and falls back without inventing feedback", async () => {
  process.env.GROQ_API_KEY = "test"; process.env.OPENAI_API_KEY = "test";
  mock.method(groq, "createCompletion", async () => { throw new Error("Unavailable"); });
  const fallback = mock.method(openai, "createCompletion", async (payload, context) => {
    const input = JSON.parse(payload.messages[1].content);
    assert.equal(input.answers[1].answer, "Mass"); assert.equal(context.singleAttempt, true);
    assert.equal(context.timeoutMs, 25000);
    return completion();
  });
  assert.deepEqual(await generation.generateOverallFeedback(overall.feedbackInput(submission, assessment)), generated);
  assert.equal(fallback.mock.callCount(), 1);
  delete process.env.GROQ_API_KEY; delete process.env.OPENAI_API_KEY;
  await assert.rejects(generation.generateOverallFeedback(overall.feedbackInput(submission, assessment)), { code: "OVERALL_FEEDBACK_UNAVAILABLE" });
});

test("student result reads and feedback retries remain scoped to the owner and redact internal job data", async () => {
  const saved = { ...structuredClone(submission), assessment, student: { _id: "student" },
    overallFeedback: { status: "completed", summary: "Saved feedback", inputHash: "private", leaseOwner: "private" } };
  mock.method(Submission, "findById", () => query(saved));
  mock.method(Submission, "updateOne", async () => ({ matchedCount: 1 }));
  const queue = mock.method(overall, "queueOverallFeedback", () => ({ status: "completed", summary: "Saved feedback" }));
  for (const handler of [controller.getSubmission, controller.retryOverallFeedback]) {
    const denied = response(); await handler({ user: { _id: "other", role: "student" }, params: { id: "saved" } }, denied);
    assert.equal(denied.statusCode, 403);
  }
  assert.equal(queue.mock.callCount(), 0);
  const res = response(); await controller.getSubmission({ user: { _id: "student", role: "student" }, params: { id: "saved" } }, res);
  assert.deepEqual(res.body.overallFeedback, { status: "completed", summary: "Saved feedback" });
  assert.equal(submissionResult(saved, assessment).overallFeedback, undefined);
  const retry = response(); await controller.retryOverallFeedback({ user: { _id: "student", role: "student" }, params: { id: "saved" } }, retry);
  assert.equal(queue.mock.calls.at(-1).arguments[2], true);
});
