const { createHash, randomUUID } = require("node:crypto");
const Submission = require("../models/Submission");
const generation = require("./overallFeedbackGeneration");

const active = new Set();
const leaseMs = 90000;

function feedbackInput(submission, assessment = {}) {
  return {
    title: assessment.title, assessmentType: assessment.assessmentType,
    answerReviewEnabled: assessment.allowAnswerReview !== false,
    score: submission.finalScore ?? submission.score,
    percentage: submission.finalPercentage ?? submission.percentage,
    totalPossiblePoints: submission.totalPossiblePoints,
    teacherComments: submission.teacherComments,
    answers: (submission.answers || []).map((answer) => ({
      id: String(answer.question?._id || answer.question), type: answer.questionType,
      question: answer.questionText, answer: answer.answer, correctAnswer: answer.correctAnswer,
      score: answer.finalScore ?? answer.score, pointsPossible: answer.pointsPossible,
      feedback: answer.feedback, teacherFeedback: answer.teacherFeedback,
      criteria: answer.rubricBreakdown, strengths: answer.strengths,
      weaknesses: answer.weaknesses, suggestions: answer.suggestions,
    })),
  };
}

function readyForFeedback(submission) {
  return submission.status === "graded" && Number.isFinite(submission.finalScore ?? submission.score)
    && Number.isFinite(submission.finalPercentage ?? submission.percentage)
    && submission.totalPossiblePoints > 0 && submission.answers?.length > 0
    && submission.answers.every((answer) => Number.isFinite(answer.finalScore ?? answer.score)
      && !["processing", "pending_review", "failed"].includes(answer.aiStatus));
}

function inputHash(submission, assessment) {
  return createHash("sha256").update(JSON.stringify(feedbackInput(submission, assessment))).digest("hex");
}

function overallFeedbackState(submission, assessment) {
  if (!readyForFeedback(submission)) return { status: "waiting_for_grading" };
  const saved = submission.overallFeedback;
  if (saved?.inputHash !== inputHash(submission, assessment)) return { status: "processing" };
  if (saved.status === "completed" && saved.summary) return {
    status: "completed", summary: saved.summary, strengths: saved.strengths || [],
    weaknesses: saved.weaknesses || [], recommendations: saved.recommendations || [], generatedAt: saved.generatedAt,
  };
  if (saved.status === "failed") return { status: "failed", message: "GradeSense AI could not generate your overall feedback. Your saved scores and answers are unchanged. Retry to try again." };
  return { status: "processing" };
}

async function processOverallFeedback(submission, assessment, retry = false) {
  if (!readyForFeedback(submission)) return;
  const hash = inputHash(submission, assessment);
  const owner = randomUUID();
  const lease = await Submission.findOneAndUpdate({ _id: submission._id, status: "graded", updatedAt: submission.updatedAt,
    $or: [
      { "overallFeedback.inputHash": { $ne: hash } },
      { "overallFeedback.status": { $exists: false } },
      { "overallFeedback.status": "processing", "overallFeedback.leaseUntil": { $lt: new Date() } },
      ...(retry ? [{ "overallFeedback.status": "failed" }] : []),
    ],
  }, { $set: { overallFeedback: { status: "processing", inputHash: hash, leaseOwner: owner, leaseUntil: new Date(Date.now() + leaseMs) } } }, { new: true });
  if (!lease) return;
  let generated;
  try { generated = await generation.generateOverallFeedback(feedbackInput(submission, assessment)); }
  catch { generated = null; }
  const latest = await Submission.findById(submission._id);
  // Teacher edits during generation invalidate this version; the next read queues a fresh one.
  if (!latest || inputHash(latest, assessment) !== hash || !readyForFeedback(latest)) return;
  await Submission.updateOne({ _id: submission._id, updatedAt: latest.updatedAt, "overallFeedback.leaseOwner": owner }, {
    $set: { overallFeedback: generated
      ? { ...generated, status: "completed", inputHash: hash, generatedAt: new Date() }
      : { status: "failed", inputHash: hash } },
  });
}

function queueOverallFeedback(submission, assessment, retry = false) {
  const state = overallFeedbackState(submission, assessment);
  if (!readyForFeedback(submission) || state.status === "completed") return state;
  const key = String(submission._id);
  if (active.has(key)) return { status: "processing" };
  if (state.status === "failed" && !retry) return state;
  active.add(key);
  setImmediate(() => processOverallFeedback(submission, assessment, retry)
    .catch(() => console.error("Overall assessment feedback could not be saved."))
    .finally(() => active.delete(key)));
  return { status: "processing" };
}

module.exports = { feedbackInput, readyForFeedback, inputHash, overallFeedbackState, processOverallFeedback, queueOverallFeedback };
