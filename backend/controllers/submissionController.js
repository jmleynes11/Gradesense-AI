const Assessment = require("../models/Assessment");
const Submission = require("../models/Submission");
const AssessmentSession = require("../models/AssessmentSession");
const Subject = require("../models/Subject");
const grading = require("../services/submissionGrading");
const { submissionResult, refreshSavedTotals } = require("../services/submissionResults");
const {
  aiGradingStatus,
  gradeAnswer,
  pendingEssayAnswer,
  summarizeFinalSubmission,
  summarizeSubmission,
  isAnswerGraded,
} = require("../services/submissionService");
const { notifySubmissionChanges } = require("../services/notificationEvents");
const logAction = require("../utils/audit");
const { sortStudents } = require("../utils/studentSort");
const { objectId } = require("../utils/queryOptions");
const { studentAssessmentStatus } = require("../services/studentAssessmentStatus");
const { assessmentSubmissionRows } = require("../services/assessmentSubmissionRows");
const overallFeedback = require("../services/overallAssessmentFeedback");

async function listSubmissions(req, res) {
  const filter = {};
  let owned = [];
  if (req.user.role === "student") filter.student = req.user._id;
  if (req.query.assessmentId) filter.assessment = objectId(req.query.assessmentId, "assessment");
  if (req.user.role === "teacher") {
    owned = await Assessment.find({ teacher: req.user._id, ...(filter.assessment ? { _id: filter.assessment } : {}) })
      .select("_id title subject teacher subjectRef assessmentType totalPoints")
      .populate({ path: "subjectRef", select: "name code students", populate: { path: "students", select: "name firstName lastName email studentNumber" } })
      .lean();
    filter.assessment = { $in: owned.map((item) => item._id) };
  }

  const items = await Submission.find(filter)
    .select("-answers -questionSequence -overallFeedback")
    .populate("student", "name firstName lastName email studentNumber")
    .populate({
      path: "assessment",
      select: "title subject teacher subjectRef assessmentType totalPoints",
      populate: { path: "subjectRef", select: "name code" },
    })
    .populate("gradedBy", "name")
    .sort({ submittedAt: -1, createdAt: -1 });

  const visible = req.user.role === "teacher"
    ? items.filter((item) => item.assessment && String(item.assessment.teacher) === String(req.user._id))
    : items;
  res.json(req.user.role === "teacher" ? assessmentSubmissionRows(visible, owned) : sortStudents(visible));
}

async function respondWithSubmission(req, res, retryFeedback = false, attempt = 0) {
  const submission = await Submission.findById(req.params.id)
    .populate("student", "name email studentNumber")
    .populate({
      path: "assessment",
      select: "title subject teacher subjectRef assessmentType totalPoints instructions allowAnswerReview",
      populate: { path: "subjectRef", select: "name code" },
    })
    .populate("answers.question")
    .populate("gradedBy modifiedBy", "name");

  if (!submission) return res.status(404).json({ message: "Submission not found" });
  if (req.user.role === "teacher" && String(submission.assessment?.teacher) !== String(req.user._id)) {
    return res.status(403).json({ message: "Not authorized to view this submission." });
  }
  if (req.user.role === "student" && String(submission.student?._id) !== String(req.user._id)) {
    return res.status(403).json({ message: "Not authorized to view this submission." });
  }

  if (!await refreshSavedTotals(submission)) {
    if (attempt < 2) return respondWithSubmission(req, res, retryFeedback, attempt + 1);
    return res.status(409).json({ message: "Grading changed while loading results. Reload the saved results." });
  }
  const result = submissionResult(submission, submission.assessment || {}, req.user.role);
  if (req.user.role === "student") {
    if (retryFeedback && !overallFeedback.readyForFeedback(submission)) return res.status(400).json({ message: "Overall feedback is available after grading and any required teacher review are complete." });
    result.overallFeedback = overallFeedback.queueOverallFeedback(submission, submission.assessment || {}, retryFeedback);
  }
  res.json(result);
}

async function getSubmission(req, res) { return respondWithSubmission(req, res); }
async function retryOverallFeedback(req, res) { return respondWithSubmission(req, res, true); }

