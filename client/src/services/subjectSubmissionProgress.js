function id(value) {
  return String(value?._id || value || "");
}

export function subjectSubmissionProgress(assessmentId, students = [], submissions = []) {
  const assigned = new Set(students.map(id).filter(Boolean));
  const submitted = new Set();
  for (const submission of submissions) {
    const studentId = id(submission.student);
    if (id(submission.assessment) === id(assessmentId)
      && assigned.has(studentId)
      && ["submitted", "graded"].includes(submission.status)) {
      submitted.add(studentId);
    }
  }
  return `${submitted.size} / ${assigned.size}`;
}
