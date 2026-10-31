const { test, beforeEach, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const groq = require("../services/groqService");
const openai = require("../services/openaiService");
const { gradeEssay } = require("../services/aiService");
const { gradeAnswer, summarizeSubmission, summarizeFinalSubmission } = require("../services/submissionService");
const { question, lessonContent, cases } = require("../utils/essayGradingCases");
const { checkEvaluation, compareEquivalentAnswers } = require("../utils/essayEvaluationChecks");
const Submission = require("../models/Submission");
const savedEnv = { ...process.env };
let primary, fallback;
const completion = (scores = [3, 3, 4], maxScore = 10, answer = cases[0].answer) => ({
  choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
    criteria: scores.map((score) => ({ score, feedback: "Evidence assessed against the criterion.", evidence: score > 0 ? [answer.trim()] : [] })),
    overallFeedback: "Evaluated using the supplied matter rubric.",
    hasCreditworthyContent: scores.some((score) => score > 0),
    strengths: scores.some((score) => score > 0) ? ["Correct concepts earn criterion credit."] : [],
    weaknesses: scores.reduce((sum, value) => sum + value, 0) < maxScore ? ["Some concepts are missing or incorrect."] : [],
    missingOrIncorrectConcepts: scores.reduce((sum, value) => sum + value, 0) < maxScore ? ["The response does not meet every criterion."] : [],
    suggestions: scores.reduce((sum, value) => sum + value, 0) < maxScore ? ["Explain the missing or incorrect concepts using the lesson."] : [],
  }) } }], usage: { total_tokens: 123 },
});
const grade = (answer = cases[0].answer) => gradeEssay(question.text, answer, question.rubric, 10, lessonContent);
beforeEach(() => {
  process.env.GROQ_API_KEY = "test-groq";
  process.env.OPENAI_API_KEY = "test-openai";
  process.env.GROQ_ESSAY_REVIEW_MODEL = "openai/gpt-oss-120b";
  delete process.env.AI_ESSAY_LOG_ENCRYPTION_KEY;
  primary = mock.method(groq, "createCompletion", async (payload) => completion(undefined, 10, JSON.parse(payload.messages[1].content).studentAnswer));
  fallback = mock.method(openai, "createCompletion", async (payload) => completion(undefined, 10, JSON.parse(payload.messages[1].content).studentAnswer));
  mock.method(console, "info", () => {});
});
afterEach(() => {
  mock.restoreAll();
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
});

test("real grading path preserves full, partial, and genuine zero rubric results", async () => {
  // These test score propagation, not model judgment. Live diagnostic tests semantics.
  for (const [sample, scores, expected] of [[cases[0], [3, 3, 4], 10], [cases[1], [3, 3, 4], 10],
    [cases[2], [3, 0, 0], 3], [cases[3], [0, 0, 0], 0], [cases[4], [0, 0, 0], 0]]) {
    primary.mock.mockImplementation(async () => completion(scores, 10, sample.answer));
    const answer = await gradeAnswer(question, sample.answer, { lessonContent,
      Submission: { find: () => ({ populate: async () => [] }) } });
    assert.equal(answer.score, expected);
    assert.equal(answer.aiScore, expected);
    assert.equal(answer.finalScore, expected);
    assert.equal(answer.aiStatus, "graded");
    const totals = summarizeSubmission([answer], { questions: [question] });
    assert.equal(totals.score, expected);
    assert.equal(totals.percentage, expected * 10);
  }
  assert.equal(fallback.mock.callCount(), 0);
  const payload = JSON.parse(primary.mock.calls[0].arguments[0].messages[1].content);
  assert.equal(payload.studentAnswer, cases[0].answer);
  assert.equal(payload.suggestedAnswer, question.suggestedAnswer);
  assert.equal(payload.lessonContext, lessonContent);
});

