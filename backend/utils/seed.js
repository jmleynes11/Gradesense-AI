const dotenv = require("dotenv");
const mongoose = require("mongoose");
const User = require("../models/User");
const Class = require("../models/Class");
const Assessment = require("../models/Assessment");
const Question = require("../models/Question");
const Submission = require("../models/Submission");
const Feedback = require("../models/Feedback");

dotenv.config();

async function seed() {
  await mongoose.connect(process.env.MONGO_URI);
  await Promise.all([
    User.deleteMany(),
    Class.deleteMany(),
    Assessment.deleteMany(),
    Question.deleteMany(),
    Submission.deleteMany(),
    Feedback.deleteMany()
  ]);

  const admin = await User.create({ firstName: "Admin", lastName: "User", 
    email: "admin@gradesense.test", password: "password123", role: "admin" });
  const teacher = await User.create({ firstName: "Teacher", lastName: "Demo", email: "teacher@gradesense.test", password: "password123", role: "teacher", subject: "Science" });
  const student = await User.create({ firstName: "Student", lastName: "Demo", email: "student@gradesense.test", password: "password123", role: "student", studentNumber: "S-1001" });

  const cls = await Class.create({ className: "BSIT 4A", subject: "Science", schoolYear: "2026-2027", teacher: teacher._id, students: [student._id] });
  const assessment = await Assessment.create({
    title: "Matter Quiz",
    description: "Basic objective and essay assessment.",
    class: cls._id,
    subject: "Science",
    dueDate: new Date(),
    assessmentType: "quiz",
    teacher: teacher._id
  });

  const questions = await Question.insertMany([
    { teacher: teacher._id, assessment: assessment._id, type: "multiple_choice", text: "What is matter?", choices: ["Anything with mass and volume", "Only liquids", "Only gases"], answerKey: "Anything with mass and volume", points: 1, subject: "Science", topic: "Matter" },
    { teacher: teacher._id, assessment: assessment._id, type: "true_false", text: "Solids have a definite shape.", choices: ["True", "False"], answerKey: "True", points: 1, subject: "Science", topic: "Matter" },
    { teacher: teacher._id, assessment: assessment._id, type: "essay", text: "Explain the states of matter.", answerKey: "", points: 5, rubric: "Mention solid, liquid, gas, and explain differences.", subject: "Science", topic: "Matter" }
  ]);

  assessment.questions = questions.map((question) => question._id);
  assessment.totalPoints = 7;
  await assessment.save();

  await Submission.create({
    assessment: assessment._id,
    student: student._id,
    answers: [],
    score: 0,
    percentage: 0,
    status: "pending"
  });

  console.log("Seed complete");
  console.log("Admin: admin@gradesense.test / password123");
  console.log("Teacher: teacher@gradesense.test / password123");
  console.log("Student: student@gradesense.test / password123");
  console.log(admin.email);
  await mongoose.disconnect();
}

seed().catch((error) => {
  console.error(error);
  process.exit(1);
});
