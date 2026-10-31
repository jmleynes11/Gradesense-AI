const { createHash } = require("node:crypto");
const Subject = require("../models/Subject");
const { notifyStudents } = require("./notificationService");

function eventKey(kind, id, value) {
  const revision = createHash("sha256").update(JSON.stringify(value) || "").digest("hex").slice(0, 32);
  return `${kind}:${id}:${revision}`;
}

async function notifySubjectMembership(subject, studentId, action) {
  await notifyStudents([studentId], {
    subject: subject._id, type: "subjects", action,
    eventKey: eventKey(`subject:${action}`, subject._id, [String(studentId), subject.updatedAt]),
    title: action === "removed" ? "Subject assignment removed" : "New subject assignment",
    message: action === "removed" ? `You have been removed from ${subject.name}.` : `You have been assigned to ${subject.name}.`,
  });
}

async function notifyAssessmentUpdated(assessment, revision) {
  if (!["published", "closed"].includes(assessment.status)) return;
  const subject = await Subject.findById(assessment.subjectRef).select("students").lean();
  await notifyStudents(subject?.students || [], {
    subject: assessment.subjectRef, assessment: assessment._id, type: "assessments",
    eventKey: eventKey("assessment:updated", assessment._id, revision),
    title: "Assessment updated",
    message: `${assessment.title} has been updated. Check its details and deadline.`,
  });
}

async function notifyGameAvailable(game) {
  if (game.status !== "active") return;
  const subject = await Subject.findById(game.subjectRef).select("students").lean();
  await notifyStudents(subject?.students || [], {
    subject: game.subjectRef, quizGame: game._id, type: "quiz_games",
    eventKey: `quiz-game:available:${game._id}`,
    title: "New quiz game available",
    message: `${game.title} is now available in ${game.subject}.`,
  });
}

function gradeState(submission) {
  return [submission.status, submission.finalScore ?? submission.score, submission.finalPercentage ?? submission.percentage];
}

function feedbackState(submission) {
  return [submission.teacherComments || "", (submission.answers || []).map((answer) => [String(answer.question), answer.teacherFeedback || "", answer.feedback || ""])];
}

async function notifySubmissionChanges(previous, submission, assessment) {
  const related = { subject: assessment.subjectRef, assessment: assessment._id, submission: submission._id };
  if (submission.status === "graded" && JSON.stringify(gradeState(previous)) !== JSON.stringify(gradeState(submission))) {
    await notifyStudents([submission.student], {
      ...related, type: "grades", title: previous.status === "graded" ? "Final grade updated" : "Assessment grade released",
      message: `Your grade for ${assessment.title} is available.`,
      eventKey: previous.status === "graded"
        ? eventKey("submission:grade-updated", submission._id, [gradeState(submission), submission.modifiedAt])
        : `submission:graded:${submission._id}`,
    });
  }
  if (JSON.stringify(feedbackState(previous)) !== JSON.stringify(feedbackState(submission))) {
    await notifyStudents([submission.student], {
      ...related, type: "feedback", title: "Teacher feedback updated",
      message: `Your teacher updated feedback for ${assessment.title}.`,
      eventKey: eventKey("submission:feedback", submission._id, [feedbackState(submission), submission.modifiedAt]),
    });
  }
}

module.exports = { eventKey, notifySubjectMembership, notifyAssessmentUpdated, notifyGameAvailable, notifySubmissionChanges };
