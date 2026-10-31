const Question = require("../models/Question");
const Assessment = require("../models/Assessment");
const { validateQuestionPayload } = require("../services/questionIntegrityService");
const { generateQuizFromLessonAnalysis } = require("../services/aiService");
const { requestCancellation, throwIfCancelled } = require("../services/aiRequestPolicy");
const { assessmentSnapshot } = require("../services/assessmentSnapshot");
const { assessmentDetailExclusions } = require("../utils/queryOptions");
const { notifyAssessmentUpdated } = require("../services/notificationEvents");

async function refreshAssessmentTotal(assessmentId, userId, action) {
  if (!assessmentId) return null;
  const assessment = await Assessment.findOne({ _id: assessmentId, teacher: userId }).select(assessmentDetailExclusions).populate("questions").lean();
  if (!assessment) return null;
  assessment.totalPoints = assessment.questions.reduce((sum, question) => sum + Number(question.points || 0), 0);
  assessment.teacherModifiedVersion = assessmentSnapshot(assessment);
  await Assessment.updateOne({ _id: assessmentId, teacher: userId }, {
    $set: { totalPoints: assessment.totalPoints, teacherModifiedVersion: assessment.teacherModifiedVersion },
    $push: { versionHistory: { action, changedBy: userId, createdAt: new Date(), snapshot: assessmentSnapshot(assessment) } },
  });
  await notifyAssessmentUpdated(assessment, [action, assessment.updatedAt, assessment.teacherModifiedVersion]);
  return assessment;
}

async function listQuestions(req, res) {
  const filter = req.user.role === "teacher" ? { teacher: req.user._id } : {};
  if (req.query.assessment) filter.assessment = req.query.assessment;
  const items = await Question.find(filter);
  res.json(items);
}

async function createQuestion(req, res) {
  const payload = validateQuestionPayload(req.body);
  if (payload.assessment) {
    const assessment = await Assessment.findOne({ _id: payload.assessment, teacher: req.user._id });
    if (!assessment) return res.status(404).json({ message: "Assessment not found." });
    const duplicate = await Question.exists({
      assessment: assessment._id,
      teacher: req.user._id,
      text: payload.text,
    });
    if (duplicate) return res.status(409).json({ message: "This question already exists in the assessment." });
    payload.subject = assessment.subject;
    payload.order = (assessment.questions || []).length + 1;
  }
  const item = await Question.create({ ...payload, teacher: req.user._id });
  if (item.assessment) {
    await Assessment.findOneAndUpdate({ _id: item.assessment, teacher: req.user._id }, { $addToSet: { questions: item._id } });
    await refreshAssessmentTotal(item.assessment, req.user._id, "question_created");
  }
  res.status(201).json(item);
}

async function updateQuestion(req, res) {
  const payload = validateQuestionPayload(req.body);
  const item = await Question.findOneAndUpdate({ _id: req.params.id, teacher: req.user._id }, payload, { new: true });
  if (!item) return res.status(404).json({ message: "Question not found" });
  await refreshAssessmentTotal(item.assessment, req.user._id, "question_updated");
  res.json(item);
}

async function deleteQuestion(req, res) {
  const item = await Question.findOneAndDelete({ _id: req.params.id, teacher: req.user._id });
  if (!item) return res.status(404).json({ message: "Question not found" });
  await Assessment.findByIdAndUpdate(item.assessment, { $pull: { questions: item._id } });
  await refreshAssessmentTotal(item.assessment, req.user._id, "question_deleted");
  res.json({ message: "Question deleted" });
}

async function duplicateQuestion(req, res) {
  const source = await Question.findOne({ _id: req.params.id, teacher: req.user._id });
  if (!source) return res.status(404).json({ message: "Question not found" });
  const copy = source.toObject();
  delete copy._id;
  copy.text = `${copy.text} (Copy)`;
  copy.order = (copy.order || 0) + 1;
  const created = await Question.create(copy);
  await Assessment.findOneAndUpdate({ _id: source.assessment, teacher: req.user._id }, { $addToSet: { questions: created._id } });
  await refreshAssessmentTotal(source.assessment, req.user._id, "question_duplicated");
  res.status(201).json(created);
}

async function reorderQuestions(req, res) {
  const { orderedQuestionIds = [] } = req.body;
  await Promise.all(
    orderedQuestionIds.map((id, index) => Question.findOneAndUpdate({ _id: id, teacher: req.user._id }, { order: index + 1 }))
  );
  await Assessment.updateOne({ _id: req.params.assessmentId, teacher: req.user._id }, { $set: { questions: orderedQuestionIds } });
  await refreshAssessmentTotal(req.params.assessmentId, req.user._id, "questions_reordered");
  res.json({ message: "Questions reordered" });
}

async function regenerateQuestion(req, res) {
  const cancellation = requestCancellation(req, res);
  try {
    const source = await Question.findOne({ _id: req.params.id, teacher: req.user._id });
    if (!source) return res.status(404).json({ message: "Question not found" });
    if (source.type !== "multiple_choice") {
      return res.status(400).json({ message: "Only multiple choice regeneration is currently supported." });
    }

    const assessment = await Assessment.findOne({ _id: source.assessment, teacher: req.user._id }).populate("questions");
    if (!assessment) return res.status(404).json({ message: "Assessment not found" });
    if (assessment.status === "published") {
      return res.status(400).json({ message: "Published assessments cannot be regenerated. Close or duplicate the assessment first." });
    }

    const lessonContext = [
      assessment.lessonSummary,
      ...(assessment.topicsIdentified || []),
      ...(assessment.keyConcepts || []),
      source.sourceEvidence,
    ].filter(Boolean).join(". ");
    const existingQuestions = assessment.questions
      .filter((question) => String(question._id) !== String(source._id))
      .map((question, index) => `${index + 1}. ${question.text}`)
      .join("\n");

    const result = await generateQuizFromLessonAnalysis({
      lessonSummary: assessment.lessonSummary || lessonContext,
      topicsIdentified: assessment.topicsIdentified || [],
      keyConcepts: assessment.keyConcepts || [],
      importantSentences: [lessonContext],
      sourceSentences: [lessonContext],
    }, {
      difficulty: source.difficulty || assessment.difficulty || "medium",
      teacherPrompt: [
        req.body?.teacherPrompt || assessment.teacherPrompt || "",
        `Regenerate only this one multiple-choice question: ${source.text}`,
        `Do not duplicate these existing questions:\n${existingQuestions}`,
        "Use one correctAnswer and exactly three new question-specific distractors.",
      ].filter(Boolean).join("\n"),
      counts: {
        multiple_choice: 1,
        true_false: 0,
        identification: 0,
        essay: 0,
      },
      validationText: lessonContext,
      signal: cancellation.signal,
    });

    throwIfCancelled(cancellation.signal);
    const replacement = result.questions.find((question) => question.type === "multiple_choice");
    if (!replacement) {
      return res.status(422).json({ message: "Regeneration did not produce a valid multiple choice question." });
    }

    const payload = validateQuestionPayload({
      ...replacement,
      assessment: assessment._id,
      teacher: req.user._id,
      subject: assessment.subject,
      order: source.order,
      points: source.points,
      difficulty: source.difficulty || replacement.difficulty,
    });

    Object.assign(source, payload);
    await source.save();
    await refreshAssessmentTotal(assessment._id, req.user._id, "question_regenerated");
    res.json(source);
  } finally {
    cancellation.dispose();
  }
}

module.exports = { listQuestions, createQuestion, updateQuestion, deleteQuestion, duplicateQuestion, regenerateQuestion, reorderQuestions };
