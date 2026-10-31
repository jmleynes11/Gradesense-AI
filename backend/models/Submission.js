const mongoose = require("mongoose");

const answerSchema = new mongoose.Schema(
  {
    question: { type: mongoose.Schema.Types.ObjectId, ref: "Question" },
    questionType: {
      type: String,
      enum: ["multiple_choice", "true_false", "identification", "essay", "coding"]
    },
    questionText: String,
    correctAnswer: String,
    pointsPossible: { type: Number, default: 0 },
    answer: String,
    score: { type: Number, default: null },
    isCorrect: Boolean,
    feedback: String,
    teacherFeedback: String,
    aiScore: Number,
    aiStatus: {
      type: String,
      enum: ["not_applicable", "graded", "local_fallback", "processing", "pending_review", "failed", "teacher_reviewed"],
      default: "not_applicable"
    },
    aiError: String,
    finalScore: Number,
    rubricBreakdown: mongoose.Schema.Types.Mixed,
    strengths: [String],
    weaknesses: [String],
    missingOrIncorrectConcepts: [String],
    suggestions: [String],
    plagiarismReport: {
      similarityPercentage: { type: Number, default: 0 },
      matchingStudent: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      matchingStudentName: String,
      highlightedText: [String],
      status: {
        type: String,
        enum: ["Low Risk", "Medium Risk", "High Risk"],
        default: "Low Risk",
      },
    },
    aiContentReport: {
      probability: {
        type: String,
        enum: ["Low", "Medium", "High"],
        default: "Low",
      },
      confidencePercentage: { type: Number, default: 0 },
      reasoning: String,
      writingPatternAnalysis: [String],
    },
    codeLanguage: String,
    codeSubmission: String,
    sampleInput: String,
    expectedOutput: String
  },
  { _id: false }
);

const submissionSchema = new mongoose.Schema(
  {
    assessment: { type: mongoose.Schema.Types.ObjectId, ref: "Assessment", required: true },
    student: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    answers: [answerSchema],
    supportingDocument: String,
    score: { type: Number, default: 0 },
    percentage: { type: Number, default: 0 },
    aiScore: { type: Number, default: 0 },
    aiPercentage: { type: Number, default: 0 },
    aiGradingStatus: {
      type: String,
      enum: ["not_required", "completed", "partial_fallback", "processing", "pending_review"],
      default: "not_required"
    },
    finalScore: { type: Number, default: 0 },
    finalPercentage: { type: Number, default: 0 },
    status: { type: String, enum: ["pending", "submitted", "graded"], default: "pending" },
    teacherOverrideScore: Number,
    attemptNumber: { type: Number, default: 1 },
    questionSequence: [String],
    startedAt: Date,
    timeExpired: { type: Boolean, default: false },
    overrideReason: String,
    teacherComments: String,
    modifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    gradedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    totalPossiblePoints: { type: Number, default: 0 },
    gradedPointsEarned: { type: Number, default: null },
    gradedPossiblePoints: { type: Number, default: 0 },
    gradedQuestionCount: { type: Number, default: 0 },
    pendingQuestionCount: { type: Number, default: 0 },
    passStatus: { type: String, enum: ["passed", "failed", "not_applicable"], default: "not_applicable" },
    submittedAt: Date,
    modifiedAt: Date,
    gradedAt: Date,
    gradingLeaseUntil: Date,
    gradingLeaseOwner: String,
    overallFeedback: {
      status: { type: String, enum: ["processing", "completed", "failed"] },
      inputHash: String,
      summary: String,
      strengths: [String],
      weaknesses: [String],
      recommendations: [String],
      generatedAt: Date,
      leaseUntil: Date,
      leaseOwner: String,
    },
  },
  { timestamps: true }
);

submissionSchema.index({ assessment: 1, student: 1 }, { unique: true });
submissionSchema.index({ student: 1, status: 1, assessment: 1 });

module.exports = mongoose.model("Submission", submissionSchema);