const fixtureScores = {
  correct: [3, 3, 4], paraphrased_correct: [3, 3, 4], partial: [3, 0, 0], incorrect: [0, 0, 0],
  irrelevant: [0, 0, 0], blank: [0, 0, 0], minor_omission: [3, 2, 4],
  mostly_correct_missing_details: [2, 2, 3], mixed_correct_and_incorrect: [3, 1, 4],
  faulty_reasoning: [2, 1, 2], one_correct_concept: [1, 0, 0], short_correct: [3, 3, 4], long_with_errors: [2, 2, 2],
};
for (const sample of cases) {
  test(`synthetic ${sample.name}: score propagation and feedback range checks`, async () => {
    // The live diagnostic separately evaluates semantic quality with the real provider.
    primary.mock.mockImplementation(async () => completion(fixtureScores[sample.name], 10, sample.answer));
    const answer = await gradeAnswer(question, sample.answer, { lessonContent,
      Submission: { find: () => ({ populate: async () => [] }) } });
    assert.deepEqual(checkEvaluation(sample, answer, question.points), []);
  });
}

test("invalid output gets one repair before fallback; corrected output is accepted", async () => {
  primary.mock.mockImplementationOnce(async () => ({ choices: [{ finish_reason: "stop", message: { content: "{}" } }] }));
  assert.equal((await grade()).score, 10);
  assert.equal(primary.mock.callCount(), 2);
  assert.equal(fallback.mock.callCount(), 0);
  assert.equal(primary.mock.calls[1].arguments[1].responseFormat.type, "json_object");
  assert.equal(primary.mock.calls[1].arguments[1].model, "openai/gpt-oss-120b");
  const records = console.info.mock.calls.map((call) => JSON.parse(call.arguments[1]));
  assert.ok(records.some((item) => item.event === "provider_retry" && item.validationRule === "criteria_count"));
});

test("a nonblank zero is audited for overlooked partial credit before being finalized", async () => {
  primary.mock.mockImplementationOnce(async () => completion([0, 0, 0]));
  primary.mock.mockImplementation(async (payload) => {
    assert.match(payload.messages.at(-1).content, /Zero-credit audit/);
    return completion([1, 0, 0]);
  });
  const result = await grade();
  assert.equal(result.score, 1);
  assert.equal(primary.mock.callCount(), 2);
  assert.equal(fallback.mock.callCount(), 0);
});

test("an audited irrelevant answer can still earn a genuine zero", async () => {
  primary.mock.mockImplementation(async () => completion([0, 0, 0]));
  assert.equal((await grade(cases[4].answer)).score, 0);
  assert.equal(primary.mock.callCount(), 2);
});

test("zero within a mixed answer is audited for a correct subclaim in that criterion", async () => {
  primary.mock.mockImplementationOnce(async () => {
    const response = completion([3, 0, 4]);
    const parsed = JSON.parse(response.choices[0].message.content);
    parsed.criteria[1].evidence = [cases[0].answer];
    response.choices[0].message.content = JSON.stringify(parsed);
    return response;
  });
  primary.mock.mockImplementation(async () => completion([3, 1, 4]));
  assert.equal((await grade()).score, 8);
  assert.equal(primary.mock.callCount(), 2);
});

test("invented evidence and missing supporting quotes cannot receive credit", async () => {
  for (const evidence of [["The student never wrote this invented fact."], []]) {
    const response = completion();
    const parsed = JSON.parse(response.choices[0].message.content);
    parsed.criteria[0].evidence = evidence;
    response.choices[0].message.content = JSON.stringify(parsed);
    primary.mock.mockImplementation(async () => response);
    fallback.mock.mockImplementation(async () => response);
    assert.equal((await grade()).aiStatus, "pending_review");
  }
});

test("quotation marks and capitalization in real evidence do not discard valid credit", async () => {
  const response = completion();
  const parsed = JSON.parse(response.choices[0].message.content);
  parsed.criteria[0].evidence = ['"SOLIDS KEEP THEIR SHAPE AND VOLUME"'];
  response.choices[0].message.content = JSON.stringify(parsed);
  primary.mock.mockImplementation(async () => response);
  assert.equal((await grade()).score, 10);
  assert.equal(primary.mock.callCount(), 1);
});

test("compatible feedback aliases do not discard an otherwise valid evaluation", async () => {
  const response = completion();
  const parsed = JSON.parse(response.choices[0].message.content);
  parsed.feedback = parsed.overallFeedback;
  delete parsed.overallFeedback;
  response.choices[0].message.content = JSON.stringify(parsed);
  primary.mock.mockImplementation(async () => response);
  assert.equal((await grade()).score, 10);
});

