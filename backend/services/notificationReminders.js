const Assessment = require("../models/Assessment");
const Subject = require("../models/Subject");
const Submission = require("../models/Submission");
const { notifyStudents } = require("./notificationService");

const reminderWindowMs = 24 * 60 * 60 * 1000;

async function createDeadlineReminders(studentId, now = new Date()) {
  const subjects = await Subject.find({ archived: { $ne: true }, ...(studentId ? { students: studentId } : {}) })
    .select("_id students").lean();
  if (!subjects.length) return;
  const byId = new Map(subjects.map((subject) => [String(subject._id), subject]));
  const assessments = await Assessment.find({
    subjectRef: { $in: subjects.map((subject) => subject._id) }, status: "published",
    $or: [
      { endDate: { $gt: now, $lte: new Date(now.getTime() + reminderWindowMs) } },
      { endDate: null, dueDate: { $gt: now, $lte: new Date(now.getTime() + reminderWindowMs) } },
    ],
    $and: [{ $or: [{ startDate: null }, { startDate: { $lte: now } }] }],
  }).select("_id title subjectRef endDate dueDate").lean();
  if (!assessments.length) return;
  const submitted = await Submission.find({
    assessment: { $in: assessments.map((assessment) => assessment._id) },
    ...(studentId ? { student: studentId } : {}),
  }).select("assessment student").lean();
  const completed = new Set(submitted.map((submission) => `${submission.assessment}:${submission.student}`));
  for (const assessment of assessments) {
    const deadline = new Date(assessment.endDate || assessment.dueDate);
    const recipients = (byId.get(String(assessment.subjectRef))?.students || []).filter((student) =>
      (!studentId || String(student) === String(studentId)) && !completed.has(`${assessment._id}:${student}`));
    await notifyStudents(recipients, {
      subject: assessment.subjectRef, assessment: assessment._id, type: "assessments",
      eventKey: `assessment:deadline:${assessment._id}:${deadline.toISOString()}`,
      title: "Assessment deadline approaching",
      message: `${assessment.title} is due within 24 hours (${deadline.toISOString()}).`,
    });
  }
}

function startNotificationReminders() {
  let running = false;
  async function run() {
    if (running) return;
    running = true;
    try { await createDeadlineReminders(); }
    catch (error) { console.error("Notification reminders failed:", error.message); }
    finally { running = false; }
  }
  void run();
  const timer = setInterval(run, 60000);
  timer.unref();
  return timer;
}

module.exports = { createDeadlineReminders, startNotificationReminders };
