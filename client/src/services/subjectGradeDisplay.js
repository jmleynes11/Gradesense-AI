import { isGradePending } from "./gradeDisplay.js";

const isNumber = (value) => typeof value === "number" && Number.isFinite(value);

function possiblePoints(submission, assessment) {
  // The submission snapshot is authoritative even if the assessment is edited.
  if (isNumber(submission.totalPossiblePoints) && submission.totalPossiblePoints > 0) return submission.totalPossiblePoints;
  const answers = submission.answers || [];
  if (answers.length && answers.every((answer) => isNumber(answer.pointsPossible) && answer.pointsPossible >= 0)) {
    const total = answers.reduce((sum, answer) => sum + answer.pointsPossible, 0);
    if (total > 0) return total;
  }
  return isNumber(assessment?.totalPoints) && assessment.totalPoints > 0 ? assessment.totalPoints : null;
}

export function subjectGradeDisplay(submission, assessment) {
  const pending = isGradePending(submission);
  const earned = submission.finalScore ?? submission.score;
  const total = possiblePoints(submission, assessment);
  const hasScore = isNumber(earned) && total !== null;
  const date = submission.submittedAt ? new Date(submission.submittedAt) : null;

  return {
    score: pending ? "Pending teacher review" : hasScore ? `${earned}/${total}` : "—",
    percentage: pending ? "Pending teacher review" : hasScore ? `${Math.round((earned / total) * 10000) / 100}%` : "—",
    date: date && Number.isFinite(date.getTime()) ? date.toLocaleString("en-US", {
      month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true,
    }) : "—",
  };
}