test("historical decimal grades remain readable without migration or rounding", async () => {
  const id = "507f1f77bcf86cd799439011";
  const submission = new Submission({ assessment: id, student: id, score: 7.5, finalScore: 7.5,
    answers: [{ question: id, questionType: "essay", pointsPossible: 10, score: 7.5, aiScore: 7.5, finalScore: 7.5, aiStatus: "graded" }] });
  await submission.validate();
  assert.equal(submission.toObject().answers[0].finalScore, 7.5);
});

test("Groq alone can grade essays without an OpenAI credential", async () => {
  delete process.env.OPENAI_API_KEY;
  assert.equal((await grade()).score, 10);
  assert.equal(fallback.mock.callCount(), 0);
});

test("Groq failure falls back to OpenAI once with bounded request options", async () => {
  primary.mock.mockImplementation(async () => { throw Object.assign(new Error("quota"), { status: 429, code: "rate_limit_exceeded" }); });
  assert.equal((await grade()).score, 10);
  assert.equal(primary.mock.callCount(), 1);
  assert.equal(fallback.mock.callCount(), 1);
  const options = fallback.mock.calls[0].arguments[1];
  assert.equal(options.singleAttempt, true);
  assert.equal(options.timeoutMs, 20000);
  assert.ok(options.signal instanceof AbortSignal);
});

test("missing Groq credentials use OpenAI; missing both remain ungraded", async () => {
  delete process.env.GROQ_API_KEY;
  assert.equal((await grade()).score, 10);
  delete process.env.OPENAI_API_KEY;
  const pending = await grade();
  assert.equal(pending.aiStatus, "pending_review");
  assert.equal(pending.score, null);
  assert.equal(pending.isCorrect, null);
  assert.equal(primary.mock.callCount(), 0);
  assert.equal(fallback.mock.callCount(), 1);
});

test("both provider failures preserve the answer without recording a failing grade", async () => {
  for (const method of [primary, fallback]) method.mock.mockImplementation(async () => { throw new Error("connection failed"); });
  const answer = await gradeAnswer(question, cases[0].answer, { lessonContent, Submission: { find: () => ({ populate: async () => [] }) } });
  assert.equal(answer.answer, cases[0].answer);
  assert.equal(answer.score, null);
  assert.equal(answer.finalScore, null);
  assert.equal(answer.aiScore, undefined);
  assert.equal(answer.isCorrect, undefined);
  const totals = summarizeSubmission([answer], { questions: [question] });
  assert.equal(totals.score, null);
  assert.equal(totals.percentage, null);
  assert.equal(totals.passStatus, "not_applicable");
  const submission = { answers: [answer], ...totals };
  summarizeFinalSubmission(submission);
  assert.equal(submission.status, "submitted");
  answer.aiStatus = "teacher_reviewed";
  answer.finalScore = 8;
  summarizeFinalSubmission(submission);
  assert.equal(submission.status, "graded");
  assert.equal(submission.finalScore, 8);
});

test("blank response is a genuine zero and needs no provider call", async () => {
  const result = await grade("   ");
  assert.equal(result.score, 0);
  assert.equal(result.aiStatus, "graded");
  assert.equal(primary.mock.callCount(), 0);
  assert.equal(fallback.mock.callCount(), 0);
});

test("invalid scores, missing feedback, refusal, truncation, and invalid JSON cannot become zero grades", async () => {
  const responses = [completion([null, 0, 0]), completion(["0", 0, 0]), completion([-1, 0, 0]),
    completion([4, 3, 4]), completion([0.123, 0, 0]), completion([NaN, 0, 0]), completion([Infinity, 0, 0]), completion([]),
    { choices: [{ finish_reason: "stop", message: { content: "{}" } }] },
    { choices: [{ finish_reason: "stop", message: { content: "not json" } }] },
    { choices: [{ finish_reason: "length", message: { content: completion().choices[0].message.content } }] },
    { choices: [{ finish_reason: "stop", message: { refusal: "refused", content: completion().choices[0].message.content } }] }];
  for (const response of responses) {
    primary.mock.mockImplementation(async () => response);
    fallback.mock.mockImplementation(async () => response);
    assert.equal((await grade()).aiStatus, "pending_review");
  }
});

