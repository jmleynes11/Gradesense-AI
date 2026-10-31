const express = require("express");
const controller = require("../controllers/quizGameController");
const { protect, authorize } = require("../middleware/authMiddleware");

const router = express.Router();

router.use(protect);

router.get("/teacher", authorize("teacher"), controller.teacherDashboard);
router.post("/", authorize("teacher"), controller.createGame);
router.get("/student", authorize("student"), controller.studentDashboard);
router.get("/:id/my-result", authorize("student"), controller.studentResult);
router.post("/:id/start", authorize("student"), controller.startGame);
router.post("/attempts/:attemptId/submit", authorize("student"), controller.submitAttempt);
router.get("/:id/leaderboard", controller.leaderboard);
router.get("/:id/results", authorize("teacher"), controller.teacherResults);
router.get("/:id/teacher-leaderboard", authorize("teacher"), controller.teacherLeaderboard);
router.get("/attempts/:attemptId", authorize("teacher"), controller.teacherAttemptDetail);
router.get("/:id", authorize("teacher"), controller.getGame);
router.put("/:id", authorize("teacher"), controller.updateGame);
router.delete("/:id", authorize("teacher"), controller.deleteGame);
router.post("/:id/publish", authorize("teacher"), controller.publishGame);
router.patch("/:id/close", authorize("teacher"), controller.setStatus);
router.patch("/:id/archive", authorize("teacher"), controller.setStatus);
router.post("/:id/questions", authorize("teacher"), controller.addManualQuestion);
router.put("/:id/questions/:questionId", authorize("teacher"), controller.updateGameQuestion);
router.patch("/:id/questions/reorder", authorize("teacher"), controller.reorderGameQuestions);
router.delete("/:id/questions/:questionId", authorize("teacher"), controller.removeGameQuestion);

module.exports = router;
