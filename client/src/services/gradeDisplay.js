export function isAnswerGradePending(answer) {
  return !Number.isFinite(answer.finalScore ?? answer.score)
    || ["processing", "pending_review", "failed"].includes(answer.aiStatus);
}

export function isGradePending(submission) {
  return ["pending", "submitted"].includes(submission?.status)
    || (submission?.pendingQuestionCount > 0)
    || submission?.answers?.some((answer) => (answer.questionType || "score" in answer || "finalScore" in answer || "aiStatus" in answer)
      && isAnswerGradePending(answer))
    || (["processing", "pending_review"].includes(submission?.aiGradingStatus) && !submission?.gradedBy);
}

function availableScore(submission) {
  if (submission?.gradedQuestionCount > 0 && Number.isFinite(submission.gradedPointsEarned)
    && Number.isFinite(submission.gradedPossiblePoints)) {
    return { score: submission.gradedPointsEarned, possible: submission.gradedPossiblePoints };
  }
  const graded = (submission?.answers || []).filter((answer) => !isAnswerGradePending(answer));
  return graded.length ? { score: graded.reduce((sum, answer) => sum + (answer.finalScore ?? answer.score), 0),
    possible: graded.reduce((sum, answer) => sum + (answer.pointsPossible ?? 0), 0) } : null;
}

export function resultStatus(submission) {
  if (!isGradePending(submission)) return "Completed";
  if (availableScore(submission)) return "Partial Result";
  return submission?.aiGradingStatus === "processing" ? "Grading in progress" : "Pending Teacher Review";
}

export function displayScore(submission, totalPoints) {
  if (isGradePending(submission)) {
    const available = availableScore(submission);
    if (available) return `${available.score}/${available.possible} (Partial Result)`;
    return submission?.aiGradingStatus === "processing" ? "Pending essay grading" : "Pending teacher review";
  }
  const score = submission?.finalScore ?? submission?.score;
  const possible = totalPoints ?? submission?.totalPossiblePoints;
  if (!Number.isFinite(score) || !Number.isFinite(possible) || possible <= 0) return "Score unavailable";
  return `${score}/${possible}`;
}

export function displayPercentage(submission) {
  if (isGradePending(submission)) return submission?.aiGradingStatus === "processing" ? "Pending essay grading" : "Pending teacher review";
  const percentage = submission?.finalPercentage ?? submission?.percentage;
  return Number.isFinite(percentage) ? `${Number(percentage.toFixed(2))}%` : "Percentage unavailable";
}
