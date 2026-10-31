const { test } = require("node:test");
const assert = require("node:assert/strict");

test("subject progress counts only distinct assigned students with successful submissions for that assessment", async () => {
  const { subjectSubmissionProgress } = await import("../../client/src/services/subjectSubmissionProgress.js");
  const students = [{ _id: "amy" }, { _id: "ben" }, { _id: "chen" }, { _id: "amy" }, null];
  const submissions = [
    { assessment: "quiz", student: { _id: "amy" }, status: "submitted", aiGradingStatus: "processing" },
    { assessment: "quiz", student: "amy", status: "graded" },
    { assessment: { _id: "quiz" }, student: { _id: "ben" }, status: "graded" },
    { assessment: "quiz", student: "chen", status: "pending" },
    { assessment: "quiz", student: "chen", status: "not_submitted" },
    { assessment: "quiz", student: "former-student", status: "graded" },
    { assessment: "quiz", student: null, status: "submitted" },
    { assessment: "exam", student: "chen", status: "submitted" },
  ];
  assert.equal(subjectSubmissionProgress("quiz", students, submissions), "2 / 3");
  assert.equal(subjectSubmissionProgress("exam", students, submissions), "1 / 3");
  assert.equal(subjectSubmissionProgress("new", students, submissions), "0 / 3");
  assert.equal(subjectSubmissionProgress("quiz", [], submissions), "0 / 0");
});

test("fresh submission and roster reads update progress without changing records", async () => {
  const { subjectSubmissionProgress } = await import("../../client/src/services/subjectSubmissionProgress.js");
  const students = ["amy", "ben"];
  const records = [{ assessment: "quiz", student: "amy", status: "pending" }];
  assert.equal(subjectSubmissionProgress("quiz", students, records), "0 / 2");
  records[0].status = "submitted";
  assert.equal(subjectSubmissionProgress("quiz", students, records), "1 / 2");
  records[0].status = "graded";
  records.push({ assessment: "quiz", student: "ben", status: "submitted" });
  const original = structuredClone(records);
  assert.equal(subjectSubmissionProgress("quiz", students, records), "2 / 2");
  assert.equal(subjectSubmissionProgress("quiz", ["ben"], records), "1 / 1");
  assert.equal(subjectSubmissionProgress("quiz", [...students, "chen"], records), "2 / 3");
  assert.deepEqual(records, original);
  assert.deepEqual(students, ["amy", "ben"]);
});
