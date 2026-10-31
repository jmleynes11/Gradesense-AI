const mongoose = require("mongoose");

const feedbackSchema = new mongoose.Schema(
  {
    submission: { type: mongoose.Schema.Types.ObjectId, ref: "Submission", required: true },
    student: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    assessment: { type: mongoose.Schema.Types.ObjectId, ref: "Assessment", required: true },
    strengths: [String],
    weaknesses: [String],
    recommendations: [String],
    summary: String
  },
  { timestamps: true }
);

feedbackSchema.index({ submission: 1 });
feedbackSchema.index({ student: 1, createdAt: -1 });
module.exports = mongoose.model("Feedback", feedbackSchema);
