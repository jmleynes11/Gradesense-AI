const STRICT_MODELS = new Set(["openai/gpt-oss-20b", "openai/gpt-oss-120b"]);
const TYPES = ["multiple_choice", "true_false", "identification", "essay"];

function closedObject(properties) {
  return { type: "object", properties, required: Object.keys(properties), additionalProperties: false };
}

function buildQuizOutputSchema(counts, difficulty = "medium") {
  const text = { type: "string" };
  const textArray = { type: "array", items: text };
  const definitions = {};
  const groups = {};
  for (const type of TYPES) {
    if (!counts[type]) continue;
    const properties = {
      type: { type: "string", enum: [type] },
      text,
      sourceEvidence: text,
      explanation: text,
      points: { type: "number" },
      difficulty: { type: "string", enum: [difficulty] },
    };
    if (type === "multiple_choice") {
      Object.assign(properties, { answerKey: text, correctAnswer: text,
        distractors: closedObject({ distractor_1: text, distractor_2: text, distractor_3: text }),
      });
    } else if (type === "true_false") {
      properties.answerKey = { type: "string", enum: ["True", "False"] };
    } else if (type === "identification") {
      Object.assign(properties, { answerKey: text, acceptableAnswers: textArray });
    } else {
      properties.suggestedAnswer = text;
      properties.rubric = closedObject({
        keyPoints: textArray,
        contentAccuracy: { type: "number" },
        understanding: { type: "number" },
        organization: { type: "number" },
        grammarClarity: { type: "number" },
      });
    }
    definitions[type] = closedObject(properties);
    groups[type] = {
      type: "array", items: { $ref: `#/$defs/${type}` },
      minItems: counts[type], maxItems: counts[type],
    };
  }
  // Reference each question definition once per type, rather than once for every
  // question. This keeps the provider schema/prompt budget bounded for large quizzes.
  return {
    type: "json_schema",
    json_schema: {
      name: "lesson_quiz", strict: true,
      schema: { ...closedObject({ questions: closedObject(groups) }), $defs: definitions },
    },
  };
}

function adaptStrictQuizResponse(response, format, allowPartial = false) {
  const choice = response.choices?.[0];
  if (choice?.finish_reason !== "stop" || choice.message?.refusal || typeof choice.message?.content !== "string") return response;
  let parsed;
  try { parsed = JSON.parse(choice.message.content); } catch { return response; }
  const questions = parsed?.questions;
  if (!questions || typeof questions !== "object" || Array.isArray(questions)) return response;
  const groupSchema = format.json_schema.schema.properties.questions;
  const expectedGroups = groupSchema.required;
  if (Object.keys(questions).some((key) => !expectedGroups.includes(key) || !Array.isArray(questions[key]))) return response;
  if (!allowPartial && (Object.keys(questions).length !== expectedGroups.length || expectedGroups.some((key) => !Array.isArray(questions[key]) || questions[key].length !== groupSchema.properties[key].minItems))) return response;
  const adapted = { questions: expectedGroups.flatMap((key) => (questions[key] || []).map((question) =>
    question && typeof question === "object" && !Array.isArray(question) ? { ...question, type: key } : question)).map((question) => {
    const distractors = question?.distractors;
    if (question?.type !== "multiple_choice" || !distractors || typeof distractors !== "object" || Array.isArray(distractors)) return question;
    const keys = ["distractor_1", "distractor_2", "distractor_3"];
    if (Object.keys(distractors).length !== keys.length || keys.some((name) => !Object.hasOwn(distractors, name))) return question;
    return { ...question, distractors: keys.map((name) => distractors[name]) };
  }) };
  return {
    ...response,
    choices: response.choices.map((item, index) => index === 0
      ? { ...item, message: { ...item.message, content: JSON.stringify(adapted) } } : item),
  };
}

module.exports = { STRICT_MODELS, buildQuizOutputSchema, adaptStrictQuizResponse };