test("legacy string rubrics are preserved and receive default criteria", async () => {
  primary.mock.mockImplementation(async (payload) => {
    const data = JSON.parse(payload.messages[1].content);
    assert.equal(data.rubric, "Mention all three states of matter.");
    assert.equal(data.criteria.reduce((sum, item) => sum + item.maxScore, 0), 5);
    return completion(data.criteria.map((item) => item.maxScore), 5);
  });
  assert.equal((await gradeEssay(question.text, cases[0].answer, "Mention all three states of matter.", 5)).score, 5);
});

test("every whole-number score survives the real grading and storage path", async () => {
  for (const score of Array.from({ length: 11 }, (_, index) => index)) {
    const scores = [Math.min(score, 3), Math.min(Math.max(score - 3, 0), 3), Math.max(score - 6, 0)];
    primary.mock.mockImplementation(async () => completion(scores));
    const answer = await gradeAnswer(question, cases[0].answer, { lessonContent,
      Submission: { find: () => ({ populate: async () => [] }) } });
    assert.equal(answer.score, score);
    assert.equal(answer.finalScore, score);
    assert.equal(summarizeSubmission([answer], { questions: [question] }).score, score);
  }
});

test("rubric allocations scale to integer question totals using whole points", async () => {
  for (const maximum of [3, 5, 7, 10, 20]) {
    primary.mock.mockImplementation(async (payload) => {
      const { criteria, maxScore } = JSON.parse(payload.messages[1].content);
      assert.ok(Math.abs(criteria.reduce((sum, item) => sum + item.maxScore, 0) - maximum) < 1e-8);
      assert.ok(criteria.every((item) => Number.isInteger(item.maxScore)));
      assert.ok(Math.abs(criteria[0].maxScore - maxScore * 0.3) <= 1);
      return completion(criteria.map((item) => item.maxScore), maxScore);
    });
    const result = await gradeEssay(question.text, cases[0].answer, question.rubric, maximum);
    assert.equal(result.score, maximum);
    assert.equal(result.maxScore, maximum);
  }
});

test("low-point essays assess all concepts together without decimal allocations", async () => {
  const rubric = { keyPoints: ["solid", "liquid", "gas"] };
  primary.mock.mockImplementation(async (payload) => {
    const { criteria } = JSON.parse(payload.messages[1].content);
    assert.deepEqual(criteria.map((item) => item.maxScore), [1]);
    for (const concept of rubric.keyPoints) assert.ok(criteria[0].criterion.includes(concept));
    return completion([1], 1, cases[2].answer);
  });
  const result = await gradeEssay(question.text, cases[2].answer, rubric, 1);
  assert.equal(result.score, 1);
});

test("small positive rubric weights retain whole-point criteria", async () => {
  const rubric = { criteria: [
    { criterion: "First concept", points: 0.1 }, { criterion: "Second concept", points: 0.1 }, { criterion: "Third concept", points: 9.8 },
  ] };
  primary.mock.mockImplementation(async (payload) => {
    const { criteria } = JSON.parse(payload.messages[1].content);
    assert.deepEqual(criteria.map((item) => item.maxScore), [1, 1, 8]);
    return completion([1, 1, 8]);
  });
  assert.equal((await gradeEssay(question.text, cases[0].answer, rubric, 10)).score, 10);
});

test("decimal AI scores are rejected rather than rounded into a grade", async () => {
  for (const score of [0.25, 0.5, 1.75, 2.99]) {
    primary.mock.mockImplementation(async () => completion([score, 0, 0]));
    fallback.mock.mockImplementation(async () => completion([score, 0, 0]));
    const result = await grade();
    assert.equal(result.aiStatus, "pending_review");
    assert.equal(result.score, null);
  }
});

