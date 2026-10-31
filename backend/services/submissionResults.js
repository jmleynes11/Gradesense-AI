const Submission = require("../models/Submission");
const { summarizeFinalSubmission } = require("./submissionService");

// Students receive saved answer snapshots, never live answer keys or AI errors.
function submissionResult(submission, assessment, role = "student") {
  const result = submission.toObject ? submission.toObject() : { ...submission };
  if (role !== "student") return result;
  result.assessment = {
    _id: assessment._id, title: assessment.title, subject: assessment.subject,
    subjectRef: assessment.subjectRef, assessmentType: assessment.assessmentType,
    totalPoints: assessment.totalPoints, allowAnswerReview: assessment.allowAnswerReview !== false,
  };
  delete result.gradingLeaseUntil;
  delete result.gradingLeaseOwner;
  delete result.overallFeedback;
  result.answers = assessment.allowAnswerReview === false ? [] : (result.answers || []).map((answer) => ({
    question: answer.question?._id || answer.question,
    questionType: answer.questionType, questionText: answer.questionText,
    correctAnswer: answer.correctAnswer, pointsPossible: answer.pointsPossible,
    answer: answer.answer, score: answer.score, finalScore: answer.finalScore,
    aiScore: answer.aiScore, aiStatus: answer.aiStatus, isCorrect: answer.isCorrect,
    feedback: answer.feedback, teacherFeedback: answer.teacherFeedback,
    strengths: answer.strengths, weaknesses: answer.weaknesses, suggestions: answer.suggestions,
  }));
  return result;
}

// Reconcile older submissions and newly saved per-question grades from snapshots.
// The revision check prevents a results refresh from undoing a teacher's edit.
async function refreshSavedTotals(submission) {
  if (!["submitted", "graded"].includes(submission.status) || !submission.answers?.length
    || submission.teacherOverrideScore != null) return true;
  const candidate = summarizeFinalSubmission({ answers: submission.answers });
  const { answers, ...totals } = candidate;
  if (Object.entries(totals).every(([key, value]) => Object.is(submission[key], value))) return true;
  const updatedAt = new Date();
  const changes = { ...totals, updatedAt,
    gradedAt: totals.status === "graded" ? (submission.gradedAt || new Date()) : null };
  const saved = await Submission.updateOne({ _id: submission._id, updatedAt: submission.updatedAt, __v: submission.__v },
    { $set: changes, $inc: { __v: 1 } });
  if (!saved.matchedCount) return false;
  Object.assign(submission, changes);
  submission.__v = (submission.__v || 0) + 1;
  return true;
}

module.exports = { submissionResult, refreshSavedTotals };

