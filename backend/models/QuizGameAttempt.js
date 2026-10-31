const mongoose = require("mongoose");

const quizGameAnswerSchema = new mongoose.Schema(
  {
    questionId: { type: mongoose.Schema.Types.ObjectId, ref: "QuizGameQuestion", required: true },
    selectedChoiceId: { type: mongoose.Schema.Types.ObjectId },
    selectedAnswer: String,
    correctChoiceId: { type: mongoose.Schema.Types.ObjectId },
    correctAnswer: String,
    isCorrect: { type: Boolean, default: false },
    pointsEarned: { type: Number, default: 0 },
    timeTaken: { type: Number, default: 0 },
  },
  { _id: false },
);

const quizGameAttemptSchema = new mongoose.Schema(
  {
    quizGame: { type: mongoose.Schema.Types.ObjectId, ref: "QuizGame", required: true },
    student: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    answers: [quizGameAnswerSchema],
    score: { type: Number, default: 0 },
    correctAnswers: { type: Number, default: 0 },
    incorrectAnswers: { type: Number, default: 0 },
    unansweredQuestions: { type: Number, default: 0 },
    accuracy: { type: Number, default: 0 },
    bestStreak: { type: Number, default: 0 },
    completionTime: { type: Number, default: 0 },
    rank: Number,
    status: { type: String, enum: ["in_progress", "completed"], default: "in_progress" },
    questionSequence: [String],
    startedAt: { type: Date, default: Date.now },
    completedAt: Date,
  },
  { timestamps: true },
);

quizGameAttemptSchema.index({ quizGame: 1, student: 1 }, { unique: true });
quizGameAttemptSchema.index({ student: 1, completedAt: -1, createdAt: -1 });

module.exports = mongoose.model("QuizGameAttempt", quizGameAttemptSchema);
