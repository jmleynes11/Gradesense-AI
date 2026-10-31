const mongoose = require("mongoose");

const studentSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    gradeLevel: String,
    section: String,
    guardianName: String
  },
  { timestamps: true }
);

module.exports = mongoose.model("Student", studentSchema);
