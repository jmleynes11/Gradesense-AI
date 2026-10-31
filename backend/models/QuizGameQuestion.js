const mongoose = require("mongoose");

const quizGameChoiceSchema = new mongoose.Schema(
  {
    label: { type: String, enum: ["A", "B", "C", "D"], required: true },
    value: { type: String, required: true },
  },
  { _id: true },
);

const quizGameQuestionSchema = new mongoose.Schema(
  {
    questionText: { type: String, required: true },
    choices: {
      type: [quizGameChoiceSchema],
      validate: {
        validator: (choices) => Array.isArray(choices) && choices.length === 4,
        message: "Quiz game questions require exactly 4 choices.",
      },
    },
    correctChoiceId: { type: mongoose.Schema.Types.ObjectId },
    correctAnswer: { type: String, enum: ["A", "B", "C", "D"], required: true },
    subject: String,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

module.exports = mongoose.model("QuizGameQuestion", quizGameQuestionSchema);
