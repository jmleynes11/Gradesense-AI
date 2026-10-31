const express = require("express");
const controller = require("../controllers/studentController");
const dashboardController = require("../controllers/dashboardController");
const { protect, authorize } = require("../middleware/authMiddleware");

const router = express.Router();

router.use(protect, authorize("student"));
router.get("/dashboard", dashboardController.studentDashboard);
router.get("/assessments", controller.assignedAssessments);
router.get("/assessments/:id", controller.assignedAssessments);
router.post("/assessments/:id/start", controller.startAssessment);
router.get("/history", controller.gradeHistory);

module.exports = router;
