const id = (value) => String(value?._id || value || "");

export function studentAssessmentSubmission(assessment, submissions) {
  const submission = submissions
    ? submissions.find((item) => id(item.assessment) === id(assessment) && ["submitted", "graded"].includes(item.status))
    : assessment.previousSubmission;
  const hasSubmitted = ["submitted", "graded"].includes(submission?.status);
  const resultsAvailable = hasSubmitted && Boolean(submission._id);
  return {
    submission, hasSubmitted, resultsAvailable,
    submissionStatus: hasSubmitted ? "Submitted" : "Not Submitted",
    actionLabel: !hasSubmitted ? "Open Assessment" : resultsAvailable ? "View Results" : "Submitted",
  };
}
