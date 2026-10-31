const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    subject: { type: mongoose.Schema.Types.ObjectId, ref: "Subject" },
    assessment: { type: mongoose.Schema.Types.ObjectId, ref: "Assessment" },
    submission: { type: mongoose.Schema.Types.ObjectId, ref: "Submission" },
    quizGame: { type: mongoose.Schema.Types.ObjectId, ref: "QuizGame" },
    eventKey: String,
    action: String,
    title: { type: String, required: true },
    message: { type: String, required: true },
    type: {
      type: String,
      enum: ["subjects", "assessments", "seatworks", "assignments", "exams", "quiz_games", "grades", "feedback", "announcements", "learning_recommendations"],
      default: "assessments"
    },
    isRead: { type: Boolean, default: false }
  },
  { timestamps: true }
);

notificationSchema.index({ student: 1, createdAt: -1 });
notificationSchema.index({ student: 1, isRead: 1 });
notificationSchema.index({ student: 1, eventKey: 1 }, { unique: true, partialFilterExpression: { eventKey: { $type: "string" } } });
module.exports = mongoose.model("Notification", notificationSchema);
