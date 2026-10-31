const User = require("../models/User");
const Assessment = require("../models/Assessment");
const Submission = require("../models/Submission");
const Subject = require("../models/Subject");
const QuizGame = require("../models/QuizGame");
const AuditLog = require("../models/AuditLog");
const logAction = require("../utils/audit");
const { verifyConfiguration } = require("../services/openaiService");

async function dashboard(req, res) {
  const [totalTeachers, totalStudents, totalUsers, totalAssessments, totalSubjects, totalQuizGames, totalSubmissions] = await Promise.all([
    User.countDocuments({ role: "teacher" }), User.countDocuments({ role: "student" }), User.countDocuments(),
    Assessment.countDocuments(), Subject.countDocuments(), QuizGame.countDocuments(), Submission.countDocuments(),
  ]);
  res.json({ totalTeachers, totalStudents, totalUsers, totalAssessments, totalSubjects, totalQuizGames, totalSubmissions });
}
async function users(req, res) {
  res.json(await User.find().select("-password").sort({ name: 1 }));
}

async function createUser(req, res) {
  const { email, password, role, subject, studentNumber, isActive = true } = req.body;
  const firstName = typeof req.body.firstName === "string" ? req.body.firstName.trim() : "";
  const lastName = typeof req.body.lastName === "string" ? req.body.lastName.trim() : "";
  if (!firstName || !lastName || !email || !password || !role) return res.status(400).json({ message: "First name, last name, email, password, and role are required" });
  if (!["admin", "teacher", "student"].includes(role)) return res.status(400).json({ message: "Invalid user role" });
  if (role === "student" && !String(studentNumber || "").trim()) {
    return res.status(400).json({ message: "Student Number is required for student accounts" });
  }

  const exists = await User.findOne({ email });
  if (exists) return res.status(400).json({ message: "Email already exists" });

  const user = await User.create({ firstName, lastName, email, password, role, subject, studentNumber: role === "student" ? String(studentNumber).trim() : "", isActive });
  await logAction(req, "create_user", "admin", `Created ${email}`);
  res.status(201).json({
    _id: user._id,
    name: user.name,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    role: user.role,
    subject: user.subject,
    studentNumber: user.studentNumber,
    isActive: user.isActive
  });
}

async function updateUser(req, res) {
  const allowed = ["firstName", "lastName", "email", "role", "subject", "studentNumber", "isActive"];
  const updates = {};
  allowed.forEach((key) => {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  });
  for (const key of ["firstName", "lastName"]) {
    if (updates[key] !== undefined) {
      if (typeof updates[key] !== "string" || !updates[key].trim()) return res.status(400).json({ message: "First name and last name are required." });
      updates[key] = updates[key].trim();
    }
  }

  const user = await User.findById(req.params.id).select("+password");
  if (!user) return res.status(404).json({ message: "User not found" });

  const nextRole = updates.role === undefined ? user.role : updates.role;
  const nextStudentNumber = updates.studentNumber === undefined ? user.studentNumber : updates.studentNumber;
  if (!["admin", "teacher", "student"].includes(nextRole)) return res.status(400).json({ message: "Invalid user role" });
  if (nextRole === "student" && !String(nextStudentNumber || "").trim()) {
    return res.status(400).json({ message: "Student Number is required for student accounts" });
  }
  if (nextRole !== "student") updates.studentNumber = "";
  if (updates.studentNumber !== undefined) updates.studentNumber = String(updates.studentNumber).trim();

  Object.assign(user, updates);
  if (req.body.password) user.password = req.body.password;
  await user.save();

  await logAction(req, "update_user", "admin", `Updated ${req.params.id}`);
  res.json({
    _id: user._id,
    name: user.name,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    role: user.role,
    subject: user.subject,
    studentNumber: user.studentNumber,
    isActive: user.isActive
  });
}

async function deleteUser(req, res) {
  await User.findByIdAndDelete(req.params.id);
  await logAction(req, "delete_user", "admin", `Deleted ${req.params.id}`);
  res.json({ message: "User deleted" });
}

async function monitoring(req, res) {
  res.json({
    loginActivity: await AuditLog.find({ action: "login" }).sort({ createdAt: -1 }).limit(20).populate("actor", "name email"),
    totalAssessmentsCreated: await Assessment.countDocuments(),
    totalSubmissions: await Submission.countDocuments()
  });
}

async function aiDiagnostic(req, res) {
  res.json(await verifyConfiguration());
}

async function logs(req, res) {
  res.json(await AuditLog.find().sort({ createdAt: -1 }).limit(100).populate("actor", "name email role"));
}

async function backup(req, res) {
  res.json({ message: "Mock backup completed", createdAt: new Date() });
}

async function restore(req, res) {
  res.json({ message: "Mock restore completed", createdAt: new Date() });
}

module.exports = { dashboard, users, createUser, updateUser, deleteUser, monitoring, aiDiagnostic, logs, backup, restore };
