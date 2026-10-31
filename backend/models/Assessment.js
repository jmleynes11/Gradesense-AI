const mongoose = require("mongoose");

const assessmentSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: String,
    // `subjectRef` is the canonical academic relationship. `subject` remains a
    // denormalized display value so existing records remain readable during
    // migration from the retired Class feature.
    subjectRef: { type: mongoose.Schema.Types.ObjectId, ref: "Subject", required: true, index: true },
    subject: { type: String, required: true },
    dueDate: Date,
    instructions: {
      type: String,
      required: true,
      default: "Read each question carefully before answering.",
    },
    assessmentType: {
      type: String,
      enum: ["quiz", "seatwork", "assignment", "exam", "activity", "programming"],
      required: true,
    },
    teacher: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    questions: [{ type: mongoose.Schema.Types.ObjectId, ref: "Question" }],
    totalPoints: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["draft", "published", "closed", "archived"],
      default: "draft",
    },
    isPublished: { type: Boolean, default: false },
    difficulty: {
      type: String,
      enum: ["easy", "medium", "hard"],
      default: "medium",
    },
    teacherPrompt: String,
    passingMark: { type: Number, default: 75 },
    startDate: Date,
    endDate: Date,
    durationMinutes: { type: Number, default: 30 },
    allowPreviousQuestions: { type: Boolean, default: true },
    lockPreviousQuestions: { type: Boolean, default: false },
    randomizeQuestions: { type: Boolean, default: true },
    randomizeChoices: { type: Boolean, default: true },
    attemptLimit: { type: Number, default: 1 },
    allowAnswerReview: { type: Boolean, default: true },
    generationId: { type: String, index: true },
    lessonSummary: String,
    // Retained internally for AI essay evaluation; never sent to students.
    lessonContent: String,
    topicsIdentified: [String],
    keyConcepts: [String],
    unsupportedRequests: [String],
    aiGradingConfig: {
      contentAccuracy: { type: Number, default: 40 },
      understanding: { type: Number, default: 30 },
      organization: { type: Number, default: 20 },
      grammarClarity: { type: Number, default: 10 },
    },
    feedbackRules: [String],
    learningRecommendations: [String],
    answerKey: [
      {
        question: String,
        answer: String,
        explanation: String,
      },
    ],
    originalAiVersion: mongoose.Schema.Types.Mixed,
    teacherModifiedVersion: mongoose.Schema.Types.Mixed,
    versionHistory: [
      {
        action: String,
        changedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        snapshot: mongoose.Schema.Types.Mixed,
        createdAt: { type: Date, default: Date.now },
      },
    ],
    pdfHash: String,
    tokenUsage: {
      prompt: Number,
      completion: Number,
      total: Number,
    },
    publishedAt: Date,
  },
  { timestamps: true },
);

assessmentSchema.index({ teacher: 1, pdfHash: 1 }, { unique: true, sparse: true });
assessmentSchema.index({ teacher: 1, status: 1, updatedAt: -1, _id: -1 });
assessmentSchema.index({ subjectRef: 1, status: 1, publishedAt: -1 });

module.exports = mongoose.model("Assessment", assessmentSchema);
