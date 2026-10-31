const { studentAssessmentStatus } = require("./studentAssessmentStatus");

function assessmentStartAccess(assessment, submissions = [], now = new Date()) {
  const { canSubmit } = studentAssessmentStatus(assessment, submissions, now);
  let startBlockedReason = "";
  if (submissions.length) startBlockedReason = "You have already submitted this assessment. No additional attempt is available.";
  else if (assessment.status !== "published") startBlockedReason = "This assessment is closed.";
  else if (assessment.startDate && now < new Date(assessment.startDate)) {
    startBlockedReason = `This assessment is not yet available. Available from ${new Date(assessment.startDate).toISOString()}.`;
  } else if (!canSubmit) startBlockedReason = "The submission deadline has passed. This assessment is no longer accepting submissions.";
  else if (!assessment.questions?.length) startBlockedReason = "This assessment has no questions available.";
  return { canStart: canSubmit && !startBlockedReason, startBlockedReason };
}

module.exports = { assessmentStartAccess };
