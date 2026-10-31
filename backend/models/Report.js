const mongoose = require("mongoose");

const reportSchema = new mongoose.Schema(
  {
    teacher: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    subject: { type: mongoose.Schema.Types.ObjectId, ref: "Subject" },
    student: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    type: { type: String, enum: ["pdf", "excel"], required: true },
    fileName: String,
    filePath: String
  },
  { timestamps: true }
);

module.exports = mongoose.model("Report", reportSchema);
