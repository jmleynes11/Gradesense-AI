const Assessment = require("../models/Assessment");
const Question = require("../models/Question");
const { hashContent } = require("./contentOptimizer");
const { analyzeLesson } = require("./lessonAnalysisService");
const { generateQuizFromLessonAnalysis } = require("./aiService");
const { validateQuestionPayload } = require("./questionIntegrityService");
const { findTeacherSubject, httpError } = require("../utils/subjectReference");
const { aiError, throwIfCancelled, withSignal } = require("./aiRequestPolicy");

const inFlightGenerations = new Map();

function createHttpError(message, status = 400, details = {}) {
  const error = new Error(message);
  error.status = status;
  Object.assign(error, details);
  return error;
}

function boundedCount(value, max) {
  if (!Number.isSafeInteger(Number(value || 0)) || Number(value || 0) < 0) {
    throw createHttpError("Question counts must be non-negative whole numbers.", 400, { code: "INVALID_QUESTION_COUNT" });
  }
  return Math.min(Math.max(Number(value || 0), 0), max);
}

function normalizeRequestedCounts(body) {
  const counts = {
    multiple_choice: boundedCount(body.multipleChoiceCount, 25),
    true_false: boundedCount(body.trueFalseCount, 25),
    identification: boundedCount(body.identificationCount, 25),
    essay: boundedCount(body.essayCount, 10),
  };

  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  if (total < 1 || total > 50) {
    throw createHttpError("Requested question count must be between 1 and 50.", 400, {
      code: "INVALID_QUESTION_COUNT",
    });
  }

  return counts;
}

async function validateRequest(body, teacherId) {
  if (!String(body.title || "").trim() || !body.subjectRef || !body.dueDate || !body.assessmentType) {
    throw httpError(
      "Title, subject, due date, and assessment type are required.",
      400,
      "MISSING_REQUIRED_FIELDS",
    );
  }
  const subject = await findTeacherSubject(teacherId, body.subjectRef);
  body.subjectRef = subject._id;
  body.subject = subject.name;
}

function buildCacheHash({ teacherId, body, counts, cleanedContent }) {
  return hashContent(
    JSON.stringify({
      teacher: String(teacherId),
      subjectRef: String(body.subjectRef || body.subject),
      title: body.title,
      subject: body.subject,
      assessmentType: body.assessmentType,
      teacherPrompt: body.teacherPrompt || "",
      difficulty: body.difficulty || "medium",
      counts,
      contentHash: hashContent(cleanedContent),
      generationNonce: body.generationNonce || Date.now(),
    }),
  );
}

function buildInFlightHash({ teacherId, body, counts, cleanedContent }) {
  return hashContent(
    JSON.stringify({
      teacher: String(teacherId),
      subjectRef: String(body.subjectRef || body.subject),
      title: body.title,
      subject: body.subject,
      assessmentType: body.assessmentType,
      teacherPrompt: body.teacherPrompt || "",
      difficulty: body.difficulty || "medium",
      counts,
      contentHash: hashContent(cleanedContent),
    }),
  );
}

async function findCachedDraft(teacherId, pdfHash) {
  const existing = await Assessment.findOne({
    teacher: teacherId,
    pdfHash,
  })
    .populate("questions")
    .lean();

  if (!existing) return null;

  return {
    cached: true,
    assessment: existing,
    questions: existing.questions || [],
    review: existing.originalAiVersion,
  };
}

