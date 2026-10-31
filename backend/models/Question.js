const mongoose = require("mongoose");

const questionSchema = new mongoose.Schema(
  {
    teacher: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    assessment: { type: mongoose.Schema.Types.ObjectId, ref: "Assessment" },
    type: {
      type: String,
      enum: ["multiple_choice", "true_false", "identification", "essay", "coding"],
      required: true
    },
    text: { type: String, required: true },
    choices: [String],
    answerKey: String,
    acceptableAnswers: [String],
    explanation: String,
    suggestedAnswer: String,
    sourceEvidence: String,
    order: { type: Number, default: 0 },
    points: { type: Number, default: 1 },
    subject: String,
    topic: String,
    rubric: mongoose.Schema.Types.Mixed,
    programming: {
      language: {
        type: String,
        enum: ["Java", "Python", "JavaScript", "C++", "C#", ""],
        default: "",
      },
      allowedLanguages: {
        type: [String],
        default: ["Java", "Python", "JavaScript", "C++", "C#"],
      },
      starterCode: String,
      expectedOutput: String,
      sampleInput: String,
      sampleOutput: String,
      timeLimitSeconds: { type: Number, default: 2 },
    },
    difficulty: { type: String, enum: ["easy", "medium", "hard"], default: "medium" }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Question", questionSchema);
