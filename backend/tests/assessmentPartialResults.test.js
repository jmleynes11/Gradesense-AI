const { test, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const Assessment = require("../models/Assessment");
const AssessmentSession = require("../models/AssessmentSession");
const Submission = require("../models/Submission");
const Subject = require("../models/Subject");
const Feedback = require("../models/Feedback");
const AuditLog = require("../models/AuditLog");
const groq = require("../services/groqService");
const controller = require("../controllers/submissionController");
const grading = require("../services/submissionGrading");
const { refreshSavedTotals } = require("../services/submissionResults");
const { summarizeSubmission } = require("../services/submissionService");
const overall = require("../services/overallAssessmentFeedback");
const { mockNotificationWrites } = require("./helpers/notifications");
const { question: essay, lessonContent, cases } = require("../utils/essayGradingCases");

const assessmentId = "507f1f77bcf86cd799439011";
const studentId = "507f1f77bcf86cd799439012";
const submissionId = "507f1f77bcf86cd799439013";
const teacherId = "507f1f77bcf86cd799439015";
const essayQuestion = { ...essay, _id: "507f1f77bcf86cd799439014" };
const secondEssay = { ...essay, _id: "507f1f77bcf86cd799439017", text: `${essay.text} Explain with examples.` };
const mc = { _id: "507f1f77bcf86cd799439018", type: "multiple_choice", text: "Choose", answerKey: "A", points: 3 };
const tf = { _id: "507f1f77bcf86cd799439019", type: "true_false", text: "True or false", answerKey: "False", points: 2 };
const savedEnv = { ...process.env };

afterEach(() => {
  mock.restoreAll();
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
});

function response() { return { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } }; }
function query(value, populate = () => {}) {
  const result = { then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } };
  result.populate = (path) => { populate(path); return result; };
  for (const method of ["select", "lean", "sort", "limit"]) result[method] = () => result;
  return result;
}

// Exercise real controllers, grading, Mongoose schemas and serialization with a
// deterministic persistence adapter; providers and MongoDB I/O are stubbed.
function store(questions) {
  const assessment = { _id: assessmentId, teacher: teacherId, title: "Weighted assessment", subject: "Science",
    subjectRef: assessmentId, status: "published", questions, totalPoints: 999, lessonContent };
  let saved;
  const read = () => new Submission(saved.toObject());
  function matches(filter) {
    if (!saved) return false;
    for (const key of ["status", "aiGradingStatus", "gradingLeaseOwner", "__v"]) {
      if (filter[key] !== undefined && saved[key] !== filter[key]) return false;
    }
    if (filter.updatedAt && +saved.updatedAt !== +filter.updatedAt) return false;
    if (filter.$or && saved.gradingLeaseUntil > new Date()) return false;
    const match = filter.answers?.$elemMatch;
    if (match && !saved.answers.some((answer) => String(answer.question) === String(match.question) && answer.aiStatus === match.aiStatus)) return false;
    return true;
  }
  function apply(filter, update) {
    const question = filter.answers?.$elemMatch?.question || filter["answers.question"];
    for (const [key, value] of Object.entries(update.$set || {})) {
      if (key === "answers.$") saved.answers[saved.answers.findIndex((answer) => String(answer.question) === String(question))] = value;
      else saved[key] = value;
    }
    for (const key of Object.keys(update.$unset || {})) saved[key] = undefined;
    for (const [key, value] of Object.entries(update.$inc || {})) saved[key] = (saved[key] || 0) + value;
    saved.updatedAt = new Date(Math.max(Date.now(), +saved.updatedAt + 1));
  }
  mock.method(Assessment, "findById", () => query(assessment));
  mock.method(AssessmentSession, "findOne", async () => ({ startedAt: new Date(), expiresAt: new Date(Date.now() + 60000) }));
  mock.method(Subject, "exists", async () => true);
  mock.method(Submission, "findOne", async () => saved || null);
  mock.method(Submission, "create", async (data) => {
    saved = new Submission({ ...data, _id: submissionId, __v: 0, createdAt: new Date(), updatedAt: new Date() });
    await saved.validate();
    return read();
  });
  mock.method(Submission, "findById", () => {
    const doc = read();
    return query(doc, (path) => {
      if ((path?.path || path) === "assessment") doc.assessment = new Assessment(assessment);
    });
  });
  mock.method(Submission, "find", () => query([]));
  mock.method(Submission, "findOneAndUpdate", async (filter, update) => {
    if (!matches(filter)) return null;
    apply(filter, update);
    return read();
  });
  mock.method(Submission, "findByIdAndUpdate", async (_id, update) => {
    apply({}, update);
    return read();
  });
  mock.method(Submission, "updateOne", async (filter, update) => {
    if (!matches(filter)) return { matchedCount: 0 };
    apply(filter, update);
    return { matchedCount: 1 };
  });
  mock.method(Feedback, "findOneAndUpdate", async () => ({}));
  mock.method(AuditLog, "create", async () => ({}));
  mockNotificationWrites(mock);
  mock.method(grading, "queueSubmissionGrading", () => {});
  mock.method(grading, "publishResult", async () => {});
  mock.method(overall, "queueOverallFeedback", () => ({ status: "waiting_for_grading" }));
  mock.method(console, "info", () => {});
  delete process.env.GROQ_API_KEY;
  delete process.env.OPENAI_API_KEY;
  return {
    read, get saved() { return saved; }, assessment,
    async submit(values) {
      const res = response();
      await controller.submitAssessment({ user: { _id: studentId, role: "student" }, params: { assessmentId },
        body: { answers: questions.map((question, index) => ({ question: question._id, answer: values[index] })) } }, res);
      assert.equal(res.statusCode, 201);
      return res.body;
    },
    async results() {
      const res = response();
      await controller.getSubmission({ user: { _id: studentId, role: "student" }, params: { id: submissionId } }, res);
      assert.equal(res.statusCode, undefined);
      return res.body;
    },
    async review(questionId, finalScore, teacherFeedback = "Teacher feedback") {
      const res = response();
      await controller.updateAnswerOverride({ user: { _id: teacherId, role: "teacher" }, params: { id: submissionId, questionId },
        body: { finalScore, teacherFeedback } }, res);
      assert.equal(res.statusCode, undefined);
      return res.body;
    },
  };
}

