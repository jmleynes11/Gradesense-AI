const crypto = require("crypto");

function cleanText(text = "") {
  return text
    .replace(/\s+/g, " ")
    .replace(/[^\S\r\n]+/g, " ")
    .trim();
}

function estimateTokens(text = "") {
  return Math.ceil(text.length / 4);
}

function hashContent(content = "") {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function compressContent(text = "") {
  const sentences = cleanText(text)
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean);

  return sentences.slice(0, 50).join(" ");
}

module.exports = {
  cleanText,
  estimateTokens,
  hashContent,
  compressContent,
};
