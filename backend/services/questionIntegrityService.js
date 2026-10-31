const STOP_WORDS = new Set([
  "about",
  "according",
  "answer",
  "because",
  "concept",
  "correct",
  "describe",
  "detail",
  "does",
  "from",
  "lesson",
  "question",
  "statement",
  "that",
  "their",
  "these",
  "this",
  "what",
  "which",
  "with",
]);

function cleanValue(value = "") {
  // Manual authoring must retain normal interior spaces and line breaks. Only
  // remove accidental whitespace surrounding the entered value.
  return String(value ?? "").trim();
}

function cleanQuestionText(value = "") {
  return cleanValue(value);
}

function cleanExplanationText(value = "") {
  return cleanValue(value);
}

function normalizeKey(value = "") {
  return cleanValue(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function wordTokens(value = "") {
  return normalizeKey(value)
    .split(" ")
    .filter((token) => token.length > 3 && !STOP_WORDS.has(token));
}

function uniqueStrings(values = []) {
  const seen = new Set();
  const result = [];
  values.forEach((value) => {
    const cleaned = cleanValue(value);
    const key = normalizeKey(cleaned);
    if (!cleaned || !key || seen.has(key)) return;
    seen.add(key);
    result.push(cleaned);
  });
  return result;
}

function fisherYatesShuffle(values = [], seed = "") {
  const result = [...values];
  let state = Array.from(String(seed || Date.now())).reduce((sum, char) => sum + char.charCodeAt(0), 0) || 1;
  for (let index = result.length - 1; index > 0; index -= 1) {
    state = (state * 1664525 + 1013904223) % 4294967296;
    const target = Math.floor((state / 4294967296) * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function inferDistractors(question = {}) {
  const explicit = Array.isArray(question.distractors) ? question.distractors : [];
  const answer = cleanValue(question.correctAnswer || question.answerKey);
  const choices = Array.isArray(question.choices) ? question.choices : [];
  return explicit.length ? explicit : choices.filter((choice) => normalizeKey(choice) !== normalizeKey(answer));
}

function choiceSetSignature(question = {}) {
  return uniqueStrings(question.choices || [])
    .map(normalizeKey)
    .sort()
    .join("|");
}

function optionTouchesQuestionDomain(option, question) {
  const optionTokens = new Set(wordTokens(option));
  if (!optionTokens.size) return false;
  const contextTokens = wordTokens([
    question.text,
    question.question,
    question.answerKey,
    question.correctAnswer,
    question.sourceEvidence,
    question.topic,
    question.explanation,
  ].filter(Boolean).join(" "));
  if (!contextTokens.length) return true;
  return contextTokens.some((token) => optionTokens.has(token));
}

function normalizeMultipleChoiceQuestion(question = {}, index = 0, unsupportedRequests = []) {
  const answer = cleanValue(question.correctAnswer || question.answerKey);
  const distractors = uniqueStrings(inferDistractors(question)).filter(
    (choice) => normalizeKey(choice) !== normalizeKey(answer),
  );
  const rawChoices = uniqueStrings([answer, ...distractors]);

  if (!answer) {
    unsupportedRequests.push(`Multiple choice question has no answer value: ${question.text || question.question || "Untitled question"}`);
    return null;
  }

  if (rawChoices.length !== 4) {
    unsupportedRequests.push(`Multiple choice question removed because it does not have one answer and three unique distractors: ${question.text || question.question || "Untitled question"}`);
    return null;
  }

  const semanticFailures = rawChoices.filter((choice) => !optionTouchesQuestionDomain(choice, question));
  if (semanticFailures.length === rawChoices.length) {
    unsupportedRequests.push(`Multiple choice question removed because none of its choices connect to the question domain: ${question.text || question.question || "Untitled question"}`);
    return null;
  }

  const choices = fisherYatesShuffle(rawChoices, `${question.text || question.question}:${answer}:${index}`);
  return {
    ...question,
    type: "multiple_choice",
    text: cleanQuestionText(question.text || question.question),
    explanation: cleanExplanationText(question.explanation),
    choices,
    answerKey: answer,
    correctAnswer: undefined,
    distractors: undefined,
  };
}

function normalizeQuestion(question = {}, index = 0, unsupportedRequests = []) {
  const type = question.type || question.questionType;
  if (type === "multiple_choice") return normalizeMultipleChoiceQuestion(question, index, unsupportedRequests);
  if (type === "true_false") {
    const answer = cleanValue(question.answerKey || question.correctAnswer || "True");
    const text = cleanQuestionText(question.text || question.question);
    if (!text || !/^(true|false)$/i.test(answer)) {
      unsupportedRequests.push(`True/false question is invalid: ${text || "Untitled question"}`);
      return null;
    }
    return {
      ...question,
      type,
      text,
      explanation: cleanExplanationText(question.explanation),
      choices: ["True", "False"],
      answerKey: /^false$/i.test(answer) ? "False" : "True",
    };
  }
  const text = cleanQuestionText(question.text || question.question);
  const answerKey = cleanValue(question.answerKey || question.correctAnswer);
  if (!QUESTION_TYPES_FOR_VALIDATION.has(type) || !text || (type === "identification" && !answerKey)) {
    unsupportedRequests.push(`Question is invalid or has an unsupported type: ${text || "Untitled question"}`);
    return null;
  }
  return {
    ...question,
    type,
    text,
    explanation: cleanExplanationText(question.explanation),
    choices: type === "essay" || type === "identification" || type === "coding" ? [] : question.choices,
    answerKey,
    acceptableAnswers: type === "identification" ? uniqueStrings(question.acceptableAnswers || question.alternativeAnswers || []) : undefined,
  };
}

const QUESTION_TYPES_FOR_VALIDATION = new Set(["multiple_choice", "true_false", "identification", "essay", "coding"]);

function normalizeEssayRubric(rubric, suggestedAnswer = "") {
  const source = rubric && typeof rubric === "object" ? rubric : {};
  const keyPoints = Array.isArray(source.keyPoints)
    ? source.keyPoints.map(cleanValue).filter(Boolean)
    : String(source.keyPoints || "").split(/\r?\n/).map(cleanValue).filter(Boolean);
  const criteria = Array.isArray(source.criteria)
    ? source.criteria.map((item) => ({ criterion: cleanValue(item.criterion || item.name), maxScore: Number(item.maxScore || item.points) || 0 })).filter((item) => item.criterion)
    : [];
  const fallback = keyPoints.length ? keyPoints : (cleanValue(suggestedAnswer) ? [cleanValue(suggestedAnswer)] : ["Accuracy and relevance", "Explanation and understanding", "Clarity and organization"]);
  return {
    ...source,
    keyPoints: fallback,
    criteria,
    contentAccuracy: Number(source.contentAccuracy ?? 40),
    understanding: Number(source.understanding ?? 30),
    organization: Number(source.organization ?? 20),
    grammarClarity: Number(source.grammarClarity ?? 10),
  };
}

function validateMultipleChoicePayload(body = {}) {
  const choices = uniqueStrings(body.choices || []);
  if (choices.length !== 4) {
    const error = new Error("Multiple choice questions need exactly four unique choices.");
    error.status = 400;
    throw error;
  }
  const answerKey = cleanValue(body.answerKey);
  if (!answerKey) {
    const error = new Error("Multiple choice answer key must be the actual answer value.");
    error.status = 400;
    throw error;
  }
  if (!choices.some((choice) => normalizeKey(choice) === normalizeKey(answerKey))) {
    const error = new Error("Answer key must match one of the answer choices.");
    error.status = 400;
    throw error;
  }
  return {
    ...body,
    choices,
    answerKey: choices.find((choice) => normalizeKey(choice) === normalizeKey(answerKey)) || answerKey,
  };
}

function validateQuestionPayload(body = {}) {
  const cleaned = {
    ...body,
    text: cleanQuestionText(body.text),
    explanation: cleanExplanationText(body.explanation),
  };
  if (!QUESTION_TYPES_FOR_VALIDATION.has(cleaned.type)) {
    const error = new Error("Select a valid question type.");
    error.status = 400;
    throw error;
  }
  if (!cleaned.text) {
    const error = new Error("Question text is required.");
    error.status = 400;
    throw error;
  }
  if (cleaned.type === "multiple_choice") return validateMultipleChoicePayload(cleaned);
  if (cleaned.type === "true_false") {
    cleaned.choices = ["True", "False"];
    cleaned.answerKey = /^false$/i.test(cleaned.answerKey) ? "False" : "True";
  }
  if (cleaned.type === "identification") {
    if (!cleaned.answerKey) {
      const error = new Error("Identification questions need one expected answer.");
      error.status = 400;
      throw error;
    }
    cleaned.acceptableAnswers = uniqueStrings(cleaned.acceptableAnswers || cleaned.alternativeAnswers || [])
      .filter((answer) => normalizeKey(answer) !== normalizeKey(cleaned.answerKey));
  }
  if (cleaned.type === "essay") {
    cleaned.rubric = normalizeEssayRubric(cleaned.rubric, cleaned.suggestedAnswer || cleaned.answerKey);
  }
  return cleaned;
}

module.exports = {
  choiceSetSignature,
  cleanValue,
  cleanQuestionText,
  cleanExplanationText,
  fisherYatesShuffle,
  normalizeKey,
  normalizeQuestion,
  normalizeEssayRubric,
  uniqueStrings,
  validateQuestionPayload,
};