function completion(scores = [3, 3, 4]) {
  const total = scores.reduce((sum, value) => sum + value, 0);
  return { choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
    criteria: scores.map((score) => ({ score, feedback: "Checked against lesson evidence.", evidence: score ? [cases[0].answer] : [] })),
    overallFeedback: "Evaluated against lesson concepts.", hasCreditworthyContent: total > 0,
    strengths: total ? ["Correct concepts."] : [], weaknesses: total < 10 ? ["Missing concepts."] : [],
    missingOrIncorrectConcepts: total < 10 ? ["Missing concepts."] : [], suggestions: total < 10 ? ["Review missing concepts."] : [],
  }) } }] };
}

for (const [label, question, values, expected] of [["multiple-choice", mc, ["A", "B"], 3], ["True/False", tf, [false, "True"], 2]]) {
  test(`${label}-only submission persists weighted objective scores immediately`, async () => {
    const db = store([question, { ...question, _id: secondEssay._id, points: 7 }]);
    const result = await db.submit(values);
    assert.equal(result.status, "graded");
    assert.equal(result.score, expected);
    assert.equal(result.finalScore, expected);
    assert.equal(result.totalPossiblePoints, question.points + 7);
    assert.equal(result.finalPercentage, expected / (question.points + 7) * 100);
    assert.equal(result.pendingQuestionCount, 0);
    assert.deepEqual(result.answers.map((answer) => answer.aiStatus), ["not_applicable", "not_applicable"]);
    assert.deepEqual((await db.results()).answers.map((answer) => answer.answer), values.map(String));
  });
}

test("essay-only assessment with AI available saves final scores and feedback", async () => {
  const db = store([essayQuestion]);
  await db.submit([cases[0].answer]);
  process.env.GROQ_API_KEY = "test-key";
  mock.method(groq, "createCompletion", async () => completion());
  await grading.processSubmission(submissionId);
  const result = await db.results();
  assert.equal(result.status, "graded");
  assert.equal(result.finalScore, 10);
  assert.equal(result.finalPercentage, 100);
  assert.match(result.answers[0].feedback, /lesson/);
  assert.equal(result.answers[0].answer, cases[0].answer);
});

test("essay-only assessment with no AI preserves answers and never fabricates a score", async () => {
  const db = store([essayQuestion]);
  await db.submit([cases[0].answer]);
  await grading.processSubmission(submissionId);
  const result = await db.results();
  const display = await import("../../client/src/services/gradeDisplay.js");
  assert.equal(result.status, "submitted");
  assert.equal(result.aiGradingStatus, "pending_review");
  assert.equal(result.gradedQuestionCount, 0);
  assert.equal(result.gradedPointsEarned, null);
  assert.equal(result.finalScore, null);
  assert.equal(result.percentage, null);
  assert.equal(result.answers[0].answer, cases[0].answer);
  assert.equal(result.answers[0].score, null);
  assert.equal(display.displayScore(result), "Pending teacher review");
  assert.doesNotMatch(display.displayPercentage(result), /%/);
});

