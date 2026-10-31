const { randomUUID } = require("node:crypto");
const jwt = require("jsonwebtoken");
const Notification = require("../models/Notification");
const User = require("../models/User");

let io;

function initNotifications(socketServer) {
  io = socketServer;
  io.use(async (socket, next) => {
    try {
      const decoded = jwt.verify(socket.handshake.auth?.token || "", process.env.JWT_SECRET || "dev_secret");
      const user = await User.findById(decoded.id).select("role isActive").lean();
      if (!user || !user.isActive || user.role !== "student") return next(new Error("Not authorized"));
      socket.data.studentId = String(user._id);
      next();
    } catch {
      next(new Error("Not authorized"));
    }
  });
  io.on("connection", (socket) => {
    // Room membership comes only from the authenticated account, never a client-supplied ID.
    socket.join(`student:${socket.data.studentId}`);
  });
}

function notifyReadState(student) {
  io?.to(`student:${student}`).emit("notification:changed");
}

async function notifyStudents(students, payload) {
  const ids = [...new Set(students.map((student) => String(student?._id || student)).filter(Boolean))];
  if (!ids.length) return [];
  const recipients = await User.find({ _id: { $in: ids }, role: "student" }).select("_id").lean();
  if (!recipients.length) return [];
  await Notification.init();
  const eventKey = payload.eventKey || randomUUID();
  const rows = [];
  for (const student of recipients) {
    const filter = { student: student._id, eventKey };
    try {
      const result = await Notification.findOneAndUpdate(filter, {
        $setOnInsert: {
          ...filter, subject: payload.subject, assessment: payload.assessment,
          submission: payload.submission, quizGame: payload.quizGame, action: payload.action,
          title: payload.title, message: payload.message, type: payload.type, isRead: false,
        },
      }, { upsert: true, new: true, includeResultMetadata: true, runValidators: true });
      if (!result.lastErrorObject.updatedExisting) {
        rows.push(result.value);
        io?.to(`student:${student._id}`).emit("notification:new", result.value);
      }
    } catch (error) {
      // Another process can win the same unique (student, eventKey) insert.
      if (error.code !== 11000) throw error;
    }
  }
  return rows;
}

module.exports = { initNotifications, notifyStudents, notifyReadState };
