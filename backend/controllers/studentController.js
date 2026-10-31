const Subject = require("../models/Subject");
const Assessment = require("../models/Assessment");
const Submission = require("../models/Submission");
const Feedback = require("../models/Feedback");
const AssessmentSession = require("../models/AssessmentSession");
const { assessmentListFields, objectId } = require("../utils/queryOptions");
const { generateRecommendations } = require("../services/aiService");
const { studentAssessmentStatus } = require("../services/studentAssessmentStatus");
const { assessmentStartAccess } = require("../services/assessmentStartAccess");

function seededShuffle(items, seed) {
  const result = [...items];
  let state = Array.from(String(seed)).reduce((sum, char) => sum + char.charCodeAt(0), 0) || 1;
  for (let index = result.length - 1; index > 0; index -= 1) {
    state = (state * 9301 + 49297) % 233280;
    const target = Math.floor((state / 233280) * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

async function assignedAssessmentFilter(studentId) {
  const subjects = await Subject.find({ students: studentId, archived: { $ne: true } }).select("_id");
  return {
    filter: { status: { $in: ["published", "closed"] }, subjectRef: { $in: subjects.map((item) => item._id) } },
  };
}

async function dashboard(req, res) {
  const { filter } = await assignedAssessmentFilter(req.user._id);
  const assessments = await Assessment.find(filter);
  const submissions = await Submission.find({ student: req.user._id }).populate("assessment", "title subject");
  const feedback = await Feedback.find({ student: req.user._id }).sort({ createdAt: -1 }).limit(5);
  const graded = submissions.filter((item) => item.status === "graded");
  const average = graded.length ? Math.round(graded.reduce((sum, item) => sum + item.percentage, 0) / graded.length) : 0;
  const recommendations = await generateRecommendations("weak topics", average);
  const trend = graded.length >= 2
    ? Number(graded[graded.length - 1].percentage || 0) - Number(graded[0].percentage || 0)
    : 0;
  const lowest = graded.reduce((low, item) => Number(item.percentage || 0) < Number(low?.percentage ?? 101) ? item : low, null);
  const academicStatus = average >= 75 ? "Passing" : "At Risk";

  res.json({
    currentAverage: average,
    academicStatus,
    performanceTrend: trend > 0 ? "Improving" : trend < 0 ? "Declining" : "Stable",
    aiRecommendation: academicStatus === "Passing"
      ? "Keep up the excellent performance."
      : `You are struggling${lowest?.assessment?.subject ? ` in ${lowest.assessment.subject}` : ""}. Complete the recommended remedial quiz.`,
    completedAssessments: graded.length,
    pendingAssessments: Math.max(assessments.length - submissions.length, 0),
    recentFeedback: feedback,
    recommendations,
    scores: submissions.map((item) => ({ title: item.assessment?.title, subject: item.assessment?.subject, percentage: item.percentage }))
  });
}

async function assignedAssessments(req, res) {
  const { filter } = await assignedAssessmentFilter(req.user._id);
  const summary = req.query.view === "instructions" || (req.query.view === "summary" && !req.params.id);
  if (req.params.id) filter._id = objectId(req.params.id, "assessment");
  const submissions = await Submission.find({ student: req.user._id, ...(filter._id ? { assessment: filter._id } : {}) }).select("assessment status score percentage finalScore finalPercentage totalPossiblePoints gradedPointsEarned gradedPossiblePoints gradedQuestionCount pendingQuestionCount submittedAt aiGradingStatus gradedBy");
  const submissionByAssessment = submissions.reduce((map, item) => {
    const key = String(item.assessment);
    if (!map[key]) map[key] = [];
    map[key].push(item);
    return map;
  }, {});

  let assessmentQuery = Assessment.find(filter)
    .select(assessmentListFields + " instructions allowPreviousQuestions lockPreviousQuestions randomizeQuestions randomizeChoices allowAnswerReview")
    .populate("subjectRef", "name code")
    .sort({ publishedAt: -1, createdAt: -1 }).lean();
  if (!summary) assessmentQuery = assessmentQuery.populate("questions", "type text choices points difficulty order programming.language programming.allowedLanguages programming.starterCode programming.sampleInput programming.sampleOutput programming.timeLimitSeconds");
  const assessments = await assessmentQuery;
  const now = new Date();

  const result = assessments.map((assessment) => {
    const attempts = submissionByAssessment[String(assessment._id)] || [];
    const previousSubmission = attempts[0];
    const questions = assessment.randomizeQuestions
      ? seededShuffle(assessment.questions, `${assessment._id}:${req.user._id}:questions`)
      : assessment.questions;
    return {
      _id: assessment._id,
      title: assessment.title,
      assessmentType: assessment.assessmentType,
      subject: assessment.subject,
      status: assessment.status,
      dueDate: assessment.dueDate,
      startDate: assessment.startDate,
      endDate: assessment.endDate,
      durationMinutes: assessment.durationMinutes,
      allowPreviousQuestions: assessment.allowPreviousQuestions,
      lockPreviousQuestions: assessment.lockPreviousQuestions,
      randomizeQuestions: assessment.randomizeQuestions,
      randomizeChoices: assessment.randomizeChoices,
      attemptLimit: assessment.attemptLimit,
      allowAnswerReview: assessment.allowAnswerReview !== false,
      serverNow: now,
      ...assessmentStartAccess(assessment, attempts, now),
      ...studentAssessmentStatus(assessment, attempts, now),
      instructions: assessment.instructions,
      totalPoints: assessment.totalPoints || assessment.questions.reduce((sum, question) => sum + (question.points || 1), 0),
      numberOfQuestions: assessment.questions.length,
      previousSubmission: previousSubmission ? {
        _id: previousSubmission._id,
        status: previousSubmission.status,
        aiGradingStatus: previousSubmission.aiGradingStatus,
        gradedBy: previousSubmission.gradedBy,
        score: previousSubmission.finalScore ?? previousSubmission.score ?? null,
        percentage: previousSubmission.finalPercentage ?? previousSubmission.percentage ?? null,
        totalPossiblePoints: previousSubmission.totalPossiblePoints || 0,
        gradedPointsEarned: previousSubmission.gradedPointsEarned,
        gradedPossiblePoints: previousSubmission.gradedPossiblePoints,
        gradedQuestionCount: previousSubmission.gradedQuestionCount,
        pendingQuestionCount: previousSubmission.pendingQuestionCount,
        submittedAt: previousSubmission.submittedAt || null,
      } : null,
      questions: summary ? undefined : questions.map((question) => {
        const plain = { ...question };
        if (plain.type === "multiple_choice" && assessment.randomizeChoices) {
          plain.choices = seededShuffle(plain.choices || [], `${assessment._id}:${req.user._id}:${question._id}:choices`);
        }
        return plain;
      })
    };
  });
  if (req.params.id) return result[0] ? res.json(result[0]) : res.status(404).json({ message: "Assessment not found" });
  res.json(result);
}

async function startAssessment(req, res) {
  const { filter } = await assignedAssessmentFilter(req.user._id);
  filter._id = objectId(req.params.id, "assessment");
  const assessment = await Assessment.findOne(filter).select(assessmentListFields).lean();
  if (!assessment) return res.status(404).json({ message: "Assessment not found" });
  const key = { assessment: assessment._id, student: req.user._id };
  const submissions = await Submission.find(key).select("status");
  const now = new Date();
  const access = assessmentStartAccess(assessment, submissions, now);
  if (!access.canStart) return res.status(403).json({ message: access.startBlockedReason });
  const duration = Number(assessment.durationMinutes ?? 30);
  if (!Number.isFinite(duration) || duration <= 0) return res.status(400).json({ message: "The assessment duration is invalid. Contact your teacher." });
  let session;
  try {
    session = await AssessmentSession.findOneAndUpdate(key, { $setOnInsert: {
      ...key, startedAt: now, expiresAt: new Date(now.getTime() + duration * 60000),
    } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  } catch (error) {
    if (error.code !== 11000) throw error;
    session = await AssessmentSession.findOne(key);
    if (!session) throw error;
  }
  res.json({ _id: session._id, startedAt: session.startedAt, expiresAt: session.expiresAt, serverNow: new Date() });
}

async function gradeHistory(req, res) {
  const submissions = await Submission.find({ student: req.user._id, status: { $in: ["submitted", "graded"] } }).select("assessment score percentage finalScore finalPercentage totalPossiblePoints gradedPointsEarned gradedPossiblePoints gradedQuestionCount pendingQuestionCount aiGradingStatus gradedBy status submittedAt").populate("assessment", "title subject").lean();
  const feedback = await Feedback.find({ student: req.user._id });
  res.json({ submissions, feedback });
}

module.exports = { dashboard, assignedAssessments, startAssessment, gradeHistory };
