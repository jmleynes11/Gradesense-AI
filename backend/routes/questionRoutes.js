const express = require("express");
const controller = require("../controllers/questionController");
const { protect, authorize } = require("../middleware/authMiddleware");

const router = express.Router();

router.use(protect, authorize("teacher"));
router.route("/").get(controller.listQuestions).post(controller.createQuestion);
router.post("/:id/duplicate", controller.duplicateQuestion);
router.post("/:id/regenerate", controller.regenerateQuestion);
router.patch("/assessment/:assessmentId/reorder", controller.reorderQuestions);
router.route("/:id").put(controller.updateQuestion).delete(controller.deleteQuestion);

module.exports = router;
