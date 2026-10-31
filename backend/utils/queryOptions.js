const mongoose = require("mongoose");
const { httpError } = require("./subjectReference");

function pagination(query, defaultLimit = 20) {
  const page = Number(query.page ?? 1);
  const limit = Number(query.limit ?? defaultLimit);
  if (!Number.isSafeInteger(page) || page < 1 || page > 10000 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw httpError("Invalid page or limit. Limit must be between 1 and 100.", 400, "INVALID_PAGINATION");
  }
  return { page, limit, skip: (page - 1) * limit };
}

function objectId(value, name = "identifier") {
  if (typeof value !== "string" || !mongoose.isObjectIdOrHexString(value)) {
    throw httpError(`Invalid ${name}.`, 400, "INVALID_QUERY_ID");
  }
  return value;
}

const assessmentListFields = "title description subject subjectRef assessmentType status isPublished generationId dueDate startDate endDate durationMinutes attemptLimit totalPoints questions difficulty createdAt updatedAt publishedAt";
const assessmentDetailExclusions = "-lessonContent -originalAiVersion -teacherModifiedVersion -versionHistory -answerKey";

module.exports = { pagination, objectId, assessmentListFields, assessmentDetailExclusions };
