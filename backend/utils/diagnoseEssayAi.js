// Explicit live diagnostic: synthetic data only; no MongoDB writes or student accounts.
require("dotenv").config({ quiet: true });
const fs = require("node:fs/promises");
const path = require("node:path");
const { gradeAnswer, summarizeSubmission } = require("../services/submissionService");
const { question, lessonContent, cases } = require("./essayGradingCases");
const { checkEvaluation, compareEquivalentAnswers } = require("./essayEvaluationChecks");
const { setTimeout: delay } = require("node:timers/promises");

async function main() {
  const directory = path.join(__dirname, "../diagnostics");
  const args = process.argv.slice(2);
  const rerunFailures = args.includes("--failed");
  const priorReport = rerunFailures ? JSON.parse(await fs.readFile(path.join(directory, "essay-grading.json"), "utf8")) : null;
  const records = [];
  const results = [];
  const selectedNames = rerunFailures ? priorReport.results.filter((item) => {
    const current = cases.find((sample) => sample.name === item.name);
    return !item.passed || current?.answer !== item.answer || current?.expectedMin !== item.expectedMin || current?.expectedMax !== item.expectedMax
      || JSON.stringify(current?.expectedCriterionRanges) !== JSON.stringify(item.expectedCriterionRanges);
  }).map((item) => item.name)
    : args.map((argument) => argument.replace(/^--case=/, ""));
  if (rerunFailures && !selectedNames.length) {
    console.log("No failed cases to rerun.");
    return;
  }
  if (selectedNames.some((name) => !cases.some((sample) => sample.name === name))) throw new Error("Unknown diagnostic case");
  const selectedCases = selectedNames.length ? cases.filter((sample) => selectedNames.includes(sample.name)) : cases;
  // Pace synthetic requests to avoid exhausting a small provider TPM allowance.
  const intervalMs = Number(process.env.ESSAY_DIAGNOSTIC_INTERVAL_MS ?? 20000);
  if (!Number.isFinite(intervalMs) || intervalMs < 0 || intervalMs > 60000) throw new Error("Invalid diagnostic interval");
  const originalInfo = console.info;
  console.info = (...args) => {
    if (args[0] === "[Essay AI grading]") records.push(JSON.parse(args[1]));
    originalInfo(...args);
  };
  try {
    for (const sample of selectedCases) {
      if (results.length) await delay(intervalMs);
      const answer = await gradeAnswer(question, sample.answer, {
        lessonContent, assessmentId: "synthetic-matter-assessment", studentId: "synthetic-student",
        Submission: { find: () => ({ populate: async () => [] }) },
      });
      const totals = summarizeSubmission([answer], { questions: [question], totalPoints: 10 });
      const validationIssues = checkEvaluation(sample, answer, question.points);
      const passed = validationIssues.length === 0;
      results.push({ ...sample, score: answer.score, aiStatus: answer.aiStatus, passed,
        feedback: answer.feedback, rubricBreakdown: answer.rubricBreakdown, strengths: answer.strengths,
        weaknesses: answer.weaknesses, missingOrIncorrectConcepts: answer.missingOrIncorrectConcepts,
        suggestions: answer.suggestions, validationIssues, totals });
      console.log(`${sample.name}: ${answer.score ?? "PENDING"}/10; expected ${sample.expectedMin}-${sample.expectedMax}; ${passed ? "PASS" : "FAIL"}`);
    }
  } finally { console.info = originalInfo; }
  if (priorReport) {
    const fresh = new Map(results.map((item) => [item.name, item]));
    results.splice(0, results.length, ...priorReport.results.map((item) => fresh.get(item.name) || item));
  }
  const comparisons = compareEquivalentAnswers(results).filter((comparison) =>
    results.some((item) => item.name === "correct") && results.some((item) => comparison.name === `correct_vs_${item.name}`));
  await fs.mkdir(directory, { recursive: true });
  const file = path.join(directory, selectedNames.length && !rerunFailures ? "essay-grading-subset.json" : "essay-grading.json");
  const previousRuns = priorReport ? [...(priorReport.previousRuns || []),
    { timestamp: priorReport.timestamp, results: priorReport.results, comparisons: priorReport.comparisons }] : [];
  await fs.writeFile(file, JSON.stringify({ timestamp: new Date().toISOString(), synthetic: true, question, results, comparisons,
    verificationMode: rerunFailures ? "rerun_failed_cases_after_changes" : "fresh_run", previousRuns,
    logs: [...(priorReport?.logs || []), ...records] }, null, 2));
  console.log(`Report: ${file}`);
  if (results.some((item) => !item.passed) || comparisons.some((item) => !item.passed)) process.exitCode = 1;
}
main().catch((error) => { console.error("Essay diagnostic failed:", error.code || error.name); process.exitCode = 1; });
