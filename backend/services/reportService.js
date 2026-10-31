const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");
const { randomUUID } = require("node:crypto");
const { finished } = require("node:stream/promises");

function reportDir() {
  const dir = path.join(__dirname, "../uploads/reports");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function reportDate(value, timeZone) {
  return value ? new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit",
  }).format(value) : "Not recorded";
}

// Excel dates have no time zone. Store the same local wall time shown in the page/PDF.
function excelDate(value, timeZone) {
  if (!value) return "Not recorded";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(value);
  const fields = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return new Date(Date.UTC(Number(fields.year), Number(fields.month) - 1, Number(fields.day), Number(fields.hour), Number(fields.minute), Number(fields.second)));
}

function numberFormat(value) {
  const [mantissa, exponent = "0"] = String(value).split("e");
  const decimals = Math.min(15, Math.max(0, (mantissa.split(".")[1]?.length || 0) - Number(exponent)));
  return decimals ? `0.${"0".repeat(decimals)}` : "0";
}

async function buildPdfReport(data) {
  const fileName = `assessment-${data.assessment._id}-${randomUUID()}.pdf`;
  const filePath = path.join(reportDir(), fileName);
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 32, bufferPages: true,
    info: { Title: `${data.assessment.title} - Student Submissions`, Author: "GradeSense AI" } });
  const output = fs.createWriteStream(filePath);
  const complete = finished(output);
  doc.on("error", (error) => output.destroy(error));
  doc.pipe(output);
  const left = 32, width = doc.page.width - 64, bottom = doc.page.height - 48;
  const regular = fs.existsSync(path.join(process.env.WINDIR || "C:/Windows", "Fonts/arial.ttf"))
    ? path.join(process.env.WINDIR || "C:/Windows", "Fonts/arial.ttf") : "Helvetica";
  const bold = fs.existsSync(path.join(process.env.WINDIR || "C:/Windows", "Fonts/arialbd.ttf"))
    ? path.join(process.env.WINDIR || "C:/Windows", "Fonts/arialbd.ttf") : "Helvetica-Bold";
  const columns = [
    ["Student Name", 0.17], ["Student Number", 0.10], ["Subject", 0.12], ["Assessment", 0.15],
    ["Submission Date and Time", 0.14], ["Status", 0.10], ["Total Score", 0.11], ["Percentage", 0.11],
  ];
  let y = 32;
  function heading(continued = false) {
    doc.font(bold).fontSize(continued ? 13 : 18).fillColor("#172033").text(data.assessment.title, left, y, { width });
    y = doc.y + 5;
    doc.font(regular).fontSize(11).text(`Subject: ${data.assessment.subject}`, left, y, { width });
    y = doc.y + 7;
    doc.fontSize(9).fillColor("#526074").text(`Student Submission Report${continued ? " (continued)" : ""}`, left, y, { width });
    y = doc.y + 14;
  }
  function tableRow(values, header = false, stripe = false) {
    doc.font(header ? bold : regular).fontSize(9);
    const height = Math.max(32, ...values.map((value, index) =>
      doc.heightOfString(String(value), { width: width * columns[index][1] - 12 }) + 14));
    let x = left;
    doc.rect(left, y, width, height).fill(header ? "#C94D00" : stripe ? "#F5F7FA" : "#FFFFFF");
    values.forEach((value, index) => {
      const cellWidth = width * columns[index][1];
      doc.fillColor(header ? "#FFFFFF" : "#172033").text(String(value), x + 6, y + 7, { width: cellWidth - 12 });
      x += cellWidth;
    });
    doc.moveTo(left, y + height).lineTo(left + width, y + height).strokeColor("#DFE4EB").lineWidth(0.5).stroke();
    y += height;
  }
  heading();
  const summary = data.summary;
  const metrics = [
    ["Total students", summary.totalStudents], ["Submitted", summary.submitted],
    ["Not submitted", summary.notSubmitted], ["Average score", summary.averageScore === null ? "Pending" : `${summary.averageScore}%`],
  ];
  metrics.forEach(([label, value], index) => {
    const x = left + index * width / 4;
    doc.font(regular).fontSize(9).fillColor("#526074").text(label, x, y, { width: width / 4 });
    doc.font(bold).fontSize(15).fillColor("#172033").text(String(value), x, y + 16, { width: width / 4 });
  });
  y += 49;
  doc.font(regular).fontSize(8).fillColor("#526074").text(`Submission times: ${data.timeZone}. Average score includes finalized grades only.`, left, y, { width });
  y = doc.y + 12;
  tableRow(columns.map(([label]) => label), true);
  data.rows.forEach((row, index) => {
    const values = [row.student, row.studentNumber, row.subject, row.assessment, reportDate(row.submittedAt, data.timeZone), row.status, row.scoreText, row.percentageText];
    doc.font(regular).fontSize(9);
    const height = Math.max(32, ...values.map((value, column) => doc.heightOfString(String(value), { width: width * columns[column][1] - 12 }) + 14));
    if (y + height > bottom) {
      doc.addPage(); y = 32; heading(true); tableRow(columns.map(([label]) => label), true);
    }
    tableRow(values, false, index % 2 === 1);
  });
  if (!data.rows.length) {
    doc.font(regular).fontSize(10).fillColor("#526074").text("No students are assigned to this assessment's subject.", left + 6, y + 12, { width: width - 12 });
  }
  const pages = doc.bufferedPageRange();
  for (let page = pages.start; page < pages.start + pages.count; page++) {
    doc.switchToPage(page);
    const margin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font(regular).fontSize(8).fillColor("#526074").text(`GradeSense AI   |   Page ${page + 1} of ${pages.count}`, left, doc.page.height - 27, { width, align: "right", lineBreak: false });
    doc.page.margins.bottom = margin;
  }
  doc.end();
  await complete;
  return { fileName, filePath };
}