test("a decimal provider response can be repaired to a whole-number score", async () => {
  primary.mock.mockImplementationOnce(async () => completion([3, 2.5, 2]));
  primary.mock.mockImplementation(async () => completion([3, 2, 2]));
  assert.equal((await grade()).score, 7);
  assert.equal(fallback.mock.callCount(), 0);
});

test("invalid maximum points fail before any provider request", async () => {
  for (const maximum of [0, -1, Infinity, NaN, "invalid", 0.5, 2.5, 1.234]) {
    await assert.rejects(gradeEssay(question.text, cases[0].answer, question.rubric, maximum), { code: "INVALID_ESSAY_MAX_SCORE" });
  }
  assert.equal(primary.mock.callCount(), 0);
});

test("feedback contradicting earned credit is rejected rather than accepted as zero", async () => {
  const malformed = [];
  for (const change of [
    { hasCreditworthyContent: true, strengths: ["Identifies solid shape correctly."] },
    { suggestions: [] }, { missingOrIncorrectConcepts: [] }, { hasCreditworthyContent: false, strengths: ["A correct concept."] },
  ]) {
    const response = completion([0, 0, 0]);
    const parsed = JSON.parse(response.choices[0].message.content);
    response.choices[0].message.content = JSON.stringify({ ...parsed, ...change });
    malformed.push(response);
  }
  for (const response of malformed) {
    primary.mock.mockImplementation(async () => response);
    fallback.mock.mockImplementation(async () => response);
    assert.equal((await grade()).aiStatus, "pending_review");
  }
});

test("protected content logging encrypts answers, reference, rubric, and feedback without retaining keys", async () => {
  const key = crypto.randomBytes(32);
  process.env.AI_ESSAY_LOG_ENCRYPTION_KEY = key.toString("base64");
  const privateAnswer = "Student alice@example.com says a solid has fixed shape. test-groq";
  await gradeEssay(question.text, privateAnswer, question.rubric, 10, lessonContent,
    { assessmentId: "assessment", questionId: "question", suggestedAnswer: question.suggestedAnswer });
  const records = console.info.mock.calls.map((call) => JSON.parse(call.arguments[1]));
  const serialized = JSON.stringify(records);
  for (const secret of [privateAnswer, "alice@example.com", "test-groq", key.toString("base64"), question.suggestedAnswer]) assert.equal(serialized.includes(secret), false);
  const decrypt = (record) => {
    const content = record.protectedContent;
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(content.iv, "base64"));
    decipher.setAAD(Buffer.from(content.associatedData));
    decipher.setAuthTag(Buffer.from(content.tag, "base64"));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(content.ciphertext, "base64")), decipher.final()]).toString("utf8"));
  };
  const started = records.find((item) => item.event === "grading_started");
  const completed = records.find((item) => item.event === "grading_completed");
  assert.match(decrypt(started).studentAnswer, /alice@example.com/);
  assert.equal(decrypt(started).studentAnswer.includes("test-groq"), false);
  assert.equal(decrypt(started).referenceAnswer, question.suggestedAnswer);
  assert.deepEqual(decrypt(started).criteria, question.rubric.criteria);
  assert.equal(decrypt(completed).score, 10);
  assert.match(decrypt(completed).feedback, /Evaluated/);
});

test("bad logging keys fail closed to redaction without disrupting grading", async () => {
  process.env.AI_ESSAY_LOG_ENCRYPTION_KEY = "invalid";
  assert.equal((await grade()).score, 10);
  const records = console.info.mock.calls.map((call) => JSON.parse(call.arguments[1]));
  assert.equal(records[0].contentLogging, "redacted");
  assert.equal(records[0].protectedContent, undefined);
  assert.equal(records[0].logConfigurationError, "INVALID_LOG_ENCRYPTION_KEY");
});

