const express = require("express");
const controller = require("../controllers/aiController");
const { protect, authorize } = require("../middleware/authMiddleware");
const upload = require("../middleware/uploadMiddleware");
const quizLimiter = require("../middleware/quizLimiter");

const router = express.Router();

router.use(protect);
router.post(
  "/generate-quiz",
  authorize("teacher"),
  quizLimiter,
  upload.single("lessonFile"),
  controller.generateQuizFromContent,
);
router.post(
  "/grade-essay",
  authorize("teacher", "student"),
  controller.gradeEssayRoute,
);
router.post(
  "/generate-feedback",
  authorize("teacher"),
  controller.feedbackRoute,
);
router.post(
  "/recommendations",
  authorize("teacher", "student"),
  controller.recommendationsRoute,
);

module.exports = router;