async function buildExcelReport(data) {
  const fileName = `assessment-${data.assessment._id}-${randomUUID()}.xlsx`;
  const filePath = path.join(reportDir(), fileName);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "GradeSense AI";
  const summary = workbook.addWorksheet("Assessment Summary", { views: [{ showGridLines: false }] });
  summary.columns = [{ width: 30 }, { width: 65 }];
  summary.getCell("A2").value = "Assessment Summary";
  const details = [
    ["Assessment name", data.assessment.title], ["Subject", data.assessment.subject],
    ["Total students", data.summary.totalStudents], ["Submitted", data.summary.submitted],
    ["Not submitted", data.summary.notSubmitted], ["Average score", data.summary.averageScore === null ? "Pending" : data.summary.averageScore / 100],
    ["Submission times", data.timeZone],
  ];
  details.forEach((values, index) => {
    const row = summary.getRow(index + 4);
    row.values = values;
    row.height = Math.max(26, Math.ceil(String(values[1]).length / 55) * 16 + 10);
    row.eachCell((cell) => {
      cell.font = { name: "Arial", size: 11, color: { argb: "FF172033" } };
      cell.alignment = { vertical: "middle", wrapText: true, horizontal: typeof cell.value === "number" ? "right" : "left" };
    });
    row.getCell(1).font.bold = true;
    if (index >= 2 && index <= 4) row.getCell(2).numFmt = "0";
    if (index === 5) row.getCell(2).numFmt = "0%";
  });
  summary.getCell("A2").font = { name: "Arial", size: 16, bold: true, color: { argb: "FFC94D00" } };
  summary.getRow(2).height = 28;
  summary.getCell("A12").value = "Average score includes finalized grades only.";
  summary.getCell("A12").font = { name: "Arial", size: 10, italic: true, color: { argb: "FF526074" } };
  summary.getCell("A12").alignment = { wrapText: true };
  summary.getRow(12).height = 32;
  const sheet = workbook.addWorksheet("Student Submissions", {
    views: [{ state: "frozen", xSplit: 2, ySplit: 1, showGridLines: false }],
    pageSetup: { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: "1:1" },
  });
  sheet.columns = [
    { header: "Student Name", key: "student", width: 32 },
    { header: "Student Number", key: "studentNumber", width: 20 },
    { header: "Subject", key: "subject", width: 26 },
    { header: "Assessment", key: "assessment", width: 34 },
    { header: "Submission Date and Time", key: "submittedAt", width: 28 },
    { header: "Status", key: "status", width: 20 },
    { header: "Total Score", key: "score", width: 24 },
    { header: "Percentage", key: "percentage", width: 24 },
  ];
  sheet.getRow(1).height = 32;
  sheet.getRow(1).eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFC94D00" } };
    cell.font = { name: "Arial", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });
  data.rows.forEach((item, index) => {
    const row = sheet.addRow({ ...item,
      submittedAt: excelDate(item.submittedAt, data.timeZone),
      score: item.score === null ? item.scoreText : item.score,
      percentage: item.percentage === null ? item.percentageText : item.percentage / 100,
    });
    let lines = 1;
    row.eachCell((cell, column) => {
      cell.font = { name: "Arial", size: 11, color: { argb: "FF172033" } };
      cell.alignment = { vertical: "middle", wrapText: true, horizontal: typeof cell.value === "number" ? "right" : "left" };
      if (index % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F7FA" } };
      if (!(cell.value instanceof Date)) lines = Math.max(lines, ...String(cell.value).split("\n").map((line) => Math.ceil(line.length * 1.2 / (sheet.getColumn(column).width - 2))));
    });
    row.height = Math.max(30, lines * 16 + 8);
    row.getCell("submittedAt").numFmt = "mmm d, yyyy h:mm:ss AM/PM";
    if (item.score !== null) row.getCell("score").numFmt = `${numberFormat(item.score)}"/${item.totalPoints}"`;
    if (item.percentage !== null) row.getCell("percentage").numFmt = `${numberFormat(item.percentage)}%`;
  });
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: sheet.rowCount, column: 8 } };
  await workbook.xlsx.writeFile(filePath);
  return { fileName, filePath };
}

module.exports = { buildPdfReport, buildExcelReport };
