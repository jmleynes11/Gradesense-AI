const crypto = require("node:crypto");

// Per-process HMAC avoids publishing guessable hashes of short student answers.
const fingerprintKey = crypto.randomBytes(32);
function describe(value) {
  const text = String(value || "");
  return { characters: text.length, fingerprint: crypto.createHmac("sha256", fingerprintKey).update(text).digest("hex"), content: "[redacted]" };
}

function protect(details, associatedData) {
  const configured = process.env.AI_ESSAY_LOG_ENCRYPTION_KEY;
  if (!configured) return { contentLogging: "redacted" };
  const key = Buffer.from(configured, "base64");
  if (key.length !== 32 || key.toString("base64") !== configured) return { contentLogging: "redacted", logConfigurationError: "INVALID_LOG_ENCRYPTION_KEY" };
  // Even protected diagnostic content must not retain configured credentials.
  let plaintext = JSON.stringify(details);
  for (const [name, value] of Object.entries(process.env)) {
    if (/KEY|SECRET|TOKEN|PASSWORD|URI/i.test(name) && value.length >= 6) plaintext = plaintext.split(value).join("[secret redacted]");
  }
  plaintext = plaintext.replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|gsk_[A-Za-z0-9_-]{12,})\b/g, "[secret redacted]");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(associatedData));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { contentLogging: "encrypted", protectedContent: { algorithm: "aes-256-gcm", iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64"), associatedData } };
}

function createEssayLogger(context, startedAt) {
  const identifier = (value) => value != null && /^[a-zA-Z0-9_-]{1,128}$/.test(String(value)) ? String(value) : null;
  return (event, metadata = {}, protectedDetails) => {
    const record = { event, requestId: context.requestId, assessmentId: identifier(context.assessmentId),
      questionId: identifier(context.questionId), elapsedMs: Date.now() - startedAt, ...metadata,
      ...(protectedDetails ? protect(protectedDetails, `${context.requestId}:${event}`) : {}) };
    console.info("[Essay AI grading]", JSON.stringify(record));
  };
}

module.exports = { createEssayLogger, describe };
