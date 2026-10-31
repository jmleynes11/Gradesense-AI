const Class = require("../models/Class");
const Assessment = require("../models/Assessment");
const Submission = require("../models/Submission");
const User = require("../models/User");
const Subject = require("../models/Subject");
const logAction = require("../utils/audit");
const { sortStudents } = require("../utils/studentSort");

async function listClasses(req, res) {
  const filter = req.user.role === "teacher" ? { teacher: req.user._id } : { students: req.user._id };
  const classes = await Class.find(filter).populate("students", "name email studentNumber role").populate("teacher", "name email");
  classes.forEach((classItem) => { classItem.students = sortStudents(classItem.students); });
  res.json(classes);
}

async function createClass(req, res) {
  const subject = await Subject.findOne({ name: req.body.subject, teacher: req.user._id, archived: { $ne: true } });
  if (!subject) return res.status(400).json({ message: "Select an existing subject before creating a class." });
  const studentIds = Array.isArray(req.body.students) ? req.body.students : [];
  if (studentIds.length) {
    const count = await User.countDocuments({ _id: { $in: studentIds }, role: "student" });
    if (count !== studentIds.length) return res.status(400).json({ message: "One or more selected students do not exist." });
  }
  const item = await Class.create({ ...req.body, subject: subject.name, students: studentIds, teacher: req.user._id });
  await logAction(req, "create_class", "classes", item.className);
  const created = await Class.findById(item._id).populate("students", "name email studentNumber role").populate("teacher", "name email");
  created.students = sortStudents(created.students);
  res.status(201).json(created);
}

async function updateClass(req, res) {
  if (req.body.subject) {
    const subject = await Subject.findOne({ name: req.body.subject, teacher: req.user._id, archived: { $ne: true } });
    if (!subject) return res.status(400).json({ message: "Select an existing subject." });
  }
  const item = await Class.findOneAndUpdate({ _id: req.params.id, teacher: req.user._id }, req.body, { new: true });
  if (!item) return res.status(404).json({ message: "Class not found" });
  item.students = sortStudents(item.students);
  res.json(item);
}

async function deleteClass(req, res) {
  const item = await Class.findOneAndDelete({ _id: req.params.id, teacher: req.user._id });
  if (!item) return res.status(404).json({ message: "Class not found" });
  res.json({ message: "Class deleted" });
}

async function addStudent(req, res) {
  const student = await User.findOne({ _id: req.body.studentId, role: "student" });
  if (!student) return res.status(404).json({ message: "Student not found" });
  const item = await Class.findOneAndUpdate({ _id: req.params.id, teacher: req.user._id }, { $addToSet: { students: student._id } }, { new: true }).populate("students", "name email studentNumber role");
  if (!item) return res.status(404).json({ message: "Class not found" });
  item.students = sortStudents(item.students);
  res.json(item);
}

async function removeStudent(req, res) {
  const item = await Class.findOneAndUpdate({ _id: req.params.id, teacher: req.user._id }, { $pull: { students: req.body.studentId } }, { new: true }).populate("students", "name email studentNumber role");
  if (!item) return res.status(404).json({ message: "Class not found" });
  item.students = sortStudents(item.students);
  res.json(item);
}

async function listStudents(req, res) {
  const students = await User.find({ role: "student" }).select("name email studentNumber role").sort({ name: 1 });
  const classes = await Class.find({ teacher: req.user._id }).select("className students");
  const classByStudent = {};
  classes.forEach((classItem) => {
    classItem.students.forEach((studentId) => {
      classByStudent[String(studentId)] = { _id: classItem._id, className: classItem.className };
    });
  });

  res.json(students.map((student) => ({
    ...student.toObject(),
    classAssignment: classByStudent[String(student._id)] || null
  })));
}

async function createStudent(req, res) {
  res.status(403).json({ message: "Only admins can create student accounts." });
}

async function listSubjects(req, res) {
  const subjects = await Subject.find({ teacher: req.user._id, archived: { $ne: true } }).sort({ name: 1 });
  res.json(subjects);
}

async function createSubject(req, res) {
  if (!req.body.name?.trim()) return res.status(400).json({ message: "Subject name is required." });
  try {
    const subject = await Subject.create({ name: req.body.name.trim(), teacher: req.user._id });
    res.status(201).json(subject);
  } catch (error) {
    if (error.code === 11000) return res.status(400).json({ message: "Subject already exists." });
    throw error;
  }
}

async function updateSubject(req, res) {
  if (!req.body.name?.trim()) return res.status(400).json({ message: "Subject name is required." });
  const existing = await Subject.findOne({ _id: req.params.subjectId, teacher: req.user._id });
  if (!existing) return res.status(404).json({ message: "Subject not found" });
  const oldName = existing.name;
  existing.name = req.body.name.trim();
  await existing.save();
  await Class.updateMany({ teacher: req.user._id, subject: oldName }, { subject: existing.name });
  const subject = existing;
  if (!subject) return res.status(404).json({ message: "Subject not found" });
  res.json(subject);
}

async function deleteSubject(req, res) {
  const subject = await Subject.findOne({ _id: req.params.subjectId, teacher: req.user._id });
  if (!subject) return res.status(404).json({ message: "Subject not found" });
  const inUse = await Class.findOne({ teacher: req.user._id, subject: subject.name });
  if (inUse) return res.status(400).json({ message: "Subject is assigned to a class and cannot be deleted." });
  await subject.deleteOne();
  res.json({ message: "Subject deleted" });
}

async function updateStudent(req, res) {
  const { name, email, studentNumber, classId } = req.body;
  const student = await User.findOne({ _id: req.params.studentId, role: "student" });
  if (!student) return res.status(404).json({ message: "Student not found" });

  if (email && email !== student.email) {
    const exists = await User.findOne({ email, _id: { $ne: student._id } });
    if (exists) return res.status(400).json({ message: "Email already exists." });
  }

  student.name = name ?? student.name;
  student.email = email ?? student.email;
  student.studentNumber = studentNumber ?? student.studentNumber;
  await student.save();

  if (classId !== undefined) {
    await Class.updateMany({ teacher: req.user._id }, { $pull: { students: student._id } });
    if (classId) {
      const classItem = await Class.findOneAndUpdate({ _id: classId, teacher: req.user._id }, { $addToSet: { students: student._id } });
      if (!classItem) return res.status(404).json({ message: "Class not found" });
    }
  }

  res.json({
    _id: student._id,
    name: student.name,
    email: student.email,
    studentNumber: student.studentNumber,
    role: student.role
  });
}

async function teacherDashboard(req, res) {
  const classes = await Class.find({ teacher: req.user._id });
  // Classes remain available for their own management workflow. Assessments are
  // owned by the teacher and linked to Subjects, never to Class records.
  const assessments = await Assessment.find({ teacher: req.user._id });
  const submissions = await Submission.find({ assessment: { $in: assessments.map((item) => item._id) }, status: "graded" });
  const average = submissions.length ? Math.round(submissions.reduce((sum, item) => sum + item.percentage, 0) / submissions.length) : 0;
  res.json({
    totalClasses: classes.length,
    totalStudents: new Set(classes.flatMap((item) => item.students.map(String))).size,
    totalAssessments: assessments.length,
    averageClassScore: average
  });
}

module.exports = { listClasses, createClass, updateClass, deleteClass, addStudent, removeStudent, listStudents, createStudent, updateStudent, listSubjects, createSubject, updateSubject, deleteSubject, teacherDashboard };
