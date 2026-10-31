function id(value) {
  return String(value?._id || value || "");
}

function nameParts(student) {
  const name = String(student?.name || "").trim();
  const comma = name.indexOf(",");
  const words = name.split(/\s+/);
  return {
    lastName: student?.lastName?.trim() || (comma >= 0 ? name.slice(0, comma).trim() : words.at(-1)),
    firstName: student?.firstName?.trim() || (comma >= 0 ? name.slice(comma + 1).trim() : words.slice(0, -1).join(" ")),
  };
}

// Missing submissions are display rows only; never create or update stored records.
function assessmentSubmissionRows(submissions, assessments) {
  const rows = [...submissions];
  const recorded = new Set(submissions.map((row) => `${id(row.assessment)}:${id(row.student)}`));
  for (const assessment of assessments) {
    const { students = [], ...subject } = assessment.subjectRef || {};
    for (const student of students) {
      if (!student) continue;
      const key = `${id(assessment)}:${id(student)}`;
      if (recorded.has(key)) continue;
      rows.push({
        _id: `not-submitted:${key}`,
        student,
        assessment: { ...assessment, subjectRef: subject },
        status: "not_submitted",
        submittedAt: null,
        score: null,
        percentage: null,
      });
      recorded.add(key);
    }
  }
  const compare = (left, right) => left.localeCompare(right, undefined, { sensitivity: "base" });
  return rows.sort((left, right) => {
    const a = nameParts(left.student);
    const b = nameParts(right.student);
    return compare(a.lastName, b.lastName) || compare(a.firstName, b.firstName) || compare(id(left), id(right));
  });
}

module.exports = { assessmentSubmissionRows };
