function assessmentSnapshot(assessment) {
  const source = typeof assessment.toObject === "function" ? assessment.toObject() : assessment;
  const { versionHistory, teacherModifiedVersion, originalAiVersion, lessonContent, ...snapshot } = source;
  return snapshot;
}

module.exports = { assessmentSnapshot };
