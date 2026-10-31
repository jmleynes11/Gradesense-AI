import { ArrowLeft, ArrowRight, Clock, FileText, Info } from "lucide-react";

function formatDate(value) {
  return value ? new Date(value).toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" }) : "No deadline";
}

export default function AssessmentInstructions({ assessment, starting, message, onBack, onStart }) {
  const duration = Number(assessment.durationMinutes ?? 30);
  const type = (assessment.assessmentType || "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  const rules = ["Read each question carefully before answering."];
  if (duration > 0) rules.push("Complete the assessment within the allotted time.");
  if (assessment.endDate || assessment.dueDate) rules.push("Submit your answers before the submission deadline.");
  if (assessment.attemptLimit === 1) rules.push("Once submitted, this assessment cannot be retaken because only one attempt is allowed.");
  rules.push("Do not refresh or close the assessment page while answering unless necessary.", "Ensure that your answers are complete before submitting.");
  if (assessment.lockPreviousQuestions) rules.push("After moving to the next question, you cannot change previous answers.");
  const deadlineExtended = assessment.endDate && assessment.dueDate && new Date(assessment.endDate) > new Date(assessment.dueDate);
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <header><p className="text-sm font-bold text-[#D94F00]">Before you begin</p><h1 className="mt-2 text-3xl font-black text-slate-950">Assessment Instructions</h1><p className="mt-2 text-sm text-slate-600">Review the assessment details and rules before starting.</p></header>
      <section className="premium-card p-5 sm:p-8" aria-labelledby="assessment-title">
        <p className="text-sm font-bold uppercase tracking-wider text-[#D94F00]">{type}</p>
        <h2 className="mt-2 break-words text-2xl font-black text-slate-950 sm:text-3xl" id="assessment-title">{assessment.title}</h2>
        <dl className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-[#FFE4CC] bg-[#FFF3E8] p-4"><dt className="flex items-center gap-2 text-sm font-semibold text-[#D94F00]"><FileText size={18} aria-hidden="true" />Total Questions / Items</dt><dd className="mt-2 text-2xl font-black text-slate-950">{assessment.numberOfQuestions} {assessment.numberOfQuestions === 1 ? "item" : "items"}</dd></div>
          <div className="rounded-xl border border-[#FFE4CC] bg-[#FFF3E8] p-4"><dt className="flex items-center gap-2 text-sm font-semibold text-[#D94F00]"><Clock size={18} aria-hidden="true" />Time Duration</dt><dd className="mt-2 text-2xl font-black text-slate-950">{duration} {duration === 1 ? "minute" : "minutes"}</dd></div>
          <div><dt className="text-sm text-slate-500">Total Points</dt><dd className="mt-1 font-bold text-slate-900">{assessment.totalPoints ?? "Not available"}</dd></div>
          <div><dt className="text-sm text-slate-500">Due Date</dt><dd className="mt-1 font-bold text-slate-900">{formatDate(assessment.dueDate)}</dd></div>
          <div><dt className="text-sm text-slate-500">Allowed Attempts</dt><dd className="mt-1 font-bold text-slate-900">{assessment.attemptLimit > 0 ? `${assessment.attemptLimit} ${assessment.attemptLimit === 1 ? "attempt" : "attempts"}` : "Unlimited"}</dd></div>
          <div><dt className="text-sm text-slate-500">Assessment Type</dt><dd className="mt-1 font-bold text-slate-900">{type}</dd></div>
          <div><dt className="text-sm text-slate-500">Grading Method</dt><dd className="mt-1 font-bold text-slate-900">AI-powered grading with GradeSense AI</dd></div>
          {assessment.startDate && <div><dt className="text-sm text-slate-500">Available From</dt><dd className="mt-1 font-bold text-slate-900">{formatDate(assessment.startDate)}</dd></div>}
          {assessment.endDate && <div><dt className="text-sm text-slate-500">Submissions Close</dt><dd className="mt-1 font-bold text-slate-900">{formatDate(assessment.endDate)}</dd></div>}
        </dl>
        {deadlineExtended && <p className="mt-4 text-sm text-slate-600">Your teacher allows submissions after the due date until {formatDate(assessment.endDate)}.</p>}
      </section>
      <section className="rounded-xl border border-[#FFD0A8] bg-[#FFF3E8] p-5 sm:p-6" aria-labelledby="ai-grading-notice">
        <div className="flex items-start gap-3"><Info className="mt-0.5 shrink-0 text-[#D94F00]" size={22} aria-hidden="true" /><div>
          <h2 className="font-bold text-slate-950" id="ai-grading-notice">AI-Powered Grading Notice</h2>
          <p className="mt-2 text-sm leading-6 text-slate-700">This assessment will be evaluated using GradeSense AI. Your submitted answers will be analyzed to generate your score and, where applicable, personalized feedback based on your responses and the assessment's grading criteria.</p>
          <p className="mt-2 text-sm leading-6 text-slate-700">Essay and open-ended answers may be evaluated differently from multiple-choice questions. Your grade and feedback will appear when processing is complete, if enabled for this assessment.</p>
        </div></div>
      </section>
      <section className="premium-card p-5 sm:p-6" aria-labelledby="assessment-rules">
        <h2 className="text-lg font-bold text-slate-950" id="assessment-rules">Rules and Reminders</h2>
        {assessment.instructions && <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">{assessment.instructions}</p>}
        <ul className="mt-4 list-disc space-y-3 pl-5 text-sm leading-6 text-slate-700">{rules.map((rule) => <li key={rule}>{rule}</li>)}</ul>
        <p className="mt-5 text-sm font-semibold text-[#D94F00]">The timer starts only when you click Start Assessment. If you already started, returning resumes the same attempt and its original timer.</p>
      </section>
      {(assessment.canStart === false || assessment.canSubmit === false) && <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" role="status">{assessment.startBlockedReason || "This assessment is currently unavailable."}</p>}
      {message && <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700" role="alert">{message}</p>}
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
        <button className="btn-neutral flex items-center justify-center gap-2 px-5 py-3 disabled:opacity-50" disabled={starting} onClick={onBack} type="button"><ArrowLeft size={18} />Back to Assessments</button>
        <button className="btn-primary flex items-center justify-center gap-2 px-5 py-3 disabled:cursor-not-allowed disabled:opacity-50" disabled={starting || assessment.canStart === false || assessment.canSubmit === false} onClick={onStart} type="button">{starting ? "Starting Assessment…" : "Start Assessment"}<ArrowRight size={18} /></button>
      </div>
    </div>
  );
}
