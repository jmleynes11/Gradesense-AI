const OpenAI = require("openai");
const PQueue = require("p-queue").default;
const { aiError, throwIfCancelled } = require("./aiRequestPolicy");
const { STRICT_MODELS, buildQuizOutputSchema, adaptStrictQuizResponse } = require("./quizOutputSchema");

const queue = new PQueue({ concurrency: 1 });
let client;

function getModel() {
  return process.env.GROQ_MODEL || "openai/gpt-oss-20b";
}

function getClient() {
  if (!process.env.GROQ_API_KEY) throw aiError("GROQ_API_KEY_MISSING");
  if (!client) {
    client = new OpenAI({
      apiKey: process.env.GROQ_API_KEY,
      baseURL: "https://api.groq.com/openai/v1",
      organization: null,
      project: null,
      adminAPIKey: null,
      webhookSecret: null,
      logLevel: "off",
      maxRetries: 0,
    });
  }
  return client;
}

async function createCompletion(payload, context) {
  const groqClient = getClient();
  const model = context.model || getModel();
  const structured = STRICT_MODELS.has(model) && context.questionCounts && context.groqOutputMode !== "json_object";
  const format = context.responseFormat || (structured
    ? buildQuizOutputSchema(context.questionCounts, context.difficulty)
    : { type: "json_object" });
  // Strict generation handles shape/counts; semantic quiz validation stays shared.
  // GPT-OSS supports reasoning_effort, but not reasoning_format.
  const request = {
    ...payload,
    model,
    response_format: format,
    messages: structured ? [...payload.messages, {
      role: "user",
      content: "Follow the supplied JSON schema exactly. Return questions as an object grouped into the requested question types, with exactly the requested number in each type's array. Use exactly three distractors for each multiple-choice question and a nonempty rubric.keyPoints array for each essay. Every question, including each essay, requires sourceEvidence quoted from lessonText. Do not add fields outside the schema.",
    }] : payload.messages,
    ...(["openai/gpt-oss-20b", "openai/gpt-oss-120b"].includes(model)
      ? { reasoning_effort: context.reasoningEffort || "low" } : {}),
  };
  let response;
  try {
    response = await queue.add(() => {
      throwIfCancelled(context.signal);
      return groqClient.chat.completions.create(request, {
        signal: context.signal,
        timeout: context.timeoutMs,
        maxRetries: 0,
      });
    }, { signal: context.signal });
  } catch (error) {
    const code = error.code || error.error?.code;
    if (error.status !== 400 || code !== "json_validate_failed"
      || /content[ _-]policy|content[ _-]filter|moderation|refusal|safety/i.test(error.error?.message || error.message || "")
      || typeof error.error?.failed_generation !== "string") throw error;
    let parsed;
    try { parsed = JSON.parse(error.error.failed_generation); } catch { throw error; }
    if (!parsed || typeof parsed !== "object" || !parsed.questions) throw error;
    if (parsed.refusal || parsed.message?.refusal) throw aiError("AI_CONTENT_POLICY", 422);
    // A provider schema failure can contain a complete JSON partial quiz. Keep
    // it only as a candidate; the application still validates every question.
    console.info("[Quiz AI provider]", { event: "provider_json_candidate", requestId: context.requestId,
      provider: "groq", status: error.status, code, providerRequestId: error.request_id });
    response = { usageUnavailable: true, choices: [{ finish_reason: "stop", message: { content: JSON.stringify(parsed) } }] };
    return structured ? adaptStrictQuizResponse(response, format, true) : response;
  }
  return structured ? adaptStrictQuizResponse(response, format) : response;
}

module.exports = { createCompletion, getModel };
