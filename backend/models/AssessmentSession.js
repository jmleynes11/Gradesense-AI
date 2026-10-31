const mongoose = require("mongoose");

// Starting an assessment must not create a submission or affect grade records.
// The unique key also makes retries and simultaneous starts resume one clock.
const schema = new mongoose.Schema({
  assessment: { type: mongoose.Schema.Types.ObjectId, ref: "Assessment", required: true },
  student: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  startedAt: { type: Date, required: true },
  expiresAt: { type: Date, required: true },
});
schema.index({ assessment: 1, student: 1 }, { unique: true });

module.exports = mongoose.model("AssessmentSession", schema);
