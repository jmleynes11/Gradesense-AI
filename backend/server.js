const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const path = require("path");
const http = require("http");
const { Server } = require("socket.io");
const connectDB = require("./config/db");
const { initNotifications } = require("./services/notificationService");
const { startNotificationReminders } = require("./services/notificationReminders");

dotenv.config();
const { startSubmissionGrading } = require("./services/submissionGrading");

connectDB().then(() => { if (process.env.MONGO_URI) { startSubmissionGrading(); startNotificationReminders(); } });

const app = express();

app.use(cors());
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.get("/", (req, res) => {
  res.send("GradeSense AI API is running");
});

app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/subjects", require("./routes/subjectRoutes"));
app.use("/api/assessments", require("./routes/assessmentRoutes"));
app.use("/api/questions", require("./routes/questionRoutes"));
app.use("/api/submissions", require("./routes/submissionRoutes"));
app.use("/api/student", require("./routes/studentRoutes"));
app.use("/api/ai", require("./routes/aiRoutes"));
app.use("/api/admin", require("./routes/adminRoutes"));
app.use("/api/reports", require("./routes/reportRoutes"));
app.use("/api/notifications", require("./routes/notificationRoutes"));
app.use("/api/quiz-games", require("./routes/quizGameRoutes"));

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);

  if (error.name === "CastError") {
    console.error("Invalid database identifier:", error);
    return res.status(400).json({
      message: "An invalid record identifier was provided.",
      code: "INVALID_ID",
    });
  }

  const status = error.status || (error.code === "LIMIT_FILE_SIZE" ? 413 : 500);
  return res.status(status).json({
    message:
      error.code === "LIMIT_FILE_SIZE"
        ? "Uploaded file is too large."
        : error.message || "Request failed",
    code: error.code,
  });
});

const PORT = process.env.PORT || 5000;

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});
initNotifications(io);

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
