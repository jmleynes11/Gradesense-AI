const mongoose = require("mongoose");
const Subject = require("../models/Subject");

function httpError(message, status = 400, code) {
  const error = new Error(message);
  error.status = status;
  if (code) error.code = code;
  return error;
}

function normalizeSubjectRef(value) {
  return typeof value === "string" ? value.trim() : value;
}

async function findTeacherSubject(teacherId, subjectRef) {
  const value = normalizeSubjectRef(subjectRef);
  if (!value) {
    throw httpError("Select an existing subject.", 400, "MISSING_SUBJECT_ID");
  }
  if (!mongoose.isObjectIdOrHexString(value)) {
    throw httpError("The selected subject is invalid. Select an existing subject and try again.", 400, "INVALID_SUBJECT_ID");
  }

  const subject = await Subject.findOne({
    _id: value,
    teacher: teacherId,
    archived: { $ne: true },
  });

  if (!subject) {
    throw httpError("The selected subject was not found or is no longer available.", 404, "SUBJECT_NOT_FOUND");
  }

  return subject;
}

module.exports = { findTeacherSubject, httpError, normalizeSubjectRef };
