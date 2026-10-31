const mongoose = require("mongoose");

const subjectSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    // Code remains optional at schema level so existing subject records continue to work.
    // New Subjects API requests validate it as required.
    code: { type: String, trim: true, uppercase: true },
    description: { type: String, trim: true, default: "" },
    academicYear: { type: String, trim: true, default: "" },
    archived: { type: Boolean, default: false },
    teacher: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    students: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  },
  { timestamps: true },
);

subjectSchema.index({ teacher: 1, name: 1 }, { unique: true });
subjectSchema.index({ teacher: 1, code: 1 }, { unique: true, sparse: true });
subjectSchema.index({ students: 1, archived: 1 });

module.exports = mongoose.model("Subject", subjectSchema);
