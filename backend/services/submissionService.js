const { gradeObjective } = require("./gradingService");
const { gradeEssay } = require("./aiService");
const { analyzeAiContent, analyzePlagiarism } = require("./integrityService");

function totalPossiblePoints(assessment) {
  return assessment.questions.reduce((sum, question) => sum + Number(question.points ?? 1), 0);
}

function passStatus(percentage, passingPercentage = 75) {
  return Number(percentage || 0) >= passingPercentage ? "passed" : "failed";
}

function baseAnswerSnapshot(question, answer) {
  const value = typeof answer === "object" && answer !== null ? answer.answer || answer.code || "" : answer;
  return {
    question: question._id,
    questionType: question.type,
    questionText: question.text,
    correctAnswer: question.type === "essay" ? "" : question.answerKey,
    pointsPossible: Number(question.points ?? 1),
    answer: value,
  };
}

function pendingEssayAnswer(question, answer) {
  return { ...baseAnswerSnapshot(question, answer), score: null, finalScore: null,
    aiStatus: "processing", feedback: "Essay grading is processing." };
}

async function gradeAnswer(question, answer, context = {}) {
  if (question.type !== "essay") {
    if (question.type === "coding") {
      const codeAnswer = typeof answer === "object" && answer !== null ? answer : { code: answer };
      return {
        ...baseAnswerSnapshot(question, codeAnswer),
        score: 0,
        finalScore: 0,
        isCorrect: false,
        feedback: "Coding submission saved for teacher review.",
        aiStatus: "not_applicable",
        strengths: [],
        weaknesses: [],
        suggestions: [],
        codeLanguage: codeAnswer.language || question.programming?.language || "",
        codeSubmission: codeAnswer.code || codeAnswer.answer || "",
        sampleInput: question.programming?.sampleInput || "",
        expectedOutput: question.programming?.expectedOutput || "",
      };
    }
    const result = gradeObjective(question, answer);
    return {
      ...baseAnswerSnapshot(question, answer),
      score: result.score,
      finalScore: result.score,
      isCorrect: result.isCorrect,
      feedback: result.feedback,
      aiStatus: "not_applicable",
      strengths: [],
      weaknesses: [],
      suggestions: [],
    };
  }

  const lessonContext = [
    context.lessonContent,
    context.lessonSummary,
    question.sourceEvidence,
    context.topicsIdentified?.join(", "),
    context.keyConcepts?.join(", "),
  ].filter(Boolean).join("\n");
  const result = await gradeEssay(question.text, answer, question.rubric, question.points, lessonContext, {
    questionId: String(question._id), assessmentId: context.assessmentId && String(context.assessmentId),
    suggestedAnswer: question.suggestedAnswer || question.answerKey || "",
  });
  const pending = result.aiStatus !== "graded" || !Number.isInteger(result.score)
    || result.score < 0 || result.score > Number(question.points ?? 10);
  const score = pending ? null : result.score;
  const plagiarismReport = await analyzePlagiarism({
    Submission: context.Submission,
    questionId: question._id,
    assessmentId: context.assessmentId,
    studentId: context.studentId,
    answer,
  });
  const aiContentReport = analyzeAiContent(answer);
  return {
    ...baseAnswerSnapshot(question, answer),
    score,
    aiScore: pending ? undefined : score,
    finalScore: score,
    isCorrect: pending ? undefined : score >= Number(question.points ?? 10) * 0.6,
    feedback: result.feedback || (result.suggestions || []).join(" "),
    aiStatus: pending ? "pending_review" : "graded",
    aiError: result.aiError,
    rubricBreakdown: result.rubricBreakdown,
    strengths: result.strengths || [],
    weaknesses: result.weaknesses || [],
    missingOrIncorrectConcepts: result.missingOrIncorrectConcepts || result.weaknesses || [],
    suggestions: result.suggestions || [],
    plagiarismReport,
    aiContentReport,
  };
}

function summarizeSubmission(answers, assessment) {
  const graded = answers.filter(isAnswerGraded);
  const pendingQuestionCount = answers.length - graded.length;
  const gradedPointsEarned = Number(graded.reduce((sum, answer) => sum + (answer.finalScore ?? answer.score), 0).toFixed(2));
  const gradedPossiblePoints = graded.reduce((sum, answer) => sum + Number(answer.pointsPossible ?? 0), 0);
  const possible = assessment ? totalPossiblePoints(assessment)
    : answers.reduce((sum, answer) => sum + Number(answer.pointsPossible ?? 0), 0);
  const pending = pendingQuestionCount > 0 || !answers.length;
  const percentage = possible > 0 ? (gradedPointsEarned / possible) * 100 : 0;
  return {
    totalPossiblePoints: possible,
    gradedPointsEarned: graded.length ? gradedPointsEarned : null,
    gradedPossiblePoints,
    gradedQuestionCount: graded.length,
    pendingQuestionCount,
    score: pending ? null : gradedPointsEarned,
    percentage: pending ? null : percentage,
    finalScore: pending ? null : gradedPointsEarned,
    finalPercentage: pending ? null : percentage,
    passStatus: pending ? "not_applicable" : passStatus(percentage),
  };
}

function summarizeFinalSubmission(submission) {
  Object.assign(submission, summarizeSubmission(submission.answers));
  submission.aiGradingStatus = aiGradingStatus(submission.answers);
  submission.status = submission.finalScore === null ? "submitted" : "graded";
  return submission;
}

function isAnswerGraded(answer) {
  return Number.isFinite(answer.finalScore ?? answer.score)
    && !["processing", "pending_review", "failed"].includes(answer.aiStatus);
}

function aiGradingStatus(answers) {
  const essayAnswers = answers.filter((answer) => answer.questionType === "essay");
  if (!essayAnswers.length) return "not_required";
  if (essayAnswers.some((answer) => answer.aiStatus === "processing")) return "processing";
  if (essayAnswers.some((answer) => !isAnswerGraded(answer))) return "pending_review";
  if (essayAnswers.some((answer) => answer.aiStatus === "local_fallback")) return "partial_fallback";
  return "completed";
}

module.exports = {
  isAnswerGraded,
  aiGradingStatus,
  gradeAnswer,
  pendingEssayAnswer,
  summarizeSubmission,
  summarizeFinalSubmission,
};
