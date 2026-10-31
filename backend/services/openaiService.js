const OpenAI = require("openai");
const queue = require("./openaiQueue");
const { throwIfCancelled } = require("./aiRequestPolicy");

let client;
let lastRequest = null;
let lastError = null;

function getModel() {
  return process.env.OPENAI_MODEL || "gpt-4o-mini";
}

function getClient() {
  if (!process.env.OPENAI_API_KEY) {
    const error = new Error("OpenAI API key is not configured.");
    error.status = 503;
    error.code = "OPENAI_API_KEY_MISSING";
    throw error;
  }
  if (!client) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, baseURL: "https://api.openai.com/v1", timeout: 30000, maxRetries: 0, logLevel: "off" });
  }
  return client;
}

function classifyOpenAiError(error) {
  const providerCode = error.code || error.error?.code || error.cause?.code || "";
  const message = String(error.message || "").toLowerCase();
  const quota = providerCode === "insufficient_quota" || /insufficient.quota|exceeded your current quota|billing|credit balance/.test(message);
  const tokenRate = /tokens per min|token rate limit|tpm/.test(message);
  const requestRate = error.status === 429 || providerCode === "rate_limit_exceeded";
  const timeout = error.name === "APIConnectionTimeoutError" || /timeout|timed out|etimedout|abort/.test(message);
  return { providerCode, quota, tokenRate, requestRate, timeout, temporary: !quota && (requestRate || [500, 502, 503, 504].includes(error.status)) };
}

function safeLog(event, details = {}) {
  console.info("[OpenAI quiz generation]", { event, ...details });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createCompletion(payload, context = {}) {
  // Quiz fallback is bounded by its coordinator; retain legacy essay-grading retries.
  if (context.singleAttempt) {
    const openaiClient = getClient();
    return queue.add(() => {
      throwIfCancelled(context.signal);
      return openaiClient.chat.completions.create({ ...payload, model: getModel() }, {
        signal: context.signal, timeout: context.timeoutMs, maxRetries: 0,
      });
    }, { signal: context.signal });
  }
  const maxAttempts = 2;
  const startedAt = Date.now();
  const model = payload.model || getModel();
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      safeLog("request_started", { requestId: context.requestId, attempt, model, lessonTokens: context.lessonTokens, requestedQuestions: context.requestedQuestions });
      lastRequest = { timestamp: new Date().toISOString(), model, attempt, lessonTokens: context.lessonTokens, requestedQuestions: context.requestedQuestions };
      const response = await queue.add(() => getClient().chat.completions.create({ ...payload, model }));
      lastError = null;
      safeLog("response_received", { requestId: context.requestId, attempt, model, elapsedMs: Date.now() - startedAt, promptTokens: response.usage?.prompt_tokens, completionTokens: response.usage?.completion_tokens });
      return response;
    } catch (error) {
      const classification = classifyOpenAiError(error);
      lastError = {
        timestamp: new Date().toISOString(),
        status: error.status || null,
        type: error.name || null,
        code: classification.providerCode || error.code || null,
        causeCode: error.cause?.code || null,
        classification: classification.quota ? "quota" : classification.tokenRate ? "token_rate_limit" : classification.requestRate ? "request_rate_limit" : classification.timeout ? "timeout" : "other",
      };
      safeLog("request_failed", { requestId: context.requestId, attempt, model, elapsedMs: Date.now() - startedAt, status: error.status, providerCode: classification.providerCode || undefined, errorType: error.name, quota: classification.quota, tokenRate: classification.tokenRate, timeout: classification.timeout });
      if (classification.quota) {
        error.status = 402;
        error.code = "OPENAI_QUOTA_EXHAUSTED";
        throw error;
      }
      if (classification.timeout) {
        error.status = 504;
        error.code = "OPENAI_TIMEOUT";
        throw error;
      }
      if (!classification.temporary || attempt === maxAttempts) {
        error.code = classification.tokenRate ? "OPENAI_TOKEN_RATE_LIMIT" : classification.requestRate ? "OPENAI_REQUEST_RATE_LIMIT" : (classification.providerCode === "model_not_found" ? "OPENAI_MODEL_UNAVAILABLE" : error.code);
        throw error;
      }
      const retryAfter = Number(error.headers?.["retry-after"] || error.response?.headers?.["retry-after"] || 0);
      await sleep(retryAfter > 0 ? retryAfter * 1000 : 1000 * attempt);
    }
  }
}

async function verifyConfiguration() {
  const model = getModel();
  if (!process.env.OPENAI_API_KEY) {
    return { apiKeyConfigured: false, model, connectionStatus: "not_configured", lastError, lastRequestTimestamp: lastRequest?.timestamp || null };
  }
  try {
    await getClient().models.retrieve(model);
    return { apiKeyConfigured: true, model, connectionStatus: "connected", lastError, lastRequestTimestamp: lastRequest?.timestamp || null };
  } catch (error) {
    const classification = classifyOpenAiError(error);
    lastError = {
      timestamp: new Date().toISOString(), status: error.status || null, type: error.name || null,
      code: classification.providerCode || error.code || null,
      causeCode: error.cause?.code || null,
      classification: classification.quota ? "quota" : classification.tokenRate ? "token_rate_limit" : classification.requestRate ? "request_rate_limit" : classification.timeout ? "timeout" : "other",
    };
    return { apiKeyConfigured: true, model, connectionStatus: "failed", lastError, lastRequestTimestamp: lastRequest?.timestamp || null };
  }
}

module.exports = { classifyOpenAiError, createCompletion, getModel, verifyConfiguration };
