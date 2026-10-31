const Submission = require("../models/Submission");
const Report = require("../models/Report");
const Assessment = require("../models/Assessment");
const { buildPdfReport, buildExcelReport } = require("../services/reportService");
const { assessmentReportData } = require("../services/assessmentReportData");
const { objectId } = require("../utils/queryOptions");
const { httpError } = require("../utils/subjectReference");

async function dataForAssessment(req) {
  const assessmentId = objectId(req.query.assessmentId, "assessment");
  const timeZone = req.query.timeZone || "Asia/Manila";
  try {
    if (typeof timeZone !== "string") throw new Error("Invalid time zone");
    new Intl.DateTimeFormat("en-US", { timeZone });
  } catch {
    throw httpError("Invalid report time zone.", 400, "INVALID_TIME_ZONE");
  }
  const assessment = await Assessment.findOne({ _id: assessmentId, teacher: req.user._id })
    .select("title subject subjectRef totalPoints")
    .populate({ path: "subjectRef", select: "name students", populate: { path: "students", select: "name firstName lastName studentNumber" } })
    .lean();
  if (!assessment) throw httpError("Assessment not found.", 404, "ASSESSMENT_NOT_FOUND");
  const submissions = await Submission.find({ assessment: assessment._id })
    .select("assessment student status score percentage finalScore finalPercentage totalPossiblePoints submittedAt createdAt aiGradingStatus gradedBy")
    .sort({ submittedAt: -1, createdAt: -1 }).lean();
  return assessmentReportData(assessment, submissions, timeZone);
}

async function pdfReport(req, res) {
  const data = await dataForAssessment(req);
  const reportFile = await buildPdfReport(data);
  const report = await Report.create({ teacher: req.user._id, type: "pdf", ...reportFile });
  res.download(report.filePath, report.fileName);
}

async function excelReport(req, res) {
  const data = await dataForAssessment(req);
  const reportFile = await buildExcelReport(data);
  const report = await Report.create({ teacher: req.user._id, type: "excel", ...reportFile });
  res.download(report.filePath, report.fileName);
}

module.exports = { pdfReport, excelReport };
