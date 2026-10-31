const express = require("express");
const controller = require("../controllers/submissionController");
const { protect, authorize } = require("../middleware/authMiddleware");
const upload = require("../middleware/uploadMiddleware");

const router = express.Router();

router.use(protect);
router.get("/", controller.listSubmissions);
router.get("/:id", controller.getSubmission);
router.post("/:id/overall-feedback/retry", authorize("student"), controller.retryOverallFeedback);
router.post("/:assessmentId", authorize("student"), upload.single("supportingDocument"), controller.submitAssessment);
router.patch("/:id/override", authorize("teacher"), controller.overrideScore);
router.patch("/:id/answers/:questionId/override", authorize("teacher"), controller.updateAnswerOverride);

module.exports = router;
