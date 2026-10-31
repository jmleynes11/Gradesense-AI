// Completion and missed deadlines are student states, independent of the
// teacher's publication state. Access still follows the existing rules.
function studentAssessmentStatus(assessment, attempts = [], now = new Date()) {
  const completed = attempts.some((attempt) => ["submitted", "graded"].includes(attempt.status));
  const overdue = Boolean(assessment.dueDate && now > new Date(assessment.dueDate));
  const notStarted = Boolean(assessment.startDate && now < new Date(assessment.startDate));
  const deadline = assessment.endDate || assessment.dueDate;
  const ended = Boolean(deadline && now > new Date(deadline));
  // Submission records have a unique (assessment, student) index. Preserve
  // that single-submission rule even for legacy settings with a higher limit.
  const canSubmit = assessment.status === "published" && !notStarted && !ended && attempts.length === 0;

  return {
    studentStatus: completed ? "Completed" : overdue ? "Missing" : !canSubmit ? "Closed" : "Not Started",
    attemptsUsed: attempts.length,
    canSubmit,
  };
}

module.exports = { studentAssessmentStatus };