test("mixed submission exposes objective points before AI and after failed grading and refresh", async () => {
  const db = store([mc, tf, essayQuestion]);
  const initial = await db.submit(["A", "True", cases[0].answer]);
  const display = await import("../../client/src/services/gradeDisplay.js");
  assert.equal(initial.gradedPointsEarned, 3);
  assert.equal(initial.gradedPossiblePoints, 5);
  assert.equal(initial.gradedQuestionCount, 2);
  assert.equal(initial.pendingQuestionCount, 1);
  assert.equal(initial.totalPossiblePoints, 15);
  assert.equal(initial.finalScore, null);
  assert.equal(display.displayScore(initial), "3/5 (Partial Result)");
  await grading.processSubmission(submissionId);
  for (let refresh = 0; refresh < 2; refresh++) {
    const result = await db.results();
    assert.equal(display.displayScore(result), "3/5 (Partial Result)");
    assert.equal(result.answers[2].aiStatus, "pending_review");
    assert.equal(result.answers[2].answer, cases[0].answer);
    assert.equal(result.answers[2].finalScore, null);
    assert.equal(result.finalPercentage, null);
    assert.doesNotMatch(display.displayPercentage(result), /%/);
  }
});

test("teacher review recalculates partial and final totals and persists feedback through refresh", async () => {
  const db = store([mc, essayQuestion, secondEssay]);
  await db.submit(["A", cases[0].answer, cases[0].answer]);
  await grading.processSubmission(submissionId);
  await db.review(essayQuestion._id, 7, "Add examples.");
  const partial = await db.results();
  assert.equal(partial.status, "submitted");
  assert.equal(partial.gradedPointsEarned, 10);
  assert.equal(partial.gradedPossiblePoints, 13);
  assert.equal(partial.pendingQuestionCount, 1);
  assert.equal(partial.finalScore, null);
  assert.equal(partial.finalPercentage, null);
  assert.equal(partial.answers[1].aiStatus, "teacher_reviewed");
  await db.review(secondEssay._id, 9, "Good reasoning.");
  for (let refresh = 0; refresh < 2; refresh++) {
    const result = await db.results();
    assert.equal(result.status, "graded");
    assert.equal(result.finalScore, 19);
    assert.equal(result.totalPossiblePoints, 23);
    assert.equal(result.finalPercentage, 19 / 23 * 100);
    assert.equal(result.pendingQuestionCount, 0);
    assert.equal(result.answers[1].teacherFeedback, "Add examples.");
    assert.equal(result.answers[2].teacherFeedback, "Good reasoning.");
    assert.deepEqual(result.answers.map((answer) => answer.answer), ["A", cases[0].answer, cases[0].answer]);
  }
});

test("failure of one essay does not prevent a later essay from being graded", async () => {
  const db = store([mc, essayQuestion, secondEssay]);
  await db.submit(["A", cases[0].answer, cases[0].answer]);
  process.env.GROQ_API_KEY = "test-key";
  mock.method(groq, "createCompletion", async (payload) => {
    if (JSON.parse(payload.messages[1].content).question === essayQuestion.text) throw new Error("Service unavailable");
    return completion();
  });
  await grading.processSubmission(submissionId);
  const result = await db.results();
  assert.equal(result.answers[1].aiStatus, "pending_review");
  assert.equal(result.answers[2].aiStatus, "graded");
  assert.equal(result.gradedPointsEarned, 13);
  assert.equal(result.gradedPossiblePoints, 13);
  assert.equal(result.pendingQuestionCount, 1);
  assert.equal(result.finalScore, null);
});

for (const providerFails of [true, false]) {
  test(`teacher grade survives a concurrent ${providerFails ? "failed" : "successful"} AI request and other essays continue`, async () => {
    const db = store([essayQuestion, secondEssay]);
    await db.submit([cases[0].answer, cases[0].answer]);
    process.env.GROQ_API_KEY = "test-key";
    let reviewed = false;
    mock.method(groq, "createCompletion", async () => {
      if (!reviewed) {
        reviewed = true;
        await db.review(essayQuestion._id, 7, "Teacher is authoritative.");
        if (providerFails) throw new Error("Unavailable after teacher review");
      }
      return completion();
    });
    await grading.processSubmission(submissionId);
    const result = await db.results();
    assert.equal(result.answers[0].score, 7);
    assert.equal(result.answers[0].teacherFeedback, "Teacher is authoritative.");
    assert.equal(result.answers[0].aiStatus, "teacher_reviewed");
    assert.equal(result.answers[1].aiStatus, "graded");
    assert.equal(result.status, "graded");
    assert.equal(result.finalScore, 17);
  });
}

test("teacher review retries concurrent writes and includes the other newly graded essay", async () => {
  const db = store([essayQuestion, secondEssay]);
  await db.submit([cases[0].answer, cases[0].answer]);
  const update = Submission.updateOne;
  let raced = false;
  mock.method(Submission, "updateOne", async (filter, changes) => {
    if (!raced && changes.$set["answers.$"]?.aiStatus === "teacher_reviewed") {
      raced = true;
      db.saved.answers[1].score = db.saved.answers[1].finalScore = 6;
      db.saved.answers[1].aiStatus = "graded";
      db.saved.__v += 1;
      // Deliberately keep the same timestamp: version guards must catch this.
    }
    return update(filter, changes);
  });
  await db.review(essayQuestion._id, 8);
  assert.equal(db.read().finalScore, 14);
  assert.equal(db.read().status, "graded");
});

