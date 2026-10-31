// Normalize representations already accepted by the question model. Diagnostics
// contain fixed field paths/rules only, never generated text or lesson content.
function inspectQuizResponse(parsed, requestedTotal) {
  const issues = [];
  const issue = (path, rule) => issues.push({ path, rule });
  const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  const isText = (value) => typeof value === "string" && value.trim().length > 0;
  if (!isObject(parsed) || !Array.isArray(parsed.questions)) {
    return { questions: [], issues: [{ path: "questions", rule: "required_array" }] };
  }
  if (parsed.questions.length !== requestedTotal) issue("questions", "exact_requested_count");
  const questions = parsed.questions.map((source, index) => {
    const path = `questions[${index}]`;
    if (!isObject(source)) {
      issue(path, "required_object");
      return source;
    }
    const question = { ...source };
    question.type = question.type || question.questionType;
    const typeKey = String(question.type || "").toLowerCase().replace(/[\s_-]+/g, "");
    question.type = ({ multiplechoice: "multiple_choice", mcq: "multiple_choice", truefalse: "true_false", identification: "identification", essay: "essay" })[typeKey] || question.type;
    question.text = question.text || question.question;
    if (!["multiple_choice", "true_false", "identification", "essay"].includes(question.type)) issue(`${path}.type`, "supported_question_type");
    if (!isText(question.text)) issue(`${path}.text`, "required_text");
    if (!isText(question.sourceEvidence)) issue(`${path}.sourceEvidence`, "required_lesson_evidence");
    if (question.explanation == null) question.explanation = "";
    if (typeof question.explanation !== "string") issue(`${path}.explanation`, "text");
    if (question.answerKey == null || question.answerKey === "") question.answerKey = question.correctAnswer ?? "";
    if (question.type === "true_false") {
      if (typeof question.answerKey === "boolean") question.answerKey = question.answerKey ? "True" : "False";
      if (typeof question.answerKey !== "string" || !/^(true|false)$/i.test(question.answerKey)) issue(`${path}.answerKey`, "true_or_false");
    } else if (question.type !== "essay" && !isText(question.answerKey)) {
      issue(`${path}.answerKey`, "required_answer_text");
    }
    // Model responses often include null for fields irrelevant to this type.
    for (const field of ["choices", "distractors", "acceptableAnswers", "alternativeAnswers"]) {
      if (question[field] == null) delete question[field];
      else if (!Array.isArray(question[field]) || question[field].some((value) => !isText(value))) issue(`${path}.${field}`, "array_of_text");
    }
    if (question.correctAnswer == null) delete question.correctAnswer;
    else if (typeof question.correctAnswer !== "string" && question.type !== "true_false") issue(`${path}.correctAnswer`, "text");
    if (question.type === "essay") {
      question.suggestedAnswer = question.suggestedAnswer || question.answerKey;
      if (!isText(question.suggestedAnswer)) issue(`${path}.suggestedAnswer`, "required_answer_text");
      if (!isObject(question.rubric)) issue(`${path}.rubric`, "required_object");
      else {
        question.rubric = { ...question.rubric };
        if (!Array.isArray(question.rubric.keyPoints) || !question.rubric.keyPoints.length || question.rubric.keyPoints.some((value) => !isText(value))) issue(`${path}.rubric.keyPoints`, "nonempty_array_of_text");
        if (question.rubric.criteria == null) delete question.rubric.criteria;
        else if (!Array.isArray(question.rubric.criteria) || question.rubric.criteria.some((value) => !isObject(value))) issue(`${path}.rubric.criteria`, "array_of_objects");
        for (const field of ["contentAccuracy", "understanding", "organization", "grammarClarity"]) {
          if (question.rubric[field] == null) delete question.rubric[field];
          else {
            const value = question.rubric[field];
            if (!["number", "string"].includes(typeof value) || String(value).trim() === "" || !Number.isFinite(Number(value)) || Number(value) < 0) issue(`${path}.rubric.${field}`, "nonnegative_number");
            else question.rubric[field] = Number(value);
          }
        }
      }
    }
    if (question.points == null) delete question.points;
    else if (!["number", "string"].includes(typeof question.points) || String(question.points).trim() === "" || !Number.isFinite(Number(question.points)) || Number(question.points) <= 0) issue(`${path}.points`, "positive_number");
    else question.points = Number(question.points);
    if (question.difficulty == null) delete question.difficulty;
    else if (!["easy", "medium", "hard"].includes(question.difficulty)) issue(`${path}.difficulty`, "supported_difficulty");
    return question;
  });
  return { questions, issues };
}

function invalidQuiz(stage, details = {}) {
  const error = Object.assign(new Error("INVALID_AI_RESPONSE"), { code: "INVALID_AI_RESPONSE", status: 502 });
  error.validation = { stage, ...details };
  return error;
}

module.exports = { inspectQuizResponse, invalidQuiz };
