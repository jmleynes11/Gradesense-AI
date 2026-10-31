const express = require("express");
const controller = require("../controllers/assessmentController");
const { protect, authorize } = require("../middleware/authMiddleware");

const router = express.Router();
const dashboardController = require("../controllers/dashboardController");

router.use(protect);
router.get("/analytics", authorize("teacher"), controller.analytics);
router.get("/dashboard", authorize("teacher"), dashboardController.teacherDashboard);
router.route("/").get(controller.listAssessments).post(authorize("teacher"), controller.createAssessment);
router.get("/:id", authorize("teacher"), controller.getAssessment);
router.get("/:id/publish-summary", authorize("teacher"), controller.publishSummary);
router.get("/:id/submission-status", authorize("teacher"), controller.submissionStatus);
router.post("/:id/publish", authorize("teacher"), controller.publishAssessment);
router.post("/:id/restore-original", authorize("teacher"), controller.restoreOriginal);
router.get("/:id/versions", authorize("teacher"), controller.compareVersions);
router.route("/:id").put(authorize("teacher"), controller.updateAssessment).delete(authorize("teacher"), controller.deleteAssessment);

module.exports = router;