test("older pending results are repaired on read without overwriting a concurrent teacher edit", async () => {
  const db = store([mc, essayQuestion]);
  await db.submit(["A", cases[0].answer]);
  db.saved.gradedPointsEarned = null;
  db.saved.gradedQuestionCount = 0;
  db.saved.totalPossiblePoints = 999;
  const stale = db.read();
  const result = await db.results();
  assert.equal(result.gradedPointsEarned, 3);
  assert.equal(db.read().totalPossiblePoints, 13);
  await db.review(essayQuestion._id, 8);
  assert.equal(await refreshSavedTotals(stale), false);
  assert.equal(db.read().finalScore, 11);
});

test("results expose each successfully graded essay while another AI request is still running", async () => {
  const db = store([essayQuestion, secondEssay]);
  await db.submit([cases[0].answer, cases[0].answer]);
  process.env.GROQ_API_KEY = "test-key";
  let calls = 0;
  mock.method(groq, "createCompletion", async () => {
    if (++calls === 2) {
      const partial = await db.results();
      assert.equal(partial.gradedPointsEarned, 10);
      assert.equal(partial.gradedPossiblePoints, 10);
      assert.equal(partial.pendingQuestionCount, 1);
      assert.equal(partial.finalPercentage, null);
    }
    return completion();
  });
  await grading.processSubmission(submissionId);
  assert.equal(db.read().finalScore, 20);
});

test("worker finalization cannot overwrite a teacher grade saved after the last AI answer", async () => {
  const db = store([essayQuestion, secondEssay]);
  await db.submit([cases[0].answer, cases[0].answer]);
  process.env.GROQ_API_KEY = "test-key";
  mock.method(groq, "createCompletion", async () => completion());
  const update = Submission.updateOne;
  let raced = false;
  mock.method(Submission, "updateOne", async (filter, changes) => {
    if (!raced && changes.$set.aiScore === 20) {
      raced = true;
      await db.review(essayQuestion._id, 2, "Teacher correction.");
    }
    return update(filter, changes);
  });
  await grading.processSubmission(submissionId);
  const final = await db.results();
  assert.equal(final.finalScore, 12);
  assert.equal(final.answers[0].score, 2);
  assert.equal(final.answers[0].teacherFeedback, "Teacher correction.");
});

test("a total override cannot finalize pending questions and final overrides use actual points", async () => {
  const db = store([mc, essayQuestion]);
  await db.submit(["A", cases[0].answer]);
  const request = { user: { _id: teacherId, role: "teacher" }, params: { id: submissionId }, body: { score: 10, percentage: 99 } };
  const pending = response();
  await controller.overrideScore(request, pending);
  assert.equal(pending.statusCode, 400);
  assert.equal(db.read().finalScore, null);
  await db.review(essayQuestion._id, 8);
  const final = response();
  await controller.overrideScore(request, final);
  assert.equal(final.body.finalScore, 10);
  assert.equal(final.body.finalPercentage, 10 / 13 * 100);
  assert.equal((await db.results()).finalScore, 10);
});

test("an empty teacher score is rejected without converting the pending essay to zero", async () => {
  const db = store([essayQuestion]);
  await db.submit([cases[0].answer]);
  for (const finalScore of [null, undefined, "", " ", "invalid"]) {
    const res = response();
    await controller.updateAnswerOverride({ user: { _id: teacherId, role: "teacher" }, params: { id: submissionId, questionId: essayQuestion._id },
      body: { finalScore } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(db.read().answers[0].score, null);
    assert.equal(db.read().status, "submitted");
  }
});

test("missing, failed, and null grades remain pending; earned zero counts as graded", () => {
  const pending = { questionType: "essay", pointsPossible: 10, finalScore: null, score: null, aiStatus: "graded" };
  const earnedZero = { questionType: "multiple_choice", pointsPossible: 2, score: 0, aiStatus: "not_applicable" };
  const totals = summarizeSubmission([earnedZero, pending]);
  assert.equal(totals.finalScore, null);
  assert.equal(totals.gradedPointsEarned, 0);
  assert.equal(totals.gradedPossiblePoints, 2);
  assert.equal(totals.pendingQuestionCount, 1);
  assert.equal(summarizeSubmission([{ ...pending, score: 0, aiStatus: "failed" }]).finalScore, null);
  assert.equal(summarizeSubmission([{ questionType: "true_false", pointsPossible: 2 }]).finalScore, null);
});
