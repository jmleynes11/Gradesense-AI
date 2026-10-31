const { test, beforeEach, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const groq = require("../services/groqService");
const openai = require("../services/openaiService");
const { generateQuiz } = require("../services/aiService");
const { aiError, requestCancellation } = require("../services/aiRequestPolicy");
const { retryAfterMs } = require("../services/quizProviderService");
const { analyzeLesson } = require("../services/lessonAnalysisService");
const { buildQuizOutputSchema, adaptStrictQuizResponse } = require("../services/quizOutputSchema");

const lesson = "Solar energy, wind energy, hydro energy, and geothermal energy are renewable energy sources. Solar energy comes from sunlight and solar panels convert sunlight into electricity. Wind turbines convert wind energy into electricity. Hydro energy comes from moving water. Geothermal energy comes from heat inside the Earth.";
const question = {
  type: "multiple_choice", text: "Which renewable energy source comes from sunlight?",
  correctAnswer: "Solar energy", distractors: ["Wind energy", "Hydro energy", "Geothermal energy"],
  answerKey: "Solar energy", explanation: "Solar energy comes from sunlight.",
  sourceEvidence: "Solar energy comes from sunlight and solar panels convert sunlight into electricity.",
  points: 1, difficulty: "medium",
};
const settings = { difficulty: "medium", counts: { multiple_choice: 1 } };
const complete = (questions = [question], finish = "stop") => ({
  choices: [{ finish_reason: finish, message: { content: JSON.stringify({ questions }) } }],
  usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
});
const failure = (status, headers) => Object.assign(new Error("mock provider failure"), { status, headers });
let primary;
let fallback;
const savedEnv = { ...process.env };

beforeEach(() => {
  process.env.AI_QUIZ_TOTAL_TIMEOUT_MS = "500";
  process.env.AI_QUIZ_REQUEST_TIMEOUT_MS = "100";
  process.env.AI_QUIZ_RETRY_DELAY_MS = "0";
  process.env.AI_QUIZ_MAX_RETRY_DELAY_MS = "10";
  primary = mock.method(groq, "createCompletion", async () => complete());
  fallback = mock.method(openai, "createCompletion", async () => complete());
  mock.method(console, "info", () => {});
  mock.method(console, "error", () => {});
});
afterEach(() => {
  mock.restoreAll();
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
});

test("Groq succeeds without calling OpenAI; existing question and answer-key formats survive", async () => {
  const result = await generateQuiz(lesson, settings);
  assert.equal(result.aiStatus, "groq_generated");
  assert.equal(result.questions.length, 1);
  assert.equal(result.questions[0].choices.length, 4);
  assert.equal(result.questions[0].answerKey, "Solar energy");
  assert.equal(result.answerKey[0].answer, "Solar energy");
  assert.equal(result.tokenUsage.total, 150);
  assert.equal(primary.mock.callCount(), 1);
  assert.equal(fallback.mock.callCount(), 0);
});

test("specific Groq json_validate_failed 400 gets one JSON-mode recovery", async () => {
  primary.mock.mockImplementationOnce(async () => { throw Object.assign(failure(400), { code: "json_validate_failed" }); });
  const result = await generateQuiz(lesson, settings);
  assert.equal(result.aiStatus, "groq_generated");
  assert.equal(primary.mock.callCount(), 2);
  assert.equal(primary.mock.calls[1].arguments[1].groqOutputMode, "json_object");
  assert.match(primary.mock.calls[1].arguments[0].messages.at(-1).content, /questions as a JSON array/);
  assert.equal(fallback.mock.callCount(), 0);
});

test("repeated provider JSON-generation errors activate fallback once", async () => {
  primary.mock.mockImplementation(async () => { throw Object.assign(failure(400), { error: { code: "json_validate_failed" } }); });
  assert.equal((await generateQuiz(lesson, settings)).aiStatus, "openai_generated");
  assert.equal(primary.mock.callCount(), 2);
  assert.equal(fallback.mock.callCount(), 1);
});

test("quiz payload sends readable full lesson text once without duplicate summary fields", async () => {
  await generateQuiz(lesson, settings);
  const payload = JSON.parse(primary.mock.calls[0].arguments[0].messages[1].content);
  assert.equal(payload.lessonText, lesson);
  assert.equal(payload.lessonSummary, undefined);
  assert.equal(payload.keyConcepts, undefined);
  assert.ok(Array.isArray(payload.topicsIdentified));
  const prepared = console.info.mock.calls.map((call) => call.arguments[1]).find((record) => record.event === "lesson_payload_prepared");
  assert.ok(prepared.lessonTokens > 0);
  assert.ok(prepared.payloadCharacters > lesson.length);
});

test("partial recovery keeps valid questions and regenerates only missing types", async () => {
  const identification = { ...question, type: "identification", text: "Which renewable energy comes from moving water?", answerKey: "Hydro energy" };
  primary.mock.mockImplementationOnce(async () => complete([question]));
  primary.mock.mockImplementation(async () => complete([identification]));
  const result = await generateQuiz(lesson, { ...settings, counts: { multiple_choice: 1, identification: 1 } });
  assert.deepEqual(result.questions.map((item) => item.type), ["multiple_choice", "identification"]);
  const repairData = JSON.parse(primary.mock.calls[1].arguments[0].messages[1].content);
  assert.deepEqual(repairData.requestedQuestionCounts, { multiple_choice: 0, true_false: 0, identification: 1, essay: 0 });
  assert.equal(repairData.lessonText, lesson);
  assert.deepEqual(repairData.existingQuestionTexts, [question.text]);
  assert.equal(fallback.mock.callCount(), 0);
});

test("extra generated questions are excluded only after all requested counts validate", async () => {
  const extra = { ...question, type: "identification", text: "Which source comes from moving water?", answerKey: "Hydro energy" };
  primary.mock.mockImplementation(async () => complete([question, extra]));
  const result = await generateQuiz(lesson, settings);
  assert.equal(result.questions.length, 1);
  assert.equal(result.questions[0].type, "multiple_choice");
  assert.equal(primary.mock.callCount(), 1);
  assert.equal(fallback.mock.callCount(), 0);
});

test("plausible wrong options need not be lesson facts; correct answer and evidence must be", async () => {
  primary.mock.mockImplementation(async () => complete([{ ...question, distractors: ["Nuclear energy", "Chemical combustion", "Electrical batteries"] }]));
  assert.equal((await generateQuiz(lesson, settings)).questions.length, 1);
  assert.equal(fallback.mock.callCount(), 0);
  primary.mock.mockImplementation(async () => complete([{ ...question, correctAnswer: "Quantum teleportation", answerKey: "Quantum teleportation" }]));
  assert.equal((await generateQuiz(lesson, settings)).aiStatus, "openai_generated");
  assert.equal(fallback.mock.callCount(), 1);
});

test("MC recovery includes bounded reserve candidates and still returns the requested count", async () => {
  const broken = { ...question, text: "Which energy source uses sunlight?", distractors: ["Wind energy"] };
  const replacement = { ...question, text: "Which energy source uses solar panels?", correctAnswer: "Solar panels convert sunlight into electricity", answerKey: "Solar panels convert sunlight into electricity", distractors: ["Wind turbines convert moving air into electricity", "Hydro turbines use moving water", "Geothermal systems use heat inside Earth"] };
  primary.mock.mockImplementationOnce(async () => complete([question, broken]));
  primary.mock.mockImplementation(async () => complete([replacement, { ...replacement, text: "Which panels transform sunlight into electrical energy?" }]));
  const result = await generateQuiz(lesson, { ...settings, counts: { multiple_choice: 2 } });
  assert.equal(result.questions.length, 2);
  assert.equal(primary.mock.callCount(), 2);
  assert.equal(primary.mock.calls[1].arguments[1].questionCounts.multiple_choice, 3);
  assert.equal(fallback.mock.callCount(), 0);
});

test("generation accepts a readable bullet lesson without sentence-ending punctuation", async () => {
  const bullets = lesson.split(". ").map((line) => line.replace(/\.$/, "")).join("\n");
  assert.equal((await generateQuiz(bullets, settings)).aiStatus, "groq_generated");
  assert.equal(fallback.mock.callCount(), 0);
});

test("authentication and policy errors cannot be disguised as JSON-generation errors", async () => {
  primary.mock.mockImplementation(async () => { throw Object.assign(failure(401), { code: "json_validate_failed" }); });
  await assert.rejects(generateQuiz(lesson, settings), { status: 401 });
  assert.equal(primary.mock.callCount(), 1);
  assert.equal(fallback.mock.callCount(), 0);
});

for (const status of [429, 500, 502, 503, 504]) {
  test(`HTTP ${status} activates one OpenAI fallback with identical lesson and quiz configuration`, async () => {
    primary.mock.mockImplementation(async () => { throw failure(status, { "retry-after": "60" }); });
    const result = await generateQuiz(lesson, settings);
    assert.equal(result.aiStatus, "openai_generated");
    assert.equal(primary.mock.callCount(), 1);
    assert.equal(fallback.mock.callCount(), 1);
    assert.deepEqual(primary.mock.calls[0].arguments[0].messages, fallback.mock.calls[0].arguments[0].messages);
    assert.equal(fallback.mock.calls[0].arguments[1].singleAttempt, true);
  });
}

test("Groq timeout triggers fallback within the bounded operation", async () => {
  primary.mock.mockImplementation(() => new Promise(() => {}));
  const result = await generateQuiz(lesson, settings);
  assert.equal(result.aiStatus, "openai_generated");
  assert.equal(primary.mock.calls[0].arguments[1].signal.aborted, true);
  assert.equal(fallback.mock.callCount(), 1);
});

for (const status of [400, 401, 403, 404, 422]) {
  test(`HTTP ${status} stops without retry or fallback`, async () => {
    primary.mock.mockImplementation(async () => { throw failure(status); });
    await assert.rejects(generateQuiz(lesson, settings), (error) => error.status === status);
    assert.equal(primary.mock.callCount(), 1);
    assert.equal(fallback.mock.callCount(), 0);
  });
}

test("missing Groq credentials cannot be concealed by fallback", async () => {
  primary.mock.mockImplementation(async () => { throw aiError("GROQ_API_KEY_MISSING"); });
  await assert.rejects(generateQuiz(lesson, settings), { code: "GROQ_API_KEY_MISSING" });
  assert.equal(fallback.mock.callCount(), 0);
});

test("programming errors cannot activate fallback", async () => {
  primary.mock.mockImplementation(async () => { throw new TypeError("programming failure"); });
  await assert.rejects(generateQuiz(lesson, settings));
  assert.equal(fallback.mock.callCount(), 0);
});

test("a short network retry can recover without fallback", async () => {
  primary.mock.mockImplementationOnce(async () => { throw Object.assign(new Error("network"), { name: "APIConnectionError" }); });
  assert.equal((await generateQuiz(lesson, settings)).aiStatus, "groq_generated");
  assert.equal(primary.mock.callCount(), 2);
  assert.equal(fallback.mock.callCount(), 0);
});

test("retry is skipped when there is insufficient budget for another primary and fallback attempt", async () => {
  process.env.AI_QUIZ_TOTAL_TIMEOUT_MS = "190";
  primary.mock.mockImplementation(async () => { throw failure(503); });
  assert.equal((await generateQuiz(lesson, settings)).aiStatus, "openai_generated");
  assert.equal(primary.mock.callCount(), 1);
});

test("Retry-After accepts Headers, seconds and HTTP dates", () => {
  assert.equal(retryAfterMs(failure(503, new Headers({ "Retry-After": "1.5" }))), 1500);
  const future = new Date(Date.now() + 3000).toUTCString();
  const wait = retryAfterMs(failure(503, { "retry-after": future }));
  assert.ok(wait > 1000 && wait <= 3000);
});

test("a bounded short Retry-After is respected once", async () => {
  primary.mock.mockImplementationOnce(async () => { throw failure(503, new Headers({ "retry-after": "0.005" })); });
  const startedAt = Date.now();
  await generateQuiz(lesson, settings);
  assert.ok(Date.now() - startedAt >= 5);
  assert.equal(primary.mock.callCount(), 2);
});

for (const [name, response] of [
  ["invalid JSON", { choices: [{ finish_reason: "stop", message: { content: "{" } }] }],
  ["missing questions", { choices: [{ finish_reason: "stop", message: { content: "{}" } }] }],
  ["empty content", { choices: [{ finish_reason: "stop", message: { content: "" } }] }],
  ["truncation", complete([question], "length")],
  ["wrong question count", complete([])],
  ["invalid choices", complete([{ ...question, distractors: ["Wind energy"] }])],
  ["unsupported lesson facts", complete([{ ...question, sourceEvidence: "Martian colonies manufacture quantum engines." }])],
  ["incorrect types", complete([{ ...question, choices: "invalid" }])],
]) {
  test(`${name} gets at most one recovery, then validated OpenAI fallback`, async () => {
    primary.mock.mockImplementation(async () => response);
    const result = await generateQuiz(lesson, settings);
    assert.equal(result.aiStatus, "openai_generated");
    assert.equal(primary.mock.callCount(), 2);
    assert.equal(fallback.mock.callCount(), 1);
    assert.deepEqual(primary.mock.calls[0].arguments[0].messages, fallback.mock.calls[0].arguments[0].messages);
  });
}

test("JSON recovery can succeed; usage includes both responses", async () => {
  primary.mock.mockImplementationOnce(async () => ({ ...complete(), choices: [] }));
  const result = await generateQuiz(lesson, settings);
  assert.equal(result.aiStatus, "groq_generated");
  assert.equal(result.tokenUsage.total, 300);
  assert.equal(fallback.mock.callCount(), 0);
});

test("both providers failing returns the existing controlled error shape", async () => {
  primary.mock.mockImplementation(async () => { throw failure(429); });
  fallback.mock.mockImplementation(async () => { throw failure(503); });
  await assert.rejects(generateQuiz(lesson, settings), (error) => {
    assert.equal(error.code, "AI_PROVIDERS_FAILED");
    assert.equal(error.status, 503);
    assert.match(error.message, /temporarily unavailable/);
    assert.equal(error.cause.cause.errors.length, 2);
    return true;
  });
  assert.equal(fallback.mock.callCount(), 1);
});

test("invalid OpenAI response ends the operation without recursive fallback", async () => {
  primary.mock.mockImplementation(async () => { throw failure(429); });
  fallback.mock.mockImplementation(async () => complete([]));
  await assert.rejects(generateQuiz(lesson, settings), { code: "AI_PROVIDERS_FAILED" });
  assert.equal(fallback.mock.callCount(), 1);
});

test("pre-cancelled and in-progress cancelled requests do not fallback", async () => {
  const cancelled = new AbortController();
  cancelled.abort(aiError("AI_REQUEST_CANCELLED", 499));
  await assert.rejects(generateQuiz(lesson, { ...settings, signal: cancelled.signal }), { code: "AI_REQUEST_CANCELLED" });
  assert.equal(primary.mock.callCount(), 0);
  const active = new AbortController();
  primary.mock.mockImplementation(async () => {
    active.abort(aiError("AI_REQUEST_CANCELLED", 499));
    throw failure(503);
  });
  await assert.rejects(generateQuiz(lesson, { ...settings, signal: active.signal }), { code: "AI_REQUEST_CANCELLED" });
  assert.equal(fallback.mock.callCount(), 0);
});

test("total operation deadline includes queue/network wait", async () => {
  process.env.AI_QUIZ_TOTAL_TIMEOUT_MS = "20";
  primary.mock.mockImplementation(() => new Promise(() => {}));
  await assert.rejects(generateQuiz(lesson, settings), { code: "AI_TOTAL_TIMEOUT", status: 504 });
  assert.equal(fallback.mock.callCount(), 0);
});

test("HTTP disconnect aborts; normal response completion does not", () => {
  const req = new EventEmitter();
  const res = new EventEmitter();
  const cancellation = requestCancellation(req, res);
  res.emit("close");
  assert.equal(cancellation.signal.aborted, true);
  cancellation.dispose();
  assert.equal(res.listenerCount("close"), 0);
  res.writableEnded = true;
  const finished = requestCancellation(req, res);
  res.emit("close");
  assert.equal(finished.signal.aborted, false);
  finished.dispose();
});

test("cancellation during Retry-After wait does not initiate another provider attempt", async () => {
  process.env.AI_QUIZ_MAX_RETRY_DELAY_MS = "100";
  const controller = new AbortController();
  primary.mock.mockImplementation(async () => { throw failure(503, { "retry-after": "0.05" }); });
  const pending = generateQuiz(lesson, { ...settings, signal: controller.signal });
  const timer = setTimeout(() => controller.abort(aiError("AI_REQUEST_CANCELLED", 499)), 10);
  await assert.rejects(pending, { code: "AI_REQUEST_CANCELLED" });
  clearTimeout(timer);
  assert.equal(primary.mock.callCount(), 1);
  assert.equal(fallback.mock.callCount(), 0);
});

test("diagnostic logs retain original identifiers and stack frames without lesson or keys", async () => {
  process.env.GROQ_API_KEY = "mock-secret";
  primary.mock.mockImplementation(async () => {
    throw Object.assign(new Error(`${lesson} mock-secret`), { status: 429, code: "rate_limit_exceeded", request_id: "provider-request-1" });
  });
  await generateQuiz(lesson, settings);
  const records = console.info.mock.calls.map((call) => call.arguments[1]);
  const failed = records.find((record) => record.event === "provider_failed");
  assert.equal(failed.code, "rate_limit_exceeded");
  assert.equal(failed.providerRequestId, "provider-request-1");
  assert.ok(failed.stackFrames.length > 0);
  assert.equal(records.at(-1).finalProvider, "openai");
  assert.equal(JSON.stringify(records).includes(lesson), false);
  assert.equal(JSON.stringify(records).includes("mock-secret"), false);
});

test("content-policy refusals stop without recovery or fallback", async () => {
  primary.mock.mockImplementation(async () => ({ choices: [{ finish_reason: "content_filter", message: { refusal: "blocked" } }] }));
  await assert.rejects(generateQuiz(lesson, settings), { code: "AI_CONTENT_POLICY" });
  assert.equal(primary.mock.callCount(), 1);
  assert.equal(fallback.mock.callCount(), 0);
});

test("both providers preserve all four question types and the application model", async () => {
  const questions = [question,
    { ...question, type: "true_false", text: "Wind turbines convert wind energy into electricity.", answerKey: "True", choices: ["True", "False"] },
    { ...question, type: "identification", text: "Which energy source comes from moving water?", answerKey: "Hydro energy" },
    { ...question, type: "essay", text: "Compare solar energy and wind energy conversion.", answerKey: "", suggestedAnswer: "Solar panels and wind turbines convert renewable energy into electricity.", rubric: { keyPoints: ["Solar panels convert sunlight.", "Wind turbines convert wind energy."], contentAccuracy: 40, understanding: 30, organization: 20, grammarClarity: 10 } },
  ];
  primary.mock.mockImplementation(async () => complete(questions));
  fallback.mock.mockImplementation(async () => complete(questions));
  const allSettings = { ...settings, counts: { multiple_choice: 1, true_false: 1, identification: 1, essay: 1 } };
  const first = await generateQuiz(lesson, allSettings);
  primary.mock.mockImplementation(async () => { throw failure(429); });
  const second = await generateQuiz(lesson, allSettings);
  assert.deepEqual(first.questions, second.questions);
  assert.deepEqual(first.answerKey, second.answerKey);
  assert.deepEqual(Object.keys(first), Object.keys(second));
  const Question = require("../models/Question");
  for (const item of second.questions) {
    await new Question({ ...item, teacher: "507f1f77bcf86cd799439011" }).validate();
  }
});

test("compatible nullable fields and correctAnswer-only MC output do not trigger fallback", async () => {
  primary.mock.mockImplementation(async () => complete([{ ...question, answerKey: undefined,
    choices: null, acceptableAnswers: null, alternativeAnswers: null,
    explanation: null, points: "1", difficulty: null,
  }]));
  const result = await generateQuiz(lesson, settings);
  assert.equal(result.questions[0].answerKey, "Solar energy");
  assert.equal(result.questions[0].points, 1);
  assert.equal(result.questions[0].explanation, "");
  assert.equal(primary.mock.callCount(), 1);
  assert.equal(fallback.mock.callCount(), 0);
});

test("28 mixed questions normalize compatible representations without fallback", async () => {
  const questions = [];
  for (let index = 0; index < 10; index += 1) questions.push({ ...question,
    text: `Which renewable energy source comes from sunlight in example ${index}?`,
    correctAnswer: `Solar energy example ${index}`,
    distractors: [`Wind energy example ${index}`, `Hydro energy example ${index}`, `Geothermal energy example ${index}`],
    answerKey: undefined, choices: null, points: "1",
  });
  for (let index = 0; index < 10; index += 1) questions.push({ ...question,
    type: "true_false", text: `Wind turbines convert wind energy into electricity in example ${index}.`,
    answerKey: true, correctAnswer: null, choices: null, distractors: null,
  });
  for (let index = 0; index < 5; index += 1) questions.push({ ...question,
    type: "identification", text: `Which energy source comes from moving water in example ${index}?`,
    answerKey: "Hydro energy", correctAnswer: null, choices: null, distractors: null, acceptableAnswers: null,
  });
  for (let index = 0; index < 3; index += 1) questions.push({ ...question,
    type: "essay", text: `Compare solar energy and wind energy conversion in example ${index}.`,
    answerKey: "Solar panels and wind turbines convert renewable energy into electricity.",
    suggestedAnswer: undefined, correctAnswer: null, choices: null, distractors: null,
    rubric: { keyPoints: ["Solar panels convert sunlight.", "Wind turbines convert wind energy."], criteria: null, contentAccuracy: "40", understanding: "30", organization: "20", grammarClarity: "10" },
  });
  primary.mock.mockImplementation(async () => complete(questions));
  const result = await generateQuiz(lesson, { difficulty: "medium", counts: { multiple_choice: 10, true_false: 10, identification: 5, essay: 3 } });
  assert.equal(result.questions.length, 28);
  assert.equal(result.questions.filter((item) => item.type === "essay").length, 3);
  assert.equal(result.questions.find((item) => item.type === "essay").rubric.contentAccuracy, 40);
  assert.equal(result.questions.find((item) => item.type === "true_false").answerKey, "True");
  assert.equal(primary.mock.callCount(), 1);
  assert.equal(fallback.mock.callCount(), 0);
});

test("validation diagnostics and recovery identify fields without generated values", async () => {
  primary.mock.mockImplementationOnce(async () => complete([{ ...question, sourceEvidence: null }]));
  await generateQuiz(lesson, settings);
  const failed = console.info.mock.calls.map((call) => call.arguments[1]).find((record) => record.event === "provider_failed");
  assert.equal(failed.validation.stage, "structure");
  assert.deepEqual(failed.validation.issues, [{ path: "questions[0].sourceEvidence", rule: "required_lesson_evidence" }]);
  assert.equal(JSON.stringify(failed.validation).includes(lesson), false);
  assert.match(primary.mock.calls[1].arguments[0].messages.at(-1).content, /questions\[0\]\.sourceEvidence/);
});

for (const details of [{ code: "credit_balance_exhausted" }, { code: "insufficient_quota" }, { error: { type: "insufficient_quota" } }]) {
  test(`OpenAI quota exhaustion is returned clearly: ${JSON.stringify(details)}`, async () => {
    primary.mock.mockImplementation(async () => complete([]));
    fallback.mock.mockImplementation(async () => { throw Object.assign(failure(429), details); });
    await assert.rejects(generateQuiz(lesson, settings), (error) => {
      assert.equal(error.code, "AI_FALLBACK_QUOTA_EXHAUSTED");
      assert.equal(error.status, 503);
      assert.match(error.message, /OpenAI fallback has exhausted its API credit or quota/);
      assert.equal(error.cause.cause.errors.length, 2);
      return true;
    });
    const record = console.info.mock.calls.map((call) => call.arguments[1]).find((item) => item.event === "provider_failed" && item.provider === "openai");
    assert.equal(record.category, "quota");
    assert.equal(fallback.mock.callCount(), 1);
  });
}

test("invalid input and invalid timeout configuration cause no provider calls", async () => {
  await assert.rejects(generateQuiz(lesson, { counts: { multiple_choice: -1, true_false: 1 } }), { status: 400 });
  await assert.rejects(generateQuiz(lesson, { counts: { multiple_choice: 1.5 } }), { status: 400 });
  await assert.rejects(generateQuiz(lesson, { ...settings, difficulty: "invalid" }), { status: 400 });
  process.env.AI_QUIZ_REQUEST_TIMEOUT_MS = "invalid";
  await assert.rejects(generateQuiz(lesson, settings), { code: "AI_CONFIGURATION_INVALID" });
  assert.equal(primary.mock.callCount(), 0);
});

test("HTTP generation extracts an upload once through fallback and returns the existing draft contract", async () => {
  const db = persistenceMocks();
  const documents = require("../services/documentProcessingService");
  const extraction = mock.method(documents, "processUploadedDocument", async () => ({ text: lesson, metadata: { source: "pdf" } }));
  delete require.cache[require.resolve("../controllers/aiController")];
  const { generateQuizFromContent } = require("../controllers/aiController");
  primary.mock.mockImplementation(async () => { throw failure(429); });
  const req = Object.assign(new EventEmitter(), { body: db.args.body, user: { _id: db.args.teacherId }, file: { originalname: "lesson.pdf" } });
  const res = Object.assign(new EventEmitter(), {
    status(value) { this.statusCode = value; return this; },
    json(value) { this.payload = value; this.writableEnded = true; return this; },
  });
  await generateQuizFromContent(req, res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.payload.cached, false);
  assert.equal(res.payload.questions.length, 1);
  assert.equal(res.payload.review.aiStatus, "openai_generated");
  assert.equal(extraction.mock.callCount(), 1);
  assert.equal(db.analysisSpy.mock.callCount(), 1);
  assert.equal(db.create.mock.callCount(), 1);
  assert.equal(db.create.mock.calls[0].arguments[0].status, "draft");
  assert.equal(db.create.mock.calls[0].arguments[0].isPublished, false);
  assert.equal(req.listenerCount("aborted"), 0);
  assert.equal(res.listenerCount("close"), 0);
});

test("HTTP both-provider failure returns a displayable error and performs no writes", async () => {
  const db = persistenceMocks();
  delete require.cache[require.resolve("../controllers/aiController")];
  const { generateQuizFromContent } = require("../controllers/aiController");
  primary.mock.mockImplementation(async () => { throw failure(429); });
  fallback.mock.mockImplementation(async () => { throw failure(503); });
  const req = Object.assign(new EventEmitter(), { body: { ...db.args.body, content: lesson }, user: { _id: db.args.teacherId } });
  const res = Object.assign(new EventEmitter(), {
    status(value) { this.statusCode = value; return this; },
    json(value) { this.payload = value; this.writableEnded = true; return this; },
  });
  await generateQuizFromContent(req, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.payload.code, "AI_PROVIDERS_FAILED");
  assert.equal(typeof res.payload.message, "string");
  assert.deepEqual(Object.keys(res.payload), ["message", "code"]);
  assert.equal(db.create.mock.callCount(), 0);
  assert.equal(db.insert.mock.callCount(), 0);
});

test("provider policy errors without a code cannot trigger fallback", async () => {
  primary.mock.mockImplementation(async () => { throw Object.assign(new Error("Blocked by content policy"), { status: 503 }); });
  await assert.rejects(generateQuiz(lesson, settings));
  assert.equal(fallback.mock.callCount(), 0);
});

function persistenceMocks() {
  const Assessment = require("../models/Assessment");
  const Question = require("../models/Question");
  const subjects = require("../utils/subjectReference");
  const analysisService = require("../services/lessonAnalysisService");
  mock.method(subjects, "findTeacherSubject", async () => ({ _id: "507f1f77bcf86cd799439012", name: "Science" }));
  const analysisSpy = mock.method(analysisService, "analyzeLesson", analyzeLesson);
  const save = mock.fn(async () => {});
  const create = mock.method(Assessment, "create", async (data) => ({ ...data, _id: "draft-1", save }));
  const insert = mock.method(Question, "insertMany", async (items) => items.map((item, index) => ({ ...item, _id: `question-${index}` })));
  delete require.cache[require.resolve("../services/quizGenerationService")];
  const { generateQuizDraft } = require("../services/quizGenerationService");
  const args = { body: { title: "Energy", subjectRef: "507f1f77bcf86cd799439012", dueDate: "2026-11-01", assessmentType: "quiz", multipleChoiceCount: 1 }, teacherId: "507f1f77bcf86cd799439011", cleanedContent: lesson, sourceMetadata: { source: "text" } };
  return { create, insert, save, analysisSpy, generateQuizDraft, args };
}

test("failed provider requests create no assessment or questions", async () => {
  const db = persistenceMocks();
  primary.mock.mockImplementation(async () => { throw failure(429); });
  fallback.mock.mockImplementation(async () => { throw failure(503); });
  await assert.rejects(db.generateQuizDraft(db.args), { code: "AI_PROVIDERS_FAILED" });
  assert.equal(db.create.mock.callCount(), 0);
  assert.equal(db.insert.mock.callCount(), 0);
});

test("fallback and simultaneous duplicate requests analyze once and save one draft", async () => {
  const db = persistenceMocks();
  primary.mock.mockImplementation(async () => { throw failure(429); });
  const [first, second] = await Promise.all([db.generateQuizDraft(db.args), db.generateQuizDraft(db.args)]);
  assert.equal(first.assessment._id, second.assessment._id);
  assert.equal(db.analysisSpy.mock.callCount(), 1);
  assert.equal(db.create.mock.callCount(), 1);
  assert.equal(db.insert.mock.callCount(), 1);
  assert.equal(db.save.mock.callCount(), 1);
  assert.equal(fallback.mock.callCount(), 1);
});

test("cancelling the last waiter aborts generation and prevents draft writes", async () => {
  const db = persistenceMocks();
  const controller = new AbortController();
  primary.mock.mockImplementation(async () => {
    controller.abort(aiError("AI_REQUEST_CANCELLED", 499));
    return new Promise(() => {});
  });
  await assert.rejects(db.generateQuizDraft({ ...db.args, signal: controller.signal }), { code: "AI_REQUEST_CANCELLED" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fallback.mock.callCount(), 0);
  assert.equal(db.create.mock.callCount(), 0);
});

test("one cancelled duplicate waiter does not cancel an active waiter", async () => {
  const db = persistenceMocks();
  const controller = new AbortController();
  primary.mock.mockImplementation(async () => {
    controller.abort(aiError("AI_REQUEST_CANCELLED", 499));
    return complete();
  });
  const first = db.generateQuizDraft({ ...db.args, signal: controller.signal });
  const second = db.generateQuizDraft(db.args);
  await assert.rejects(first, { code: "AI_REQUEST_CANCELLED" });
  assert.equal((await second).assessment._id, "draft-1");
  assert.equal(db.create.mock.callCount(), 1);
});

test("compact strict schema assigns exact counts to four question-type groups", () => {
  const schema = buildQuizOutputSchema({ multiple_choice: 10, true_false: 10, identification: 5, essay: 3 }, "hard").json_schema.schema;
  const slots = schema.properties.questions;
  assert.equal(slots.required.length, 4);
  assert.equal(slots.additionalProperties, false);
  assert.deepEqual(slots.required, Object.keys(slots.properties));
  const assigned = Object.values(slots.properties).reduce((result, value) => {
    const type = value.items.$ref.split("/").at(-1);
    assert.equal(value.minItems, value.maxItems);
    result[type] = value.minItems;
    return result;
  }, {});
  assert.deepEqual(assigned, { multiple_choice: 10, true_false: 10, identification: 5, essay: 3 });
  for (const definition of Object.values(schema.$defs)) {
    assert.equal(definition.additionalProperties, false);
    assert.deepEqual(definition.required, Object.keys(definition.properties));
    assert.deepEqual(definition.properties.difficulty.enum, ["hard"]);
  }
  assert.deepEqual(schema.$defs.true_false.properties.answerKey.enum, ["True", "False"]);
  assert.deepEqual(schema.$defs.multiple_choice.properties.distractors.required, ["distractor_1", "distractor_2", "distractor_3"]);
  assert.equal(schema.$defs.essay.properties.rubric.additionalProperties, false);
});

test("strict response adapter rejects missing/extra slots and preserves refusals and truncation", () => {
  const format = buildQuizOutputSchema({ multiple_choice: 1 });
  const strictResponse = (questions) => ({ ...complete(), choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ questions }) } }] });
  const nativeQuestion = { ...question, distractors: { distractor_1: "Wind energy", distractor_2: "Hydro energy", distractor_3: "Geothermal energy" } };
  const valid = strictResponse({ multiple_choice: [nativeQuestion] });
  const adapted = adaptStrictQuizResponse(valid, format);
  assert.deepEqual(JSON.parse(adapted.choices[0].message.content).questions, [question]);
  assert.deepEqual(adapted.usage, valid.usage);
  const untyped = strictResponse({ multiple_choice: [{ ...nativeQuestion, type: undefined }] });
  assert.equal(JSON.parse(adaptStrictQuizResponse(untyped, format).choices[0].message.content).questions[0].type, "multiple_choice");
  assert.equal(JSON.parse(adaptStrictQuizResponse(strictResponse({ multiple_choice: [] }), format, true).choices[0].message.content).questions.length, 0);
  const invalidDistractors = strictResponse({ multiple_choice: [{ ...nativeQuestion, distractors: { distractor_1: "Wind energy" } }] });
  assert.equal(Array.isArray(JSON.parse(adaptStrictQuizResponse(invalidDistractors, format).choices[0].message.content).questions[0].distractors), false);
  for (const response of [strictResponse({}), strictResponse({ multiple_choice: [question], essay: [question] }), strictResponse({ multiple_choice: [question, question] }),
    { ...valid, choices: [{ ...valid.choices[0], finish_reason: "length" }] },
    { ...valid, choices: [{ ...valid.choices[0], message: { ...valid.choices[0].message, refusal: "blocked" } }] }]) {
    assert.equal(adaptStrictQuizResponse(response, format), response);
  }
});