async function persistDraft({ body, teacherId, pdfHash, result, sourceMetadata, analysis, lessonContent }) {
  const validatedQuestions = result.questions.map((question) => validateQuestionPayload(question));
  result.questions = validatedQuestions;
  result.answerKey = validatedQuestions.map((question, index) => ({
    number: index + 1,
    question: question.text,
    answer: question.type === "essay" ? question.suggestedAnswer : question.answerKey,
    explanation: question.explanation,
  }));

  const assessment = await Assessment.create({
    title: body.title,
    description: body.description || "AI generated assessment",
    instructions: body.instructions || "Answer all questions using the lesson material.",
    subjectRef: body.subjectRef,
    subject: body.subject,
    dueDate: body.dueDate,
    assessmentType: body.assessmentType,
    teacher: teacherId,
    status: "draft",
    isPublished: false,
    teacherPrompt: body.teacherPrompt,
    passingMark: Number(body.passingMark || 75),
    startDate: body.startDate || undefined,
    endDate: body.endDate || body.dueDate,
    durationMinutes: Number(body.durationMinutes || 30),
    allowPreviousQuestions: body.allowPreviousQuestions !== "false" && body.allowPreviousQuestions !== false,
    lockPreviousQuestions: body.lockPreviousQuestions === "true" || body.lockPreviousQuestions === true,
    randomizeQuestions: body.randomizeQuestions !== "false" && body.randomizeQuestions !== false,
    randomizeChoices: body.randomizeChoices !== "false" && body.randomizeChoices !== false,
    attemptLimit: Number(body.attemptLimit || 1),
    generationId: result.generationId,
    lessonSummary: result.lessonSummary,
    lessonContent,
    topicsIdentified: result.topicsIdentified,
    keyConcepts: result.keyConcepts,
    unsupportedRequests: result.unsupportedRequests,
    aiGradingConfig: result.aiGradingConfig,
    feedbackRules: result.feedbackRules,
    learningRecommendations: result.learningRecommendations,
    answerKey: result.answerKey,
    tokenUsage: result.tokenUsage,
    originalAiVersion: {
      ...result,
      documentMetadata: sourceMetadata,
      lessonMetrics: {
        rawEstimatedTokens: analysis.rawEstimatedTokens,
        structuredEstimatedTokens: analysis.structuredEstimatedTokens,
      },
    },
    teacherModifiedVersion: result,
    pdfHash,
    versionHistory: [
      {
        action: "ai_generated_draft",
        changedBy: teacherId,
        snapshot: result,
      },
    ],
  });

  const questions = await Question.insertMany(
    validatedQuestions.map((question) => ({
      ...question,
      assessment: assessment._id,
      teacher: teacherId,
      subject: assessment.subject,
    })),
  );

  assessment.questions = questions.map((question) => question._id);
  assessment.totalPoints = questions.reduce((sum, question) => sum + (question.points || 1), 0);

  await assessment.save();

  return {
    cached: false,
    assessment,
    questions,
    review: result,
  };
}

async function waitForGeneration(entry, signal) {
  throwIfCancelled(signal);
  entry.waiters += 1;
  try {
    return signal ? await withSignal(() => entry.pending, signal) : await entry.pending;
  } finally {
    entry.waiters -= 1;
    if (!entry.waiters) entry.controller.abort(aiError("AI_REQUEST_CANCELLED", 499));
  }
}

async function generateQuizDraft({ body, teacherId, cleanedContent, sourceMetadata, signal }) {
  throwIfCancelled(signal);
  await validateRequest(body, teacherId);
  throwIfCancelled(signal);

  const counts = normalizeRequestedCounts(body);
  const pdfHash = buildCacheHash({ teacherId, body, counts, cleanedContent });
  const inFlightHash = buildInFlightHash({ teacherId, body, counts, cleanedContent });

  if (inFlightGenerations.has(inFlightHash)) {
    return waitForGeneration(inFlightGenerations.get(inFlightHash), signal);
  }

  const controller = new AbortController();
  const entry = { controller, waiters: 0, pending: null };
  const pending = (async () => {
    const analysis = analyzeLesson(cleanedContent);
    const result = await generateQuizFromLessonAnalysis(analysis, {
      difficulty: body.difficulty || "medium",
      teacherPrompt: body.teacherPrompt || "",
      counts,
      validationText: cleanedContent,
      signal: controller.signal,
    });

    throwIfCancelled(controller.signal);
    try {
      return await persistDraft({
        body,
        teacherId,
        pdfHash,
        result,
        sourceMetadata,
        analysis,
        lessonContent: cleanedContent,
      });
    } catch (error) {
      if (error.code === 11000) {
        const existing = await findCachedDraft(teacherId, pdfHash);
        if (existing) return existing;
      }
      throw error;
    }
  })();

  entry.pending = pending.finally(() => {
    inFlightGenerations.delete(inFlightHash);
  });
  // All HTTP waiters may disconnect before the shared operation rejects.
  // Keep that rejection observed while active callers still receive it normally.
  entry.pending.catch(() => {});
  inFlightGenerations.set(inFlightHash, entry);
  return waitForGeneration(entry, signal);
}

module.exports = {
  generateQuizDraft,
  normalizeRequestedCounts,
};
