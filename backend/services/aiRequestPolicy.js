function aiError(code, status = 503) {
  return Object.assign(new Error(code), { code, status });
}

function positiveInteger(name, fallback, allowZero = false) {
  const value = process.env[name] === undefined ? fallback : Number(process.env[name]);
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) {
    throw aiError("AI_CONFIGURATION_INVALID");
  }
  return value;
}

function getQuizConfig() {
  return {
    totalTimeoutMs: positiveInteger("AI_QUIZ_TOTAL_TIMEOUT_MS", 65000),
    requestTimeoutMs: positiveInteger("AI_QUIZ_REQUEST_TIMEOUT_MS", 20000),
    retryDelayMs: positiveInteger("AI_QUIZ_RETRY_DELAY_MS", 500, true),
    maxRetryDelayMs: positiveInteger("AI_QUIZ_MAX_RETRY_DELAY_MS", 1500, true),
    maxOutputTokens: positiveInteger("AI_QUIZ_MAX_OUTPUT_TOKENS", 8000),
    recoveryExtraMc: positiveInteger("AI_QUIZ_RECOVERY_EXTRA_MC", 2, true),
  };
}

function throwIfCancelled(signal) {
  if (signal?.aborted) throw signal.reason || aiError("AI_REQUEST_CANCELLED", 499);
}

// The signal bounds queue wait as well as network I/O. Late responses are ignored.
function withSignal(operation, signal) {
  throwIfCancelled(signal);
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason || aiError("AI_REQUEST_CANCELLED", 499));
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(() => {
      throwIfCancelled(signal);
      return operation();
    }).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

function requestCancellation(req, res) {
  const controller = new AbortController();
  const abort = () => {
    if (!res.writableEnded) controller.abort(aiError("AI_REQUEST_CANCELLED", 499));
  };
  req.on("aborted", abort);
  res.on("close", abort);
  if (req.aborted || res.destroyed) abort();
  return {
    signal: controller.signal,
    dispose() {
      req.off("aborted", abort);
      res.off("close", abort);
    },
  };
}

module.exports = { aiError, getQuizConfig, throwIfCancelled, withSignal, requestCancellation };
