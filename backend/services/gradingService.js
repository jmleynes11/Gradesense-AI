function normalize(value = "") {
  return String(value).toLowerCase().replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ").trim();
}

function gradeObjective(question, answer) {
  const acceptedAnswers = [question.answerKey, ...(question.acceptableAnswers || [])];
  const correct = acceptedAnswers.some((expected) => normalize(expected) === normalize(answer));
  return {
    score: correct ? Number(question.points ?? 1) : 0,
    isCorrect: correct,
    feedback: correct ? "Correct answer." : `Correct answer: ${question.answerKey}`
  };
}

function summarizeScores(submission, totalPoints) {
  const score = submission.answers.reduce((sum, item) => sum + Number(item.score || 0), 0);
  return {
    score,
    percentage: totalPoints ? Math.round((score / totalPoints) * 100) : 0
  };
}

module.exports = { gradeObjective, summarizeScores };
