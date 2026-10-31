const express = require("express");
const controller = require("../controllers/classController");
const { protect, authorize } = require("../middleware/authMiddleware");

const router = express.Router();

router.use(protect);
router.get("/dashboard", authorize("teacher"), controller.teacherDashboard);
router.get("/subjects", authorize("teacher"), controller.listSubjects);
router.post("/subjects", authorize("teacher"), controller.createSubject);
router.put("/subjects/:subjectId", authorize("teacher"), controller.updateSubject);
router.delete("/subjects/:subjectId", authorize("teacher"), controller.deleteSubject);
router.get("/students", authorize("teacher"), controller.listStudents);
router.route("/").get(controller.listClasses).post(authorize("teacher"), controller.createClass);
router.route("/:id").put(authorize("teacher"), controller.updateClass).delete(authorize("teacher"), controller.deleteClass);
router.post("/:id/students", authorize("teacher"), controller.addStudent);
router.delete("/:id/students", authorize("teacher"), controller.removeStudent);

module.exports = router;
