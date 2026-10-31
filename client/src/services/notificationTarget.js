function recordId(record) {
  return String(record?._id || record || "");
}

export function notificationTarget(notification) {
  if (notification.quizGame) return {
    page: "Quiz Games", gameId: recordId(notification.quizGame), results: notification.action === "results",
  };
  if (["grades", "feedback"].includes(notification.type) || notification.submission) return {
    page: "Grades & Feedback", submissionId: recordId(notification.submission), assessmentId: recordId(notification.assessment),
  };
  if (notification.assessment) return { page: "My Assessments", assessmentId: recordId(notification.assessment) };
  return { page: "My Subjects", subjectId: notification.action === "removed" ? "" : recordId(notification.subject) };
}
