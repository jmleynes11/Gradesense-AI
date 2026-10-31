const { randomUUID } = require("node:crypto");
const Assessment = require("../models/Assessment");
const Submission = require("../models/Submission");
const Feedback = require("../models/Feedback");
const { gradeAnswer, summarizeFinalSubmission } = require("./submissionService");
const { generateFeedback } = require("./aiService");
const { notifyStudents } = require("./notificationService");

const active = new Set();
const leaseMs = 120000;

async function publishResult(submission, assessment) {
  const pending = submission.status === "submitted";
  const feedback = pending
    ? { strengths: [], weaknesses: [], recommendations: [], summary: "Essay evaluation is pending teacher review." }
    : await generateFeedback(submission.score, submission.percentage, submission.answers);
  await Feedback.findOneAndUpdate({ submission: submission._id }, {
    ...feedback, submission: submission._id, student: submission.student, assessment: assessment._id,
  }, { upsert: true, new: true });
  await notifyStudents([submission.student], {
    subject: assessment.subjectRef, assessment: assessment._id, submission: submission._id,
    eventKey: `submission:${pending ? "submitted" : "graded"}:${submission._id}`,
    title: `${assessment.title} ${pending ? "submitted" : "graded"}`,
    message: pending ? `Your ${assessment.title} was submitted and is pending teacher review.`
      : `Your ${assessment.title} has been graded. Feedback is available.`,
    type: pending ? "assessments" : "grades",
  });
}

async function processSubmission(id) {
  // The persisted lease allows interrupted jobs to resume after a server restart.
  const leaseOwner = randomUUID();
  const submission = await Submission.findOneAndUpdate({
    _id: id, status: "submitted", aiGradingStatus: "processing",
    $or: [{ gradingLeaseUntil: null }, { gradingLeaseUntil: { $lt: new Date() } }],
  }, { $set: { gradingLeaseUntil: new Date(Date.now() + leaseMs), gradingLeaseOwner: leaseOwner } }, { new: true });
  if (!submission) return;
  const assessment = await Assessment.findById(submission.assessment).populate("questions");
  if (!assessment) return;
  for (const answer of submission.answers) {
    if (answer.aiStatus !== "processing") continue;
    const question = assessment.questions.find((item) => String(item._id) === String(answer.question));
    let graded;
    try {
      if (!question) throw new Error("Question unavailable");
      graded = await gradeAnswer(question, answer.answer, {
        Submission, assessmentId: assessment._id, studentId: submission.student,
        lessonContent: assessment.lessonContent, lessonSummary: assessment.lessonSummary,
        topicsIdentified: assessment.topicsIdentified, keyConcepts: assessment.keyConcepts,
      });
    } catch {
      graded = { ...answer.toObject(), score: null, finalScore: null, aiStatus: "pending_review",
        feedback: "Essay evaluation is pending teacher review." };
    }
    // Never overwrite an answer or total that a teacher reviewed while AI ran.
    const saved = await Submission.updateOne({
      _id: id, status: "submitted", gradingLeaseOwner: leaseOwner,
      answers: { $elemMatch: { question: answer.question, aiStatus: "processing" } },
    }, { $set: { "answers.$": graded, gradingLeaseUntil: new Date(Date.now() + leaseMs) }, $inc: { __v: 1 } });
    if (!saved.matchedCount) {
      const latest = await Submission.findById(id);
      if (!latest || latest.status !== "submitted" || latest.gradingLeaseOwner !== leaseOwner) return;
      // A teacher may have reviewed this answer while its AI request ran.
      // Continue evaluating other processing answers under the same lease.
    }
  }
  // Compare timestamps so concurrent teacher edits cannot be lost at finalization.
  for (let retry = 0; retry < 3; retry += 1) {
    const latest = await Submission.findById(id);
    if (!latest || latest.gradingLeaseOwner !== leaseOwner || latest.teacherOverrideScore != null) return;
    summarizeFinalSubmission(latest);
    const completed = latest.status === "graded";
    const saved = await Submission.updateOne({ _id: id, updatedAt: latest.updatedAt, __v: latest.__v, gradingLeaseOwner: leaseOwner }, {
      $set: { score: latest.score, percentage: latest.percentage, finalScore: latest.finalScore,
        finalPercentage: latest.finalPercentage, totalPossiblePoints: latest.totalPossiblePoints,
        gradedPointsEarned: latest.gradedPointsEarned, gradedPossiblePoints: latest.gradedPossiblePoints,
        gradedQuestionCount: latest.gradedQuestionCount, pendingQuestionCount: latest.pendingQuestionCount,
        aiScore: latest.aiGradingStatus === "completed" ? latest.score : null,
        aiPercentage: latest.aiGradingStatus === "completed" ? latest.percentage : null,
        aiGradingStatus: latest.aiGradingStatus, passStatus: latest.passStatus,
        status: latest.status, gradedAt: completed ? new Date() : null },
      $unset: { gradingLeaseUntil: 1, gradingLeaseOwner: 1 },
      $inc: { __v: 1 },
    });
    if (saved.matchedCount) {
      await publishResult(latest, assessment);
      return;
    }
  }
}

function queueSubmissionGrading(id) {
  const key = String(id);
  if (active.has(key)) return;
  active.add(key);
  setImmediate(() => processSubmission(id)
    .catch((error) => console.error("Submission grading failed:", error.message))
    .finally(() => active.delete(key)));
}

function startSubmissionGrading() {
  async function resume() {
    try {
      const rows = await Submission.find({ status: "submitted", aiGradingStatus: "processing",
        $or: [{ gradingLeaseUntil: null }, { gradingLeaseUntil: { $lt: new Date() } }] }).select("_id").limit(10).lean();
      rows.forEach((row) => queueSubmissionGrading(row._id));
    } catch (error) {
      console.error("Unable to resume submission grading:", error.message);
    }
  }
  void resume();
  const timer = setInterval(resume, 30000);
  timer.unref();
}

module.exports = { queueSubmissionGrading, startSubmissionGrading, processSubmission, publishResult };
