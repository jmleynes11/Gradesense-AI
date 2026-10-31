// Independent report checks shared by the live diagnostic and offline tests.
function checkEvaluation(sample, evaluation, maxScore) {
  const issues = [];
  const textArray = (value) => Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim());
  if (evaluation.aiStatus !== "graded") issues.push("evaluation_not_graded");
  if (!Number.isInteger(evaluation.score)
    || evaluation.score < sample.expectedMin || evaluation.score > sample.expectedMax) issues.push("score_outside_expected_range");
  const breakdown = evaluation.rubricBreakdown;
  const criteria = breakdown?.criteria;
  if (criteria?.some((item) => !Number.isInteger(item.score) || !Number.isInteger(item.maxScore))) issues.push("whole_number_scores_required");
  if (!criteria?.length || Math.abs(criteria.reduce((sum, item) => sum + item.score, 0) - evaluation.score) > 1e-8
    || Math.abs(criteria.reduce((sum, item) => sum + item.maxScore, 0) - maxScore) > 1e-8) issues.push("rubric_totals_disagree");
  if (!evaluation.feedback?.trim() || criteria?.some((item) => !item.feedback?.trim())) issues.push("explanation_missing");
  sample.expectedCriterionRanges?.forEach((range, index) => {
    if (range && (typeof criteria?.[index]?.score !== "number" || criteria[index].score < range.min || criteria[index].score > range.max)) issues.push(`criteria[${index}].expected_partial_credit`);
  });
  for (const field of ["strengths", "weaknesses", "missingOrIncorrectConcepts", "suggestions"]) {
    if (!textArray(evaluation[field])) issues.push(`${field}_invalid`);
  }
  if (evaluation.score > 0 && !evaluation.strengths?.length) issues.push("correct_concepts_missing");
  if (evaluation.score === 0 && evaluation.strengths?.length) issues.push("zero_with_correct_concepts");
  if (evaluation.score < maxScore && (!evaluation.missingOrIncorrectConcepts?.length || !evaluation.suggestions?.length)) issues.push("deductions_not_explained");
  if (evaluation.score === maxScore && evaluation.missingOrIncorrectConcepts?.length) issues.push("full_marks_with_missing_concepts");
  return issues;
}

function compareEquivalentAnswers(results) {
  const byName = new Map(results.map((item) => [item.name, item]));
  const correct = byName.get("correct");
  return ["paraphrased_correct", "short_correct"].map((name) => {
    const other = byName.get(name);
    return { name: `correct_vs_${name}`, tolerance: 1,
      passed: correct?.aiStatus === "graded" && other?.aiStatus === "graded" && Math.abs(correct.score - other.score) <= 1 };
  });
}

module.exports = { checkEvaluation, compareEquivalentAnswers };
