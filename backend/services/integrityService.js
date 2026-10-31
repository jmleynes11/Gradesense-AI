function normalizeText(value = "") {
  return String(value).toLowerCase().replace(/[^a-z0-9\s.]/g, " ").replace(/\s+/g, " ").trim();
}

function wordSet(value = "") {
  return new Set(normalizeText(value).split(/\s+/).filter((word) => word.length > 3));
}

function similarityPercent(left = "", right = "") {
  const a = wordSet(left);
  const b = wordSet(right);
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((word) => b.has(word)).length;
  const union = new Set([...a, ...b]).size;
  return Math.round((intersection / union) * 100);
}

function matchingPhrases(left = "", right = "") {
  const rightText = normalizeText(right);
  return normalizeText(left)
    .split(/[.!?]/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.split(/\s+/).length >= 5 && rightText.includes(sentence))
    .slice(0, 5);
}

function riskFromSimilarity(percent) {
  if (percent >= 70) return "High Risk";
  if (percent >= 40) return "Medium Risk";
  return "Low Risk";
}

async function analyzePlagiarism({ Submission, questionId, assessmentId, studentId, answer }) {
  const previous = await Submission.find({
    assessment: assessmentId,
    student: { $ne: studentId },
    "answers.question": questionId,
  }).populate("student", "name email");

  let best = {
    similarityPercentage: 0,
    matchingStudent: undefined,
    matchingStudentName: "",
    highlightedText: [],
    status: "Low Risk",
  };

  previous.forEach((submission) => {
    const match = submission.answers.find((item) => String(item.question) === String(questionId));
    const percent = similarityPercent(answer, match?.answer || "");
    if (percent > best.similarityPercentage) {
      best = {
        similarityPercentage: percent,
        matchingStudent: submission.student?._id,
        matchingStudentName: submission.student?.name || submission.student?.email || "Unknown student",
        highlightedText: matchingPhrases(answer, match?.answer || ""),
        status: riskFromSimilarity(percent),
      };
    }
  });

  return best;
}

function analyzeAiContent(answer = "") {
  const text = normalizeText(answer);
  const words = text.split(/\s+/).filter(Boolean);
  const sentences = text.split(/[.!?]/).map((item) => item.trim()).filter(Boolean);
  const uniqueRatio = words.length ? new Set(words).size / words.length : 0;
  const averageSentenceLength = sentences.length ? words.length / sentences.length : 0;
  const transitionWords = ["moreover", "furthermore", "therefore", "overall", "in conclusion", "additionally"];
  const transitionHits = transitionWords.filter((word) => text.includes(word)).length;
  const patternScore =
    (averageSentenceLength >= 18 && averageSentenceLength <= 28 ? 30 : 10) +
    (uniqueRatio > 0.42 && uniqueRatio < 0.72 ? 25 : 10) +
    Math.min(25, transitionHits * 8) +
    (words.length > 120 ? 20 : 5);
  const confidencePercentage = Math.max(0, Math.min(100, patternScore));
  const probability = confidencePercentage >= 70 ? "High" : confidencePercentage >= 40 ? "Medium" : "Low";

  return {
    probability,
    confidencePercentage,
    reasoning: "Heuristic review based on sentence regularity, vocabulary distribution, transition density, and response length.",
    writingPatternAnalysis: [
      `Average sentence length: ${Math.round(averageSentenceLength)} words.`,
      `Vocabulary uniqueness ratio: ${Math.round(uniqueRatio * 100)}%.`,
      `Formal transition markers detected: ${transitionHits}.`,
    ],
  };
}

module.exports = {
  analyzeAiContent,
  analyzePlagiarism,
  similarityPercent,
};
