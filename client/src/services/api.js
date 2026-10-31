const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

function token() {
  return localStorage.getItem("gradesense_token");
}

const pendingReads = new Map();

function request(path, options = {}) {
  if ((options.method || "GET") !== "GET" || options.signal) return performRequest(path, options);
  // Share only active identical reads. No persistent cache or stale mutation data.
  const key = `${token() || "anonymous"}:${path}`;
  if (pendingReads.has(key)) return pendingReads.get(key);
  const pending = performRequest(path, options);
  pendingReads.set(key, pending);
  pending.then(() => pendingReads.delete(key), () => pendingReads.delete(key));
  return pending;
}

async function performRequest(path, options = {}) {
  const isForm = options.body instanceof FormData;
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      ...(isForm ? {} : { "Content-Type": "application/json" }),
      ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
      ...options.headers
    }
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: "Request failed" }));
    throw Object.assign(new Error(error.message || "Request failed"), { status: response.status, submissionId: error.submissionId });
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return response.json();
  return response.blob();
}

export const api = {
  me: () => request("/auth/me"),
  teacherDashboard: () => request("/assessments/dashboard"),
  login: (data) => request("/auth/login", { method: "POST", body: JSON.stringify(data) }),
  register: (data) => request("/auth/register", { method: "POST", body: JSON.stringify(data) }),
  updateProfile: (data) => request("/auth/profile", { method: "PUT", body: JSON.stringify(data) }),
  changePassword: (data) => request("/auth/password", { method: "PUT", body: JSON.stringify(data) }),
  updateProfileImage: (file) => {
    const formData = new FormData();
    formData.append("profileImage", file);
    return request("/auth/profile-image", { method: "PUT", body: formData });
  },
  removeProfileImage: () => request("/auth/profile-image", { method: "DELETE" }),
  subjectDashboard: () => request("/subjects"),
  subjectDetails: (id) => request(`/subjects/${id}`),
  createDashboardSubject: (data) => request("/subjects", { method: "POST", body: JSON.stringify(data) }),
  updateDashboardSubject: (id, data) => request(`/subjects/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  archiveDashboardSubject: (id) => request(`/subjects/${id}/archive`, { method: "PATCH" }),
  deleteDashboardSubject: (id) => request(`/subjects/${id}`, { method: "DELETE" }),
  addStudentToSubject: (subjectId, studentId) => request(`/subjects/${subjectId}/students`, { method: "POST", body: JSON.stringify({ studentId }) }),
  removeStudentFromSubject: (subjectId, studentId) => request(`/subjects/${subjectId}/students/${studentId}`, { method: "DELETE" }),
  teacherStudents: () => request("/subjects/students"),
  assessments: (params = {}) => request(`/assessments?${new URLSearchParams(params)}`),
  createAssessment: (data) => request("/assessments", { method: "POST", body: JSON.stringify(data) }),
  assessment: (id) => request(`/assessments/${id}`),
  updateAssessment: (id, data) => request(`/assessments/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteAssessment: (id) => request(`/assessments/${id}`, { method: "DELETE" }),
  publishSummary: (id) => request(`/assessments/${id}/publish-summary`),
  publishAssessment: (id) => request(`/assessments/${id}/publish`, { method: "POST" }),
  restoreOriginalAssessment: (id) => request(`/assessments/${id}/restore-original`, { method: "POST" }),
  assessmentVersions: (id) => request(`/assessments/${id}/versions`),
  assessmentSubmissionStatus: (id) => request(`/assessments/${id}/submission-status`),
  questions: () => request("/questions"),
  createQuestion: (data) => request("/questions", { method: "POST", body: JSON.stringify(data) }),
  updateQuestion: (id, data) => request(`/questions/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteQuestion: (id) => request(`/questions/${id}`, { method: "DELETE" }),
  duplicateQuestion: (id) => request(`/questions/${id}/duplicate`, { method: "POST" }),
  regenerateQuestion: (id) => request(`/questions/${id}/regenerate`, { method: "POST" }),
  reorderQuestions: (assessmentId, orderedQuestionIds) => request(`/questions/assessment/${assessmentId}/reorder`, { method: "PATCH", body: JSON.stringify({ orderedQuestionIds }) }),
  submissions: (assessmentId = "") => request(`/submissions${assessmentId ? `?assessmentId=${assessmentId}` : ""}`),
  submission: (id) => request(`/submissions/${id}`),
  retryOverallFeedback: (id) => request(`/submissions/${encodeURIComponent(id)}/overall-feedback/retry`, { method: "POST" }),
  analytics: () => request("/assessments/analytics"),
  generateQuiz: (formData) => request("/ai/generate-quiz", { method: "POST", body: formData }),
  studentDashboard: () => request("/student/dashboard"),
  studentAssessments: () => request("/student/assessments?view=summary"),
  studentAssessment: (id) => request(`/student/assessments/${encodeURIComponent(id)}`),
  assessmentInstructions: (id) => request(`/student/assessments/${encodeURIComponent(id)}?view=instructions`),
  startAssessment: (id) => request(`/student/assessments/${encodeURIComponent(id)}/start`, { method: "POST" }),
  studentHistory: () => request("/student/history"),
  submitAssessment: (id, formData) => request(`/submissions/${id}`, { method: "POST", body: formData }),
  overrideSubmission: (id, data) => request(`/submissions/${id}/override`, { method: "PATCH", body: JSON.stringify(data) }),
  overrideSubmissionAnswer: (id, questionId, data) => request(`/submissions/${id}/answers/${questionId}/override`, { method: "PATCH", body: JSON.stringify(data) }),
  adminDashboard: () => request("/admin/dashboard"),
  users: () => request("/admin/users"),
  createUser: (data) => request("/admin/users", { method: "POST", body: JSON.stringify(data) }),
  updateUser: (id, data) => request(`/admin/users/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  auditLogs: () => request("/admin/audit-logs"),
  monitoring: () => request("/admin/monitoring"),
  pdfReport: (assessmentId) => request(`/reports/pdf?${new URLSearchParams({ assessmentId, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone })}`),
  excelReport: (assessmentId) => request(`/reports/excel?${new URLSearchParams({ assessmentId, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone })}`),
  notifications: (type = "") => request(`/notifications${type ? `?type=${type}` : ""}`),
  markNotificationRead: (id) => request(`/notifications/${id}/read`, { method: "PATCH" }),
  markAllNotificationsRead: () => request("/notifications/read-all", { method: "PATCH" }),
  markNotificationsRead: (ids) => request("/notifications/read-all", { method: "PATCH", body: JSON.stringify({ ids }) }),
  sendAnnouncement: (data) => request("/notifications/announcements", { method: "POST", body: JSON.stringify(data) }),
  quizGameTeacherDashboard: () => request("/quiz-games/teacher"),
  createQuizGame: (data) => request("/quiz-games", { method: "POST", body: JSON.stringify(data) }),
  quizGame: (id) => request(`/quiz-games/${id}`),
  updateQuizGame: (id, data) => request(`/quiz-games/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteQuizGame: (id) => request(`/quiz-games/${id}`, { method: "DELETE" }),
  publishQuizGame: (id) => request(`/quiz-games/${id}/publish`, { method: "POST" }),
  closeQuizGame: (id) => request(`/quiz-games/${id}/close`, { method: "PATCH" }),
  archiveQuizGame: (id) => request(`/quiz-games/${id}/archive`, { method: "PATCH" }),
  addQuizGameQuestion: (id, data) => request(`/quiz-games/${id}/questions`, { method: "POST", body: JSON.stringify(data) }),
  updateQuizGameQuestion: (id, questionId, data) => request(`/quiz-games/${id}/questions/${questionId}`, { method: "PUT", body: JSON.stringify(data) }),
  reorderQuizGameQuestions: (id, orderedQuestionIds) => request(`/quiz-games/${id}/questions/reorder`, { method: "PATCH", body: JSON.stringify({ orderedQuestionIds }) }),
  removeQuizGameQuestion: (id, questionId) => request(`/quiz-games/${id}/questions/${questionId}`, { method: "DELETE" }),
  quizGameStudentDashboard: () => request("/quiz-games/student"),
  quizGameStudentResult: (id) => request(`/quiz-games/${encodeURIComponent(id)}/my-result`),
  startQuizGame: (id) => request(`/quiz-games/${id}/start`, { method: "POST" }),
  submitQuizGameAttempt: (attemptId, data) => request(`/quiz-games/attempts/${attemptId}/submit`, { method: "POST", body: JSON.stringify(data) }),
  quizGameLeaderboard: (id) => request(`/quiz-games/${id}/leaderboard`),
  quizGameTeacherLeaderboard: (id) => request(`/quiz-games/${encodeURIComponent(id)}/teacher-leaderboard`),
  quizGameResults: (id) => request(`/quiz-games/${id}/results`),
  quizGameAttemptDetail: (attemptId) => request(`/quiz-games/attempts/${attemptId}`)
};

export function mediaUrl(filePath) {
  if (!filePath) return "";
  if (/^https?:\/\//i.test(filePath)) return filePath;
  return `${API_URL.replace(/\/api\/?$/, "")}${filePath}`;
}

export function saveBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}
