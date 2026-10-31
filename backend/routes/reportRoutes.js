const express = require("express");
const { pdfReport, excelReport } = require("../controllers/reportController");
const { protect, authorize } = require("../middleware/authMiddleware");

const router = express.Router();

router.use(protect, authorize("teacher"));
router.get("/pdf", pdfReport);
router.get("/excel", excelReport);

module.exports = router;
