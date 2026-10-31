const Assessment = require("../models/Assessment");
const Question = require("../models/Question");
const Submission = require("../models/Submission");
const Feedback = require("../models/Feedback");
const Notification = require("../models/Notification");

async function deleteAssessmentCascade(assessmentId, teacherId) {
  const assessment = await Assessment.findOne({ _id: assessmentId, teacher: teacherId });
  if (!assessment) return null;

  const submissions = await Submission.find({ assessment: assessment._id }).select("_id");
  const submissionIds = submissions.map((submission) => submission._id);

  const [questionDelete, feedbackDelete, submissionDelete, notificationDelete] = await Promise.all([
    Question.deleteMany({ assessment: assessment._id }),
    Feedback.deleteMany({
      $or: [
        { assessment: assessment._id },
        { submission: { $in: submissionIds } },
      ],
    }),
    Submission.deleteMany({ assessment: assessment._id }),
    Notification.deleteMany({ assessment: assessment._id }),
  ]);

  await Assessment.deleteOne({ _id: assessment._id, teacher: teacherId });

  return {
    assessment,
    deleted: {
      questions: questionDelete.deletedCount || 0,
      submissions: submissionDelete.deletedCount || 0,
      feedback: feedbackDelete.deletedCount || 0,
      notifications: notificationDelete.deletedCount || 0,
    },
  };
}

module.exports = {
  deleteAssessmentCascade,
};
