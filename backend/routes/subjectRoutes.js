const express = require("express");
const controller = require("../controllers/subjectController");
const { protect, authorize } = require("../middleware/authMiddleware");

const router = express.Router();
router.use(protect, authorize("teacher", "student"));
router.get("/", controller.listSubjects);
router.get("/students", authorize("teacher"), controller.listStudents);
router.post("/", authorize("teacher"), controller.createSubject);
router.post("/:id/students", authorize("teacher"), controller.addStudent);
router.delete("/:id/students/:studentId", authorize("teacher"), controller.removeStudent);
router.get("/:id", controller.subjectDetails);
router.put("/:id", authorize("teacher"), controller.updateSubject);
router.patch("/:id/archive", authorize("teacher"), controller.archiveSubject);
router.delete("/:id", authorize("teacher"), controller.deleteSubject);

module.exports = router;