async function submitAssessment(req, res) {
  const assessment = await Assessment.findById(req.params.assessmentId).populate("questions");
  if (!assessment) return res.status(404).json({ message: "Assessment not found" });
  if (assessment.status !== "published") return res.status(400).json({ message: "Only published assessments can be submitted." });
  const enrolled = await Subject.exists({ _id: assessment.subjectRef, students: req.user._id });
  if (!enrolled) return res.status(403).json({ message: "You are not assigned to this assessment's subject." });
  const now = new Date();
  const availability = studentAssessmentStatus(assessment, [], now);
  if (!availability.canSubmit && assessment.startDate && now < new Date(assessment.startDate)) {
    return res.status(400).json({ message: "Assessment has not started yet." });
  }
  if (!availability.canSubmit) {
    return res.status(400).json({ message: "Assessment is already closed." });
  }

  const existingSubmission = await Submission.findOne({ assessment: assessment._id, student: req.user._id });
  if (existingSubmission) {
    return res.status(403).json({ message: "You have already submitted this assessment.", submissionId: existingSubmission._id });
  }

  const session = await AssessmentSession.findOne({ assessment: assessment._id, student: req.user._id });
  if (!session) return res.status(403).json({ message: "Start the assessment from its instructions page before submitting." });

  let rawAnswers;
  try {
    rawAnswers = Array.isArray(req.body.answers) ? req.body.answers : JSON.parse(req.body.answers || "[]");
  } catch {
    return res.status(400).json({ message: "Submitted answers are invalid. Please reload the assessment and try again." });
  }
  if (!Array.isArray(rawAnswers)) return res.status(400).json({ message: "Submitted answers must be a list." });

  const answerMap = rawAnswers.reduce((map, item) => {
    if (item?.question) map[String(item.question)] = item.answer;
    return map;
  }, {});
  const missing = assessment.questions.filter((question) => {
    const value = answerMap[String(question._id)];
    if (question.type === "coding" && value && typeof value === "object") return !String(value.code || value.answer || "").trim();
    return !String(value ?? "").trim();
  });
  if (missing.length) {
    return res.status(400).json({ message: `Answer all required questions before submitting. Missing: ${missing.length}` });
  }

  const answers = [];

  for (const question of assessment.questions) {
    const answer = answerMap[String(question._id)];
    answers.push(question.type === "essay" ? pendingEssayAnswer(question, answer) : await gradeAnswer(question, answer, {
      Submission,
      assessmentId: assessment._id,
      studentId: req.user._id,
      lessonContent: assessment.lessonContent,
      lessonSummary: assessment.lessonSummary,
      topicsIdentified: assessment.topicsIdentified,
      keyConcepts: assessment.keyConcepts,
    }));
  }

  const totals = summarizeSubmission(answers, assessment);
  const numberCorrect = answers.filter((item) => item.isCorrect).length;
  const numberIncorrect = answers.filter((item) => item.isCorrect === false).length;
  const aiStatus = aiGradingStatus(answers);

  const submissionData = {
      ...totals,
      answers,
      supportingDocument: req.file?.path,
      score: totals.score,
      percentage: totals.percentage,
      aiScore: aiStatus === "completed" ? totals.score : null,
      aiPercentage: aiStatus === "completed" ? totals.percentage : null,
      aiGradingStatus: aiStatus,
      finalScore: totals.score,
      finalPercentage: totals.percentage,
      totalPossiblePoints: totals.totalPossiblePoints,
      passStatus: totals.passStatus,
      attemptNumber: 1,
      questionSequence: rawAnswers.map((item) => String(item.question)),
      startedAt: session.startedAt,
      timeExpired: now >= new Date(session.expiresAt),
      status: totals.finalScore === null ? "submitted" : "graded",
      submittedAt: new Date(),
      gradedAt: totals.finalScore === null ? undefined : new Date()
  };

  let submission;
  try {
    submission = await Submission.create({
      assessment: assessment._id,
      student: req.user._id,
      ...submissionData,
    });
  } catch (error) {
    if (error.code === 11000) {
      const existing = await Submission.findOne({ assessment: assessment._id, student: req.user._id });
      return res.status(403).json({ message: "You have already submitted this assessment.", submissionId: existing?._id });
    }
    throw error;
  }

  res.status(201).json({
    ...submissionResult(submission, assessment),
    ...studentAssessmentStatus(assessment, [submission]),
    totalPoints: totals.totalPossiblePoints,
    numberCorrect,
    numberIncorrect
  });
  if (aiStatus === "processing") grading.queueSubmissionGrading(submission._id);
  else void grading.publishResult(submission, assessment)
    .catch((error) => console.error("Submission feedback failed:", error.message));
}

async function overrideScore(req, res) {
  const existing = await Submission.findById(req.params.id).populate("assessment", "title subjectRef teacher");
  if (!existing) return res.status(404).json({ message: "Submission not found" });
  if (String(existing.assessment.teacher) !== String(req.user._id)) {
    return res.status(403).json({ message: "Not authorized to update this submission." });
  }

  const score = Number(req.body.score || 0);
  if (existing.answers?.some((answer) => answer.questionType === "essay") && !Number.isSafeInteger(score)) {
    return res.status(400).json({ message: "Essay assessment scores must be whole numbers." });
  }
  if (existing.answers?.some((answer) => !isAnswerGraded(answer))) {
    return res.status(400).json({ message: "Grade each pending question before overriding the final assessment score." });
  }
  const possible = existing.answers.reduce((sum, answer) => sum + Number(answer.pointsPossible ?? 0), 0);
  if (!Number.isFinite(score) || score < 0 || score > possible) {
    return res.status(400).json({ message: "Score must be between zero and the assessment's total possible points." });
  }
  const percentage = possible > 0 ? (score / possible) * 100 : 0;

  const submission = await Submission.findByIdAndUpdate(
    req.params.id,
    { $set: {
      teacherOverrideScore: score,
      finalScore: score,
      finalPercentage: percentage,
      score,
      percentage,
      totalPossiblePoints: possible,
      passStatus: percentage >= 75 ? "passed" : "failed",
      overrideReason: req.body.overrideReason,
      teacherComments: req.body.teacherComments,
      modifiedBy: req.user._id,
      gradedBy: req.user._id,
      modifiedAt: new Date(),
      gradedAt: new Date(),
      status: "graded"
    }, $inc: { __v: 1 }, $unset: { gradingLeaseUntil: 1, gradingLeaseOwner: 1 }
    },
    { new: true }
  );
  await notifySubmissionChanges(existing, submission, existing.assessment);
  await logAction(req, "override_score", "submissions", `Submission ${req.params.id}`);
  res.json(submission);
}