test("independent diagnostic checks catch missing feedback and divergent equivalent answers", () => {
  const sample = { expectedMin: 9, expectedMax: 10 };
  const evaluation = { aiStatus: "graded", score: 10, rubricBreakdown: { criteria: [{ score: 10, maxScore: 10, feedback: "All required concepts explained." }] },
    feedback: "All concepts correct.", strengths: ["Correct solid, liquid, and gas behavior."], weaknesses: [], missingOrIncorrectConcepts: [], suggestions: [] };
  assert.deepEqual(checkEvaluation(sample, evaluation, 10), []);
  assert.ok(checkEvaluation(sample, { ...evaluation, strengths: [] }, 10).includes("correct_concepts_missing"));
  assert.ok(checkEvaluation(sample, { ...evaluation, missingOrIncorrectConcepts: ["Gas behavior missing."] }, 10).includes("full_marks_with_missing_concepts"));
  const results = ["correct", "paraphrased_correct", "short_correct"].map((name) => ({ name, score: 10, aiStatus: "graded" }));
  assert.ok(compareEquivalentAnswers(results).every((item) => item.passed));
  results[1].score = 7;
  assert.equal(compareEquivalentAnswers(results)[0].passed, false);
});

test("provider timeout includes queue waits and ignores late primary results", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let release;
  primary.mock.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
  const pending = grade();
  await Promise.resolve();
  t.mock.timers.tick(20000);
  assert.equal((await pending).score, 10);
  assert.equal(fallback.mock.callCount(), 1);
  release(completion([0, 0, 0]));
  t.mock.timers.reset();
});

test("real SDK uses the essay schema and review model without changing quiz model selection", async () => {
  primary.mock.restore();
  process.env.GROQ_MODEL = "openai/gpt-oss-20b";
  const requests = [];
  const responses = [completion(), completion([0, 0, 0]), completion([1, 0, 0])];
  const fetch = mock.method(globalThis, "fetch", async (_url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    if (requests.length <= 2) {
      assert.equal(body.response_format.json_schema.name, "essay_evaluation");
      assert.equal(body.response_format.json_schema.strict, true);
      assert.equal(body.response_format.json_schema.schema.properties.criteria.items.properties.score.type, "integer");
      assert.equal(body.response_format.json_schema.schema.properties.criteria.minItems, 3);
    }
    assert.equal(body.reasoning_effort, "medium");
    assert.equal(body.messages.length, requests.length === 3 ? 3 : 2);
    assert.equal(body.messages.some((item) => item.content.includes("exactly three distractors")), false);
    return new Response(JSON.stringify(responses.shift()), { headers: { "content-type": "application/json" } });
  });
  assert.equal((await grade()).score, 10);
  assert.equal(fetch.mock.callCount(), 1);
  assert.equal((await grade()).score, 1);
  assert.deepEqual(requests.slice(1).map((item) => item.model), ["openai/gpt-oss-20b", "openai/gpt-oss-120b"]);
  assert.equal(groq.getModel(), "openai/gpt-oss-20b");
});

test("structured logs include rubric totals and failures without answer text or secrets", async () => {
  primary.mock.mockImplementation(async () => { throw Object.assign(new Error(cases[0].answer), { status: 429, code: "rate_limit_exceeded" }); });
  await grade();
  const serialized = console.info.mock.calls.map((call) => call.arguments.join(" ")).join("\n");
  assert.equal(serialized.includes(cases[0].answer), false);
  assert.equal(serialized.includes("test-groq"), false);
  const records = console.info.mock.calls.map((call) => JSON.parse(call.arguments[1]));
  assert.ok(records.every((item) => typeof item.requestId === "string"));
  assert.ok(records.some((item) => item.event === "provider_failed" && item.status === 429));
  assert.ok(records.some((item) => item.event === "grading_completed" && item.score === 10 && item.criterionScores.length === 3));
});

test("grade display distinguishes genuine zero from pending and old failed evaluations", async () => {
  const { displayScore, displayPercentage } = await import("../../client/src/services/gradeDisplay.js");
  assert.equal(displayScore({ status: "graded", score: 0, totalPossiblePoints: 10 }), "0/10");
  assert.equal(displayPercentage({ status: "graded", percentage: 0 }), "0%");
  assert.equal(displayScore({ status: "submitted", score: null }), "Pending teacher review");
  assert.equal(displayScore({ status: "graded", aiGradingStatus: "pending_review", score: 0 }), "Pending teacher review");
  assert.equal(displayScore({ status: "graded", aiGradingStatus: "pending_review", gradedBy: "teacher", score: 8, totalPossiblePoints: 10 }), "8/10");
});
