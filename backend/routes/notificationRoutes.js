const express = require("express");
const controller = require("../controllers/notificationController");
const { protect, authorize } = require("../middleware/authMiddleware");

const router = express.Router();

router.use(protect);
router.get("/", authorize("student"), controller.listNotifications);
router.patch("/:id/read", authorize("student"), controller.markRead);
router.patch("/read-all", authorize("student"), controller.markAllRead);
router.post("/announcements", authorize("teacher"), controller.sendAnnouncement);

module.exports = router;
