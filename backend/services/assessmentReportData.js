const { assessmentSubmissionRows } = require("./assessmentSubmissionRows");

const id = (value) => String(value?._id || value || "");
const isNumber = (value) => typeof value === "number" && Number.isFinite(value);

// Match Student Submission Management's name and grade display without changing the table.
function studentName(student) {
  const name = String(student?.name || "").trim();
  const comma = name.indexOf(",");
  const words = name.split(/\s+/);
  const lastName = student?.lastName?.trim() || (comma >= 0 ? name.slice(0, comma).trim() : words.at(-1));
  let firstName = student?.firstName?.trim() || (comma >= 0 ? name.slice(comma + 1).trim() : words.slice(0, -1).join(" "));
  const suffix = ` ${lastName}`;
  const fullGivenNames = comma >= 0 ? name.slice(comma + 1).trim()
    : lastName && name.toLocaleLowerCase().endsWith(suffix.toLocaleLowerCase()) ? name.slice(0, -suffix.length).trim() : "";
  if (fullGivenNames && (!firstName || fullGivenNames === firstName || fullGivenNames.startsWith(`${firstName} `))) firstName = fullGivenNames;
  return [lastName, firstName].filter(Boolean).join(", ") || "Unknown";
}

function assessmentReportData(assessment, submissions, timeZone = "Asia/Manila") {
  const roster = new Map((assessment.subjectRef?.students || []).filter(Boolean).map((student) => [id(student), student]));
  const submittedByStudent = new Map();
  // The query is newest first. Ignore incomplete records and historical duplicates.
  for (const submission of submissions) {
    const studentId = id(submission.student);
    if (id(submission.assessment) !== id(assessment) || !roster.has(studentId)
      || !["submitted", "graded"].includes(submission.status) || submittedByStudent.has(studentId)) continue;
    submittedByStudent.set(studentId, { ...submission, student: roster.get(studentId), assessment });
  }
  const currentAssessment = { ...assessment, subjectRef: { ...assessment.subjectRef, students: [...roster.values()] } };
  const records = assessmentSubmissionRows([...submittedByStudent.values()], [currentAssessment]);
  const rows = records.map((submission) => {
    const missing = submission.status === "not_submitted";
    const pending = submission.status === "submitted"
      || (["processing", "pending_review"].includes(submission.aiGradingStatus) && !submission.gradedBy);
    const pendingText = submission.aiGradingStatus === "processing" ? "Pending essay grading" : "Pending teacher review";
    const earned = submission.finalScore ?? submission.score;
    const possible = submission.totalPossiblePoints;
    const percentage = submission.finalPercentage ?? submission.percentage;
    const score = !missing && !pending && isNumber(earned) && isNumber(possible) && possible > 0 ? earned : null;
    const percent = !missing && !pending && isNumber(percentage) ? percentage : null;
    const date = missing ? null : new Date(submission.submittedAt || submission.createdAt);
    return {
      student: studentName(submission.student), studentNumber: submission.student?.studentNumber || "None",
      subject: assessment.subject || assessment.subjectRef?.name || "Unassigned", assessment: assessment.title,
      submittedAt: date && Number.isFinite(date.getTime()) ? date : null,
      status: missing ? "Not Submitted" : submission.status === "graded" ? "Graded" : "Submitted",
      score, totalPoints: possible, percentage: percent,
      scoreText: missing ? "Not submitted" : pending ? pendingText : score === null ? "Score unavailable" : `${score}/${possible}`,
      percentageText: missing ? "Not submitted" : pending ? pendingText : percent === null ? "Percentage unavailable" : `${percent}%`,
    };
  });
  const graded = rows.filter((row) => row.status === "Graded" && row.percentage !== null);
  return {
    assessment: { _id: id(assessment), title: assessment.title, subject: assessment.subject || assessment.subjectRef?.name || "Unassigned" },
    timeZone, rows,
    summary: {
      totalStudents: roster.size, submitted: submittedByStudent.size, notSubmitted: roster.size - submittedByStudent.size,
      averageScore: graded.length ? Math.round(graded.reduce((sum, row) => sum + row.percentage, 0) / graded.length) : null,
    },
  };
}

module.exports = { assessmentReportData };
