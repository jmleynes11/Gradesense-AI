import { useEffect, useMemo, useRef, useState } from "react";
import Panel from "../../components/Panel";
import { useAsyncData } from "../../hooks/useAsyncData";
import LoadingState from "../../components/LoadingState";
import { api } from "../../services/api";
import { displayScore, displayPercentage } from "../../services/gradeDisplay";
import AssessmentResults from "./AssessmentResults";
import AssessmentInstructions from "./AssessmentInstructions";
import PageHeader from "../../components/PageHeader";
import StatusBadge from "../../components/StatusBadge";
import { studentAssessmentSubmission } from "../../services/studentAssessmentSubmission";
import { ArrowLeft, ArrowRight, CheckCircle2, Clock, FileText } from "lucide-react";

function formatType(type = "") {
  return type.replace("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function answerHasValue(value) {
  if (typeof value === "object" && value !== null) return String(value.code || value.answer || "").trim();
  return String(value || "").trim();
}

function answerInput(question, value, onChange) {
  if (question.type === "multiple_choice") {
    return (
      <div className="mt-5 grid gap-3">
        {(question.choices || []).map((choice, index) => (
          <label className={`flex min-h-16 cursor-pointer items-center gap-4 rounded-lg border px-4 py-3 transition ${value === choice ? "border-[#FF6B00] bg-[#FFF3E8] shadow-sm" : "border-slate-200 bg-white hover:border-[#FFE4CC] hover:bg-[#FFF3E8]/50"}`} key={choice}>
            <input className="sr-only" checked={value === choice} name={question._id} onChange={() => onChange(choice)} type="radio" />
            <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg border text-sm font-black ${value === choice ? "border-[#FF6B00] bg-[#FF6B00] text-white" : "border-slate-200 bg-slate-50 text-slate-600"}`}>{String.fromCharCode(65 + index)}</span>
            <span className="text-base font-semibold text-slate-800">{choice}</span>
          </label>
        ))}
      </div>
    );
  }

  if (question.type === "true_false") {
    return (
      <div className="mt-5 grid gap-3">
        {[
          ["A", "true", "TRUE"],
          ["B", "false", "FALSE"]
        ].map(([label, choiceValue, text]) => (
          <button
            className={`flex min-h-16 cursor-pointer items-center gap-4 rounded-lg border px-4 py-3 text-left transition ${value === choiceValue ? "border-[#FF6B00] bg-[#FFF3E8] shadow-sm" : "border-slate-200 bg-white hover:border-[#FFE4CC] hover:bg-[#FFF3E8]/50"}`}
            key={choiceValue}
            onClick={() => onChange(choiceValue)}
            type="button"
          >
            <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg border text-sm font-black ${value === choiceValue ? "border-[#FF6B00] bg-[#FF6B00] text-white" : "border-slate-200 bg-slate-50 text-slate-600"}`}>{label}</span>
            <span className="text-base font-semibold text-slate-800">{text}</span>
          </button>
        ))}
      </div>
    );
  }

  if (question.type === "coding") {
    const codeValue = typeof value === "object" && value !== null ? value : { language: question.programming?.language || "JavaScript", code: question.programming?.starterCode || "" };
    return (
      <div className="mt-2 space-y-2">
        <select className="field" value={codeValue.language || "JavaScript"} onChange={(event) => onChange({ ...codeValue, language: event.target.value })}>
          {(question.programming?.allowedLanguages || ["Java", "Python", "JavaScript", "C++", "C#"]).map((language) => <option key={language} value={language}>{language}</option>)}
        </select>
        <textarea
          className="min-h-64 w-full rounded-lg border bg-slate-950 px-3 py-2 font-mono text-sm text-slate-50"
          spellCheck="false"
          value={codeValue.code || ""}
          onChange={(event) => onChange({ ...codeValue, code: event.target.value })}
        />
        <div className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm md:grid-cols-3">
          <p><span className="text-slate-500">Sample Input:</span> {question.programming?.sampleInput || "None"}</p>
          <p><span className="text-slate-500">Sample Output:</span> {question.programming?.sampleOutput || "None"}</p>
          <p><span className="text-slate-500">Time Limit:</span> {question.programming?.timeLimitSeconds || 2}s</p>
        </div>
      </div>
    );
  }

  return (
    <textarea
      className="field mt-2"
      rows={question.type === "essay" ? 6 : 3}
      value={value || ""}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export default function StudentAssessments({ assessmentIds = null, initialAssessmentId = "", onBack, onSubmitted, embedded = false }) {
  const { data, setData, loading, error } = useAsyncData(api.studentAssessments, []);
  const [assessmentDetail, setAssessmentDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const initialSelectionHandled = useRef(false);
  const [answers, setAnswers] = useState({});
  const [message, setMessage] = useState("");
  const [result, setResult] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const submissionInFlight = useRef(false);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [lockedByAssessment, setLockedByAssessment] = useState({});
  const [session, setSession] = useState(null);
  const [starting, setStarting] = useState(false);
  const startInFlight = useRef(false);
  const timerAnchor = useRef(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);

  const visibleAssessments = useMemo(() => assessmentIds ? (data || []).filter((item) => assessmentIds.includes(item._id)) : (data || []), [data, assessmentIds]);
  const selected = assessmentDetail?._id === selectedId ? assessmentDetail : null;
  const selectedAnswers = answers[selectedId] || {};
  const answeredCount = Object.values(selectedAnswers).filter(answerHasValue).length;
  const questionCount = selected?.questions?.length || 0;
  const progress = questionCount ? Math.round((answeredCount / questionCount) * 100) : 0;
  const currentQuestion = selected?.questions?.[questionIndex];
  const lockedIndex = lockedByAssessment[selectedId] ?? -1;
  const timeExpired = selected && remainingSeconds <= 0;
  const isClosed = selected?.canSubmit === false;

  // Re-read server-calculated states while this page stays open, and when
  // returning from another tab. The student's clock never decides status.
  useEffect(() => {
    if (submitting) return undefined;
    let active = true;
    async function refreshStatuses() {
      try {
        const items = await api.studentAssessments();
        if (!active) return;
        setData(items);
        setAssessmentDetail((current) => {
          if (!current) return current;
          const latest = items.find((item) => item._id === current._id);
          return latest ? { ...current, ...latest, questions: current.questions } : { ...current, canStart: false, startBlockedReason: "This assessment is no longer available.", canSubmit: false, studentStatus: "Closed" };
        });
      } catch {
        // Keep the last successful state; submission access is checked again
        // by the server. Retry on the next interval or focus event.
      }
    }
    const timer = window.setInterval(refreshStatuses, 30000);
    window.addEventListener("focus", refreshStatuses);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshStatuses);
    };
  }, [setData, submitting]);

  useEffect(() => {
    if (!selectedId) { setAssessmentDetail(null); setDetailLoading(false); return undefined; }
    let active = true;
    setDetailLoading(true);
    setSession(null);
    setMessage("");
    api.assessmentInstructions(selectedId).then((item) => { if (active) setAssessmentDetail(item); })
      .catch((err) => { if (active) { setMessage(err.message); setSelectedId(""); } })
      .finally(() => { if (active) setDetailLoading(false); });
    return () => { active = false; };
  }, [selectedId]);

  useEffect(() => {
    if (!initialAssessmentId || initialSelectionHandled.current || !visibleAssessments.some((item) => item._id === initialAssessmentId)) return;
    initialSelectionHandled.current = true;
    setSelectedId(initialAssessmentId);
  }, [initialAssessmentId, visibleAssessments]);

  useEffect(() => {
    if (!selected) return;
    setQuestionIndex(0);
    setResult(studentAssessmentSubmission(selected).resultsAvailable ? selected.previousSubmission : null);
    setMessage("");
  }, [selected?._id]);

  useEffect(() => {
    if (!selected || !session || result || isClosed) return undefined;
    function tick() {
      const elapsed = performance.now() - timerAnchor.current.monotonic;
      setRemainingSeconds(Math.max(0, Math.ceil((new Date(session.expiresAt).getTime() - timerAnchor.current.serverTime - elapsed) / 1000)));
    }
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [selected?._id, session, result, isClosed]);

  useEffect(() => {
    if (!session || !selected) return;
    try {
      window.localStorage.setItem(`gradesense-assessment-draft:${session._id}`, JSON.stringify({ answers: selectedAnswers, questionIndex, lockedIndex }));
    } catch { /* Answering remains available when browser storage is disabled. */ }
  }, [session, selectedId, answers, questionIndex, lockedIndex]);

  function backToAssessments() {
    setSelectedId(""); setAssessmentDetail(null); setSession(null); setResult(null); setMessage(""); onBack?.();
  }

  async function startAssessment() {
    if (!selected || selected.canStart === false || selected.canSubmit === false || startInFlight.current) return;
    startInFlight.current = true;
    setStarting(true); setMessage("");
    try {
      const attempt = await api.startAssessment(selected._id);
      // Fetching questions also consumes assessment time.
      timerAnchor.current = { serverTime: new Date(attempt.serverNow).getTime(), monotonic: performance.now() };
      const detail = await api.studentAssessment(selected._id);
      let draft = null;
      try { draft = JSON.parse(window.localStorage.getItem(`gradesense-assessment-draft:${attempt._id}`) || "null"); } catch { /* Storage is optional. */ }
      setAnswers((current) => ({ ...current, [selected._id]: draft?.answers || current[selected._id] || {} }));
      setQuestionIndex(Math.min(Math.max(0, draft?.questionIndex || 0), Math.max(0, (detail.questions?.length || 1) - 1)));
      setLockedByAssessment((current) => ({ ...current, [selected._id]: draft?.lockedIndex ?? current[selected._id] ?? -1 }));
      setAssessmentDetail(detail);
      setSession(attempt);
    } catch (error) {
      setMessage(error.message);
      try { setAssessmentDetail(await api.assessmentInstructions(selected._id)); } catch { /* Keep the last successful details. */ }
    } finally { startInFlight.current = false; setStarting(false); }
  }

  function updateAnswer(questionId, answer) {
    setAnswers((current) => ({
      ...current,
      [selectedId]: {
        ...(current[selectedId] || {}),
        [questionId]: answer
      }
    }));
    setMessage("");
  }

  function goNext() {
    if (!currentQuestion) return;
    if (!isClosed && !answerHasValue(selectedAnswers[currentQuestion._id])) {
      setMessage("Answer the current question before continuing.");
      return;
    }
    if (!isClosed && selected.lockPreviousQuestions) {
      setLockedByAssessment((current) => ({ ...current, [selectedId]: Math.max(current[selectedId] ?? -1, questionIndex) }));
    }
    setMessage("");
    setQuestionIndex((index) => Math.min(index + 1, questionCount - 1));
  }

  function goPrevious() {
    if (!isClosed && selected.lockPreviousQuestions && questionIndex - 1 <= lockedIndex) return;
    setQuestionIndex((index) => Math.max(index - 1, 0));
  }

  function formatRemaining(seconds) {
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    return `${minutes}:${String(rest).padStart(2, "0")}`;
  }

  async function submit(event) {
    event.preventDefault();
    if (!selected || !session || isClosed || submissionInFlight.current) return;

    const missing = (selected.questions || []).filter((question) => !answerHasValue(selectedAnswers[question._id]));
    if (missing.length) {
      setMessage(`Answer all required questions before submitting. Missing: ${missing.length}`);
      return;
    }

    if (!window.confirm("Submit this assessment for grading?")) return;

    const body = new FormData();
    body.append("answers", JSON.stringify((selected.questions || []).map((question) => ({ question: question._id, answer: selectedAnswers[question._id] }))));
    body.append("startedAt", session.startedAt);
    body.append("timeExpired", timeExpired ? "true" : "false");

    submissionInFlight.current = true;
    setSubmitting(true);
    setMessage("");
    function showResults(submission) {
      try { window.localStorage.removeItem(`gradesense-assessment-draft:${session._id}`); } catch { /* Storage is optional. */ }
      setResult(submission);
      setData((current) => (current || []).map((item) => item._id === selected._id ? { ...item, studentStatus: "Completed", attemptsUsed: 1, canSubmit: false, previousSubmission: submission } : item));
      setSelectedId("");
      setQuestionIndex(0);
      setAnswers((current) => { const next = { ...current }; delete next[selected._id]; return next; });
      setMessage("");
      onSubmitted?.(selected._id, submission);
    }
    try {
      const submission = await api.submitAssessment(selected._id, body);
      showResults(submission);
    } catch (error) {
      // Recover a saved submission after a lost response or a duplicate request.
      try {
        const saved = error.submissionId ? await api.submission(error.submissionId) : (await api.studentAssessment(selected._id)).previousSubmission;
        if (saved?._id && ["submitted", "graded"].includes(saved.status)) showResults(saved);
        else setMessage(error.message);
      } catch {
        setMessage(error.message);
      }
    } finally {
      submissionInFlight.current = false;
      setSubmitting(false);
    }
  }

  if (result?._id) return <AssessmentResults key={result._id} submissionId={result._id} initialSubmission={result} onBack={() => { setResult(null); setSelectedId(""); onBack?.(); }} />;
  if (detailLoading) return <LoadingState label="Loading assessment instructions" />;
  if (selected && !session) return <AssessmentInstructions assessment={selected} starting={starting} message={message} onBack={backToAssessments} onStart={startAssessment} />;
  if (selected) {
    return (
      <div className="mx-auto max-w-5xl space-y-5">
        <div className="premium-card sticky top-[73px] z-20 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button className="btn-neutral flex items-center gap-2 px-3 py-2 text-sm" onClick={backToAssessments} type="button">
              <ArrowLeft size={16} />
              Assessments
            </button>
            <div className="min-w-0 flex-1 text-center">
              <h1 className="truncate text-lg font-black text-slate-950">{selected.title}</h1>
            </div>
            {isClosed ? <StatusBadge value={selected.studentStatus} label={studentAssessmentSubmission(selected).submissionStatus} /> : <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-bold ${timeExpired ? "border-red-200 bg-red-50 text-red-700" : "border-slate-200 bg-white text-slate-700"}`}><Clock size={16} />{formatRemaining(remainingSeconds)}</div>}
          </div>
          {!isClosed && <div className="mt-4">
            <div className="mb-1 flex justify-between text-sm text-slate-600"><span>Question {questionIndex + 1} of {questionCount}</span><span>{progress}% complete</span></div>
            <div className="h-2 rounded-full bg-slate-200"><div className="h-2 rounded-full bg-[#FF6B00]" style={{ width: `${progress}%` }} /></div>
          </div>}
        </div>

        <div className="premium-card p-4 text-sm text-slate-700">
          <div className="grid gap-3 md:grid-cols-3">
            <p><span className="font-bold text-slate-950">{formatType(selected.assessmentType)}</span> - {selected.numberOfQuestions} questions</p>
            <p>Due: <span className="font-bold text-slate-950">{selected.dueDate ? new Date(selected.dueDate).toLocaleDateString() : "No due date"}</span></p>
            <p>Attempts: <span className="font-bold text-slate-950">{selected.attemptLimit > 0 ? `${selected.attemptsUsed || 0}/${selected.attemptLimit}` : `${selected.attemptsUsed || 0}/Unlimited`}</span></p>
          </div>
          {selected.instructions && <p className="mt-2">{selected.instructions}</p>}
        </div>
        {message && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{message}</div>}
        {isClosed && <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">This assessment is {selected.studentStatus.toLowerCase()}. Questions and any recorded result are available for viewing only.</div>}
        {isClosed && selected.previousSubmission && <div className="grid gap-3 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-900 md:grid-cols-3"><p>Score: {displayScore(selected.previousSubmission, selected.previousSubmission.totalPossiblePoints || selected.totalPoints)}</p><p>Percentage: {displayPercentage(selected.previousSubmission)}</p><p>Submitted: {selected.previousSubmission.submittedAt ? new Date(selected.previousSubmission.submittedAt).toLocaleString() : "Recorded"}</p></div>}
        <form className="space-y-4" onSubmit={submit}>
          {currentQuestion && (
            <div className="premium-card-elevated p-5 md:p-8" key={currentQuestion._id}>
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <StatusBadge value={formatType(currentQuestion.type)} />
                <span className="text-sm font-bold text-slate-500">{currentQuestion.points || 1} point(s)</span>
              </div>
              <h3 className="text-sm font-bold uppercase tracking-[0.14em] text-[#D94F00]">Question {questionIndex + 1} of {questionCount}</h3>
              <p className="mt-3 text-xl font-bold leading-8 text-slate-950">{currentQuestion.text}</p>
              {isClosed ? <p className="mt-4 text-sm text-slate-500">Responses cannot be changed or submitted.</p> : answerInput(currentQuestion, selectedAnswers[currentQuestion._id], (answer) => updateAnswer(currentQuestion._id, answer))}
            </div>
          )}
          <div className="flex flex-wrap justify-between gap-2">
            <button className="btn-neutral flex items-center gap-2 px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50" disabled={questionIndex === 0 || (!isClosed && selected.lockPreviousQuestions && questionIndex - 1 <= lockedIndex)} onClick={goPrevious} type="button">
              <ArrowLeft size={16} />
              Previous
            </button>
            {questionIndex < questionCount - 1 && <button className="btn-primary flex items-center gap-2 px-4 py-2 text-sm" onClick={goNext} type="button">Next <ArrowRight size={16} /></button>}
          </div>
          {!isClosed && <button className="btn-primary flex w-full items-center justify-center gap-2 px-4 py-3 text-white disabled:cursor-not-allowed disabled:bg-slate-400 md:w-auto" disabled={!answeredCount || submitting || !!result} type="submit">
            <CheckCircle2 size={18} />
            {submitting ? "Submitting" : timeExpired ? "Submit Expired Assessment" : "Submit Assessment"}
          </button>}
        </form>
      </div>
    );
  }

  if (loading || error) return <LoadingState label="Loading assigned assessments" error={error} />;
  return (
    <div className="space-y-6">
      {!embedded && <PageHeader eyebrow="Assessments" title="Upcoming Assessments" description="Start assigned quizzes, exams, and activities when you are ready." />}
      {embedded && <button className="btn-neutral flex items-center gap-2 px-3 py-2 text-sm" onClick={onBack} type="button"><ArrowLeft size={16} />Back to Subject</button>}
      {message && <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">{message}</div>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {visibleAssessments.map((assessment) => {
        const state = studentAssessmentSubmission(assessment);
        return (
        <button
          className="premium-card p-5 text-left transition hover:-translate-y-0.5 hover:border-[#FFE4CC] hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60"
          disabled={state.hasSubmitted && !state.resultsAvailable}
          key={assessment._id}
          onClick={() => state.resultsAvailable ? setResult(state.submission) : !state.hasSubmitted && setSelectedId(assessment._id)}
          type="button"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold text-slate-900">{assessment.title}</h3>
              <p className="mt-1 text-sm text-slate-600">{formatType(assessment.assessmentType)}</p>
            </div>
            <StatusBadge value={assessment.studentStatus} label={state.submissionStatus} />
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-slate-500">Questions</dt><dd className="font-medium">{assessment.numberOfQuestions}</dd></div>
            <div><dt className="text-slate-500">Due Date</dt><dd className="font-medium">{assessment.dueDate ? new Date(assessment.dueDate).toLocaleDateString() : "None"}</dd></div>
            <div><dt className="text-slate-500">Duration</dt><dd className="font-medium">{assessment.durationMinutes || 30} min</dd></div>
            <div><dt className="text-slate-500">Attempts</dt><dd className="font-medium">{assessment.attemptsUsed || 0}/{assessment.attemptLimit > 0 ? assessment.attemptLimit : "Unlimited"}</dd></div>
          </dl>
          <span className="mt-4 block text-sm font-bold text-[#D94F00]">{state.actionLabel}</span>
        </button>
      ); })}
      {!visibleAssessments.length && <Panel title="No assessments yet" eyebrow="Empty state"><p className="text-sm text-slate-600">No published assessments are currently assigned.</p></Panel>}
      </div>
    </div>
  );
}
