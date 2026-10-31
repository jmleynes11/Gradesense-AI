// Explicit live Groq diagnostic. Uses a synthetic lesson, never user uploads,
// never OpenAI, and never the database. Normal automated tests remain offline.
const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "../.env"), quiet: true });
const { processPlainLessonText, processUploadedDocument } = require("../services/documentProcessingService");
const { analyzeLesson, compactLessonForAi } = require("../services/lessonAnalysisService");
const groq = require("../services/groqService");
const { inspectQuizResponse } = require("../services/quizResponseValidation");

async function main() {
  const lesson = "Solar energy comes from sunlight. Solar panels convert sunlight into electricity. Wind energy comes from moving air. Wind turbines convert wind energy into electricity. Hydro energy comes from flowing water. Water turbines convert hydro energy into electricity. Geothermal energy comes from heat inside Earth. Solar, wind, hydro, and geothermal energy are renewable energy sources.";
  const fileIndex = process.argv.indexOf("--file");
  const filePath = fileIndex >= 0 ? process.argv[fileIndex + 1] : null;
  if (fileIndex >= 0 && !filePath) throw new Error("--file requires a document path.");
  const processed = filePath ? await processUploadedDocument({ originalname: path.basename(filePath), path: filePath }) : processPlainLessonText(lesson);
  const analysis = analyzeLesson(processed.text);
  const mixed = process.argv.includes("--mixed");
  const counts = mixed ? { multiple_choice: 10, true_false: 10, identification: 5, essay: 3 }
    : { multiple_choice: 1, true_false: 0, identification: 0, essay: 0 };
  if (process.argv.includes("--application")) {
    // Isolated diagnostic process: exercise real prompts, preparation and shared
    // validation, but disable the paid fallback before loading the AI service.
    require("../services/openaiService").createCompletion = async () => {
      throw Object.assign(new Error("OpenAI is disabled for this live diagnostic."), { code: "OPENAI_DIAGNOSTIC_DISABLED", status: 503 });
    };
    const originalGroqCompletion = groq.createCompletion;
    groq.createCompletion = async (...args) => {
      try { return await originalGroqCompletion(...args); }
      catch (error) {
        // Safe output diagnostics: never print provider generation or lesson text.
        let candidate;
        const generated = error.error?.failed_generation;
        try { candidate = typeof generated === "string" ? JSON.parse(generated) : null; } catch {}
        console.info("[Groq diagnostic]", {
          code: error.code, generatedJsonAvailable: typeof generated === "string",
          generatedJsonParsable: Boolean(candidate),
          questionsRepresentation: Array.isArray(candidate?.questions) ? "array" : typeof candidate?.questions,
          questionCount: Array.isArray(candidate?.questions) ? candidate.questions.length : candidate?.questions && typeof candidate.questions === "object" ? Object.keys(candidate.questions).length : null,
          knownGroupCounts: candidate?.questions && !Array.isArray(candidate.questions)
            ? Object.fromEntries(["multiple_choice", "true_false", "identification", "essay"].map((type) => [type, Array.isArray(candidate.questions[type]) ? candidate.questions[type].length : null])) : null,
          providerMessageCategory: /schema/i.test(error.error?.message || "") ? "schema_validation" : "other",
          tokenBudget: (() => {
            const message = error.error?.message || "";
            const matched = message.match(/Limit\s*:?\s*(\d+).*?Requested\s*:?\s*(\d+)/i);
            return matched ? { limit: Number(matched[1]), requested: Number(matched[2]) } : undefined;
          })(),
        });
        throw error;
      }
    };
    const { generateQuiz } = require("../services/aiService");
    const result = await generateQuiz(processed.text, { counts, difficulty: "medium" });
    console.log(JSON.stringify({ provider: result.aiStatus, questionCount: result.questions.length, applicationValidationPassed: true, tokenUsage: result.tokenUsage }, null, 2));
    return;
  }
  const payload = {
    max_completion_tokens: mixed ? 8000 : 1200,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "Generate classroom questions using only the lesson and exactly the requested counts for each type. Return JSON with questions. Each question needs type, text, answerKey when applicable, explanation, verbatim sourceEvidence, numeric points, and medium difficulty. MC needs correctAnswer and three distractors, with answerKey equal to correctAnswer. True/false needs answerKey True or False. Identification needs the expected answer text. Essay needs suggestedAnswer and rubric with keyPoints and numeric contentAccuracy, understanding, organization, grammarClarity weights. Use lesson-grounded answers and distractors." },
      { role: "user", content: JSON.stringify({ ...compactLessonForAi(analysis), requestedQuestionCounts: counts, difficulty: "medium" }) },
    ],
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await groq.createCompletion(payload, { signal: controller.signal, timeoutMs: 20000, questionCounts: counts, difficulty: "medium" });
    const parsed = JSON.parse(response.choices?.[0]?.message?.content || "null");
    const inspected = inspectQuizResponse(parsed, mixed ? 28 : 1);
    console.log(JSON.stringify({ provider: "groq", model: groq.getModel(), finishReason: response.choices?.[0]?.finish_reason, questionCount: inspected.questions.length, issues: inspected.issues, usage: response.usage }, null, 2));
    if (inspected.issues.length) process.exitCode = 1;
  } catch (error) {
    let message = String(error.error?.message || error.message || "").slice(0, 600);
    for (const value of [process.env.GROQ_API_KEY, process.env.OPENAI_API_KEY].filter(Boolean)) message = message.split(value).join("[redacted]");
    console.log(JSON.stringify({ status: error.status, code: error.code || error.error?.code, type: error.name, causeCode: error.cause?.code, message }, null, 2));
    process.exitCode = 1;
  } finally { clearTimeout(timer); }
}

main().catch((error) => {
  console.error(JSON.stringify({ event: "diagnostic_failed", status: error.status, code: error.code, errorType: error.name }));
  process.exitCode = 1;
});
