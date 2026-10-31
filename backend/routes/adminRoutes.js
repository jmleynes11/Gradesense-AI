const express = require("express");
const controller = require("../controllers/adminController");
const { protect, authorize } = require("../middleware/authMiddleware");

const router = express.Router();

router.use(protect, authorize("admin"));
router.get("/dashboard", controller.dashboard);
router.route("/users").get(controller.users).post(controller.createUser);
router.put("/users/:id", controller.updateUser);
router.delete("/users/:id", controller.deleteUser);
router.get("/monitoring", controller.monitoring);
router.get("/ai-diagnostic", controller.aiDiagnostic);
router.get("/audit-logs", controller.logs);
router.post("/backup", controller.backup);
router.post("/restore", controller.restore);

module.exports = router;
