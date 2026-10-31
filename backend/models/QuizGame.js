const mongoose = require("mongoose");

const quizGameSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: String,
    teacher: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    subjectRef: { type: mongoose.Schema.Types.ObjectId, ref: "Subject", required: true, index: true },
    subject: { type: String, required: true },
    topic: String,
    instructions: {
      type: String,
      default: "Answer each multiple-choice question as quickly and accurately as you can.",
    },
    questions: [{ type: mongoose.Schema.Types.ObjectId, ref: "QuizGameQuestion" }],
    timePerQuestion: { type: Number, default: 15 },
    randomizeQuestions: { type: Boolean, default: true },
    randomizeChoices: { type: Boolean, default: true },
    enablePoints: { type: Boolean, default: true },
    enableStreak: { type: Boolean, default: true },
    showCorrectAnswer: { type: Boolean, default: true },
    showLeaderboard: { type: Boolean, default: true },
    allowReplay: { type: Boolean, default: true },
    scoring: {
      correctPoints: { type: Number, default: 100 },
      speedBonusWithin5: { type: Number, default: 50 },
      speedBonusWithin10: { type: Number, default: 25 },
      streakBonus2: { type: Number, default: 20 },
      streakBonus3: { type: Number, default: 50 },
      streakBonus5: { type: Number, default: 100 },
    },
    status: {
      type: String,
      enum: ["draft", "active", "completed", "archived"],
      default: "draft",
    },
    publishedAt: Date,
    closedAt: Date,
  },
  { timestamps: true },
);

quizGameSchema.index({ teacher: 1, updatedAt: -1 });
quizGameSchema.index({ subjectRef: 1, status: 1, publishedAt: -1 });
module.exports = mongoose.model("QuizGame", quizGameSchema);