async function updateAnswerOverride(req, res, attempt = 0) {
  const submission = await Submission.findById(req.params.id).populate("assessment", "title subjectRef teacher");
  if (!submission) return res.status(404).json({ message: "Submission not found" });
  if (String(submission.assessment.teacher) !== String(req.user._id)) {
    return res.status(403).json({ message: "Not authorized to update this submission." });
  }
  const answer = submission.answers.find((item) => String(item.question) === String(req.params.questionId));
  if (!answer) return res.status(404).json({ message: "Answer not found" });

  const rawScore = Number(req.body.finalScore);
  if (req.body.finalScore == null || String(req.body.finalScore).trim() === "" || !Number.isFinite(rawScore)) {
    return res.status(400).json({ message: "Enter a valid score for this question." });
  }
  if (answer.questionType === "essay" && !Number.isSafeInteger(rawScore)) {
    return res.status(400).json({ message: "Essay scores must be whole numbers." });
  }
  const maxScore = Number(answer.pointsPossible || 0);
  const scoreLimit = answer.questionType === "essay" ? Math.floor(maxScore) : maxScore;
  const nextScore = maxScore > 0 ? Math.max(0, Math.min(scoreLimit, rawScore)) : Math.max(0, rawScore);
  const previous = submission.toObject();
  answer.finalScore = nextScore;
  answer.score = nextScore;
  answer.aiStatus = "teacher_reviewed";
  answer.rubricBreakdown = req.body.rubricBreakdown || answer.rubricBreakdown;
  answer.feedback = req.body.feedback ?? answer.feedback;
  answer.teacherFeedback = req.body.teacherFeedback ?? answer.teacherFeedback;
  answer.isCorrect = answer.questionType === "essay" ? nextScore >= Number(answer.pointsPossible || 1) * 0.6
    : answer.questionType === "coding" ? nextScore >= Math.ceil(Number(answer.pointsPossible || 1) * 0.6) : answer.isCorrect;

  summarizeFinalSubmission(submission);
  submission.overrideReason = req.body.overrideReason;
  submission.teacherComments = req.body.teacherComments;
  submission.modifiedBy = req.user._id;
  submission.gradedBy = req.user._id;
  submission.modifiedAt = new Date();
  submission.gradedAt = submission.status === "graded" ? new Date() : undefined;
  submission.teacherOverrideScore = undefined;
  // Apply only this question and recalculated totals against the version read.
  // Retry on a concurrent AI/teacher write instead of saving stale totals.
  const fields = ["score", "percentage", "finalScore", "finalPercentage", "totalPossiblePoints",
    "gradedPointsEarned", "gradedPossiblePoints", "gradedQuestionCount", "pendingQuestionCount",
    "aiGradingStatus", "status", "passStatus", "overrideReason", "teacherComments", "modifiedBy",
    "gradedBy", "modifiedAt"];
  const changes = Object.fromEntries(fields.filter((key) => submission[key] !== undefined).map((key) => [key, submission[key]]));
  changes.gradedAt = submission.status === "graded" ? submission.gradedAt : null;
  changes["answers.$"] = answer.toObject();
  const saved = await Submission.updateOne({ _id: submission._id, updatedAt: previous.updatedAt, __v: previous.__v,
    "answers.question": req.params.questionId }, { $set: changes, $inc: { __v: 1 },
    $unset: { teacherOverrideScore: 1, ...(submission.status === "graded" ? { gradingLeaseUntil: 1, gradingLeaseOwner: 1 } : {}) } });
  if (!saved.matchedCount) {
    if (attempt < 2) return updateAnswerOverride(req, res, attempt + 1);
    return res.status(409).json({ message: "Grading changed while saving. Reload the saved result and try again." });
  }

  await notifySubmissionChanges(previous, submission, submission.assessment);

  res.json(submission);
}

module.exports = { listSubmissions, getSubmission, retryOverallFeedback, submitAssessment, overrideScore, updateAnswerOverride };
