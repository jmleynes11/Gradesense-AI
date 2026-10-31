const { estimateTokens } = require("./contentOptimizer");

const MAX_RAW_TOKENS = 12000;
const MAX_SUMMARY_SENTENCES = 4;
const MAX_KEY_CONCEPTS = 12;
const MAX_IMPORTANT_SENTENCES = 16;
const MAX_KEYWORDS = 20;

const STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "being",
  "because",
  "between",
  "could",
  "every",
  "from",
  "have",
  "into",
  "more",
  "other",
  "should",
  "their",
  "there",
  "these",
  "this",
  "those",
  "through",
  "under",
  "using",
  "where",
  "which",
  "with",
  "would",
]);

function createHttpError(message, status = 400, details = {}) {
  const error = new Error(message);
  error.status = status;
  Object.assign(error, details);
  return error;
}

function cleanText(content = "") {
  return String(content).replace(/\s+/g, " ").trim();
}

function splitSentences(content = "") {
  return String(content)
    .split(/(?<=[.!?])\s+|\r?\n+/)
    .map(cleanText)
    .filter((item) => item.length >= 25);
}

function tokenize(content = "") {
  return cleanText(content)
    .toLowerCase()
    .match(/[a-z][a-z-]{3,}/g) || [];
}

function rankKeywords(content = "", limit = MAX_KEYWORDS) {
  const counts = {};
  tokenize(content)
    .filter((word) => !STOP_WORDS.has(word))
    .forEach((word) => {
      counts[word] = (counts[word] || 0) + 1;
    });

  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([word]) => word);
}

function scoreSentence(sentence, keywords) {
  const lower = sentence.toLowerCase();
  return keywords.reduce((score, keyword) => score + (lower.includes(keyword) ? 1 : 0), 0);
}

function analyzeLesson(content = "") {
  const text = cleanText(content);
  const rawEstimatedTokens = estimateTokens(text);

  if (rawEstimatedTokens > MAX_RAW_TOKENS) {
    throw createHttpError("Lesson content is too large for quiz generation.", 413, {
      code: "LESSON_TOO_LARGE",
      rawEstimatedTokens,
      maxTokens: MAX_RAW_TOKENS,
    });
  }

  const sentences = splitSentences(content);
  if (sentences.length < 2) {
    throw createHttpError("Lesson content is too short to generate a reliable quiz.", 422, {
      code: "LESSON_TOO_SHORT",
    });
  }

  const keywords = rankKeywords(text);
  const importantSentences = sentences
    .map((sentence, index) => ({
      sentence,
      index,
      score: scoreSentence(sentence, keywords),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, MAX_IMPORTANT_SENTENCES)
    .sort((a, b) => a.index - b.index)
    .map((item) => item.sentence);

  const keyConcepts = importantSentences.slice(0, MAX_KEY_CONCEPTS);
  const lessonSummary =
    importantSentences.slice(0, MAX_SUMMARY_SENTENCES).join(" ") ||
    sentences.slice(0, MAX_SUMMARY_SENTENCES).join(" ");

  return {
    lessonSummary,
    topicsIdentified: keywords.slice(0, 12),
    keyConcepts,
    importantSentences,
    keywords,
    sourceSentences: sentences,
    sourceText: text,
    rawEstimatedTokens,
    structuredEstimatedTokens: estimateTokens(
      JSON.stringify({
        lessonText: text,
        topicsIdentified: keywords.slice(0, 12),
      }),
    ),
  };
}

function compactLessonForAi(analysis, lessonText) {
  return {
    // Plain readable text, not a ZIP/base64 payload or a lossy summary. Include
    // the source once; summary/keyConcepts would repeat the same sentences.
    lessonText: cleanText(lessonText || analysis.sourceText || analysis.sourceSentences?.join(" ") || analysis.keyConcepts?.join(" ") || analysis.lessonSummary),
    topicsIdentified: analysis.topicsIdentified,
  };
}

module.exports = {
  analyzeLesson,
  cleanText,
  compactLessonForAi,
  splitSentences,
};
