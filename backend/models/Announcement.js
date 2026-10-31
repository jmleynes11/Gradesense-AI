const mongoose = require("mongoose");

const announcementSchema = new mongoose.Schema(
  {
    teacher: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    subject: { type: mongoose.Schema.Types.ObjectId, ref: "Subject" },
    students: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    title: { type: String, required: true },
    message: { type: String, required: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Announcement", announcementSchema);
