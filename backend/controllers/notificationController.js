const Notification = require("../models/Notification");
const Announcement = require("../models/Announcement");
const Subject = require("../models/Subject");
const { notifyStudents, notifyReadState } = require("../services/notificationService");
const { createDeadlineReminders } = require("../services/notificationReminders");

async function listNotifications(req, res) {
  await createDeadlineReminders(req.user._id);
  const filter = { student: req.user._id };
  if (req.query.type) filter.type = req.query.type;
  const notifications = await Notification.find(filter).sort({ createdAt: -1, _id: -1 }).limit(100);
  const unreadCount = await Notification.countDocuments({ student: req.user._id, isRead: false });
  res.json({ notifications, unreadCount });
}

async function markRead(req, res) {
  const item = await Notification.findOneAndUpdate({ _id: req.params.id, student: req.user._id }, { isRead: true }, { new: true });
  if (!item) return res.status(404).json({ message: "Notification not found" });
  notifyReadState(req.user._id);
  res.json({ notification: item, unreadCount: await Notification.countDocuments({ student: req.user._id, isRead: false }) });
}

async function markAllRead(req, res) {
  const filter = { student: req.user._id, isRead: false };
  if (req.body?.ids !== undefined) {
    if (!Array.isArray(req.body.ids) || req.body.ids.length > 100 || req.body.ids.some((id) => !/^[a-f\d]{24}$/i.test(String(id)))) {
      return res.status(400).json({ message: "Invalid notification IDs" });
    }
    filter._id = { $in: req.body.ids };
  }
  await Notification.updateMany(filter, { isRead: true });
  notifyReadState(req.user._id);
  res.json({ message: "Notifications marked as read", unreadCount: await Notification.countDocuments({ student: req.user._id, isRead: false }) });
}

async function sendAnnouncement(req, res) {
  const subject = await Subject.findOne({ _id: req.body.subject, teacher: req.user._id });
  if (!subject) return res.status(404).json({ message: "Subject not found" });

  const enrolled = new Set(subject.students.map(String));
  const targetStudents = req.body.students?.length ? req.body.students.filter((student) => enrolled.has(String(student))) : subject.students;
  const announcement = await Announcement.create({
    teacher: req.user._id,
    subject: subject._id,
    students: targetStudents,
    title: req.body.title,
    message: req.body.message
  });

  await notifyStudents(targetStudents, {
    subject: subject._id,
    title: req.body.title,
    message: req.body.message,
    type: "announcements",
    eventKey: `announcement:${announcement._id}`
  });

  res.status(201).json(announcement);
}

module.exports = { listNotifications, markRead, markAllRead, sendAnnouncement };
