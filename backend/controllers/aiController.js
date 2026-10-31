const fs = require("fs/promises");
const {
  gradeEssay,
  generateFeedback,
  generateRecommendations,
} = require("../services/aiService");
const {
  processPlainLessonText,
  processUploadedDocument,
} = require("../services/documentProcessingService");
const { generateQuizDraft } = require("../services/quizGenerationService");
const { requestCancellation, throwIfCancelled } = require("../services/aiRequestPolicy");

async function cleanupUpload(file) {
  if (!file?.path) return;
  await fs.unlink(file.path).catch(() => {});
}

async function generateQuizFromContent(req, res) {
  const startedAt = Date.now();
  const cancellation = requestCancellation(req, res);
  try {
    throwIfCancelled(cancellation.signal);
    const promptText = req.body.content?.trim() || req.body.teacherPrompt?.trim();
    const processed = req.file
      ? await processUploadedDocument(req.file)
      : processPlainLessonText(promptText || "");

    if (!processed.text) {
      return res.status(400).json({
        message: "Lesson content is required.",
      });
    }

    console.info("[Quiz generation]", {
      event: "request_received",
      requestedCounts: {
        multipleChoice: Number(req.body.multipleChoiceCount || 0),
        trueFalse: Number(req.body.trueFalseCount || 0),
        identification: Number(req.body.identificationCount || 0),
        essay: Number(req.body.essayCount || 0),
      },
      lessonCharacters: processed.text.length,
      sourceType: processed.metadata?.extension?.slice(1) || processed.metadata?.source || "text",
      extractedCharacters: processed.metadata?.extractedChars,
      truncated: processed.metadata?.truncated || false,
    });

    const result = await generateQuizDraft({
      body: req.body,
      teacherId: req.user._id,
      cleanedContent: processed.text,
      sourceMetadata: processed.metadata,
      signal: cancellation.signal,
    });

    console.info("[Quiz generation]", { event: "draft_saved", elapsedMs: Date.now() - startedAt, cached: result.cached });
    return res.status(result.cached ? 200 : 201).json(result);
  } catch (error) {
    console.error("[Quiz generation]", {
      event: "failed",
      elapsedMs: Date.now() - startedAt,
      status: error.status,
      code: error.code,
      message: error.message,
    });

    if (cancellation.signal.aborted || res.destroyed) return;
    return res.status(error.status || 500).json({
      message: error.message || "Quiz generation failed",
      code: error.code,
    });
  } finally {
    cancellation.dispose();
    await cleanupUpload(req.file);
  }
}

async function gradeEssayRoute(req, res) {
  try {
    res.json(
      await gradeEssay(
        req.body.question,
        req.body.answer,
        req.body.rubric,
        req.body.points ?? 5,
        req.body.lessonContext || "",
        { assessmentId: req.body.assessmentId, questionId: req.body.questionId,
          suggestedAnswer: req.body.suggestedAnswer || req.body.referenceAnswer || "" },
      ),
    );
  } catch (error) {
    res.status(error.status || 500).json({
      message: error.message || "Essay grading failed",
      code: error.code,
    });
  }
}

async function feedbackRoute(req, res) {
  res.json(
    await generateFeedback(
      req.body.score,
      req.body.percentage,
      req.body.answers || [],
    ),
  );
}

async function recommendationsRoute(req, res) {
  res.json({
    recommendations: await generateRecommendations(
      req.body.topic,
      req.body.percentage,
    ),
  });
}

module.exports = {
  generateQuizFromContent,
  gradeEssayRoute,
  feedbackRoute,
  recommendationsRoute,
};