test("field diagnostics remain readable under the default Node console depth", async () => {
  const { inspect } = require("node:util");
  primary.mock.mockImplementationOnce(async () => complete([{ ...question, sourceEvidence: null }]));
  await generateQuiz(lesson, settings);
  const failed = console.info.mock.calls.map((call) => call.arguments[1]).find((record) => record.event === "provider_failed");
  assert.match(inspect(failed), /questions\[0\]\.sourceEvidence: required_lesson_evidence/);
});

test("SDK clients send strict Groq schema and isolated keys/endpoints without real API calls", async () => {
  primary.mock.restore();
  fallback.mock.restore();
  process.env.GROQ_API_KEY = "mock-groq-key";
  process.env.OPENAI_API_KEY = "mock-openai-key";
  process.env.GROQ_MODEL = "openai/gpt-oss-20b";
  process.env.OPENAI_MODEL = "gpt-4o-mini";
  process.env.OPENAI_BASE_URL = "https://wrong-endpoint.invalid";
  process.env.OPENAI_ORG_ID = "openai-only-org";
  const calls = [];
  let nextError;
  mock.method(globalThis, "fetch", async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url: String(url), headers: new Headers(options.headers), body });
    if (nextError) {
      const error = nextError;
      nextError = undefined;
      return new Response(JSON.stringify({ error }), { status: 400, headers: { "content-type": "application/json" } });
    }
    const response = complete();
    if (body.response_format.type === "json_schema") response.choices[0].message.content = JSON.stringify({ questions: { multiple_choice: [{ ...question, distractors: { distractor_1: "Wind energy", distractor_2: "Hydro energy", distractor_3: "Geothermal energy" } }] } });
    return new Response(JSON.stringify(response), { status: 200, headers: { "content-type": "application/json" } });
  });
  const controller = new AbortController();
  const payload = { messages: [{ role: "user", content: "Return JSON." }], response_format: { type: "json_object" }, max_completion_tokens: 1000 };
  const context = { signal: controller.signal, timeoutMs: 1000, singleAttempt: true, questionCounts: { multiple_choice: 1 }, difficulty: "medium" };
  const response = await groq.createCompletion(payload, context);
  await openai.createCompletion(payload, context);
  assert.equal(calls[0].url, "https://api.groq.com/openai/v1/chat/completions");
  assert.equal(calls[0].headers.get("authorization"), "Bearer mock-groq-key");
  assert.equal(calls[0].headers.get("openai-organization"), null);
  assert.equal(calls[0].body.model, "openai/gpt-oss-20b");
  assert.equal(calls[0].body.reasoning_effort, "low");
  assert.equal(calls[0].body.response_format.type, "json_schema");
  assert.equal(calls[0].body.response_format.json_schema.strict, true);
  assert.deepEqual(JSON.parse(response.choices[0].message.content).questions, [question]);
  assert.equal(calls[1].url, "https://api.openai.com/v1/chat/completions");
  assert.equal(calls[1].headers.get("authorization"), "Bearer mock-openai-key");
  assert.equal(calls[1].body.model, "gpt-4o-mini");
  assert.equal(calls[1].body.reasoning_effort, undefined);
  assert.equal(calls[1].body.response_format.type, "json_object");
  await groq.createCompletion(payload, { ...context, groqOutputMode: "json_object" });
  assert.equal(calls[2].body.response_format.type, "json_object");
  assert.equal(calls[2].body.messages.length, payload.messages.length);
  process.env.GROQ_MODEL = "llama-3.3-70b-versatile";
  await groq.createCompletion(payload, context);
  assert.equal(calls[3].body.response_format.type, "json_object");
  assert.equal(calls[3].body.reasoning_effort, undefined);
  process.env.GROQ_MODEL = "openai/gpt-oss-20b";
  nextError = { code: "json_validate_failed", message: "Generated JSON does not match schema", failed_generation: JSON.stringify({ questions: { multiple_choice: [{ ...question, type: undefined, distractors: { distractor_1: "Wind energy", distractor_2: "Hydro energy", distractor_3: "Geothermal energy" } }] } }) };
  const candidate = await groq.createCompletion(payload, context);
  assert.deepEqual(JSON.parse(candidate.choices[0].message.content).questions, [question]);
  assert.equal(candidate.usageUnavailable, true);
  nextError = { code: "json_validate_failed", message: "Generated JSON does not match schema", failed_generation: "{" };
  await assert.rejects(groq.createCompletion(payload, context), { status: 400, code: "json_validate_failed" });
  nextError = { code: "json_validate_failed", message: "Generated JSON does not match schema", failed_generation: JSON.stringify({ refusal: "blocked", questions: [] }) };
  await assert.rejects(groq.createCompletion(payload, context), { code: "AI_CONTENT_POLICY" });
});
