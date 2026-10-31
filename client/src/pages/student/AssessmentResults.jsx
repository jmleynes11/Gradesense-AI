import { useEffect, useState } from "react";
import { ArrowLeft, LoaderCircle } from "lucide-react";
import LoadingState from "../../components/LoadingState";
import PageHeader from "../../components/PageHeader";
import Panel from "../../components/Panel";
import StatusBadge from "../../components/StatusBadge";
import { api } from "../../services/api";
import { displayScore, displayPercentage, isGradePending, isAnswerGradePending, resultStatus } from "../../services/gradeDisplay";

export default function AssessmentResults({ submissionId, initialSubmission = null, onBack }) {
  const [submission, setSubmission] = useState(initialSubmission?.status ? initialSubmission : null);
  const [error, setError] = useState("");
  const [feedbackError, setFeedbackError] = useState("");
  const [retrying, setRetrying] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const pending = isGradePending(submission);
  const overall = submission?.overallFeedback;

  useEffect(() => {
    let active = true;
    let timer;
    async function refresh() {
      let refreshAgain = true;
      try {
        const saved = await api.submission(submissionId);
        if (!active) return;
        setSubmission(saved);
        setError("");
        refreshAgain = isGradePending(saved) || ["processing", "waiting_for_grading"].includes(saved.overallFeedback?.status);
      } catch (err) {
        if (active) setError(`${err.message}. Results will reload automatically.`);
      } finally {
        if (active && refreshAgain) timer = window.setTimeout(refresh, 3000);
      }
    }
    // Retain the successful submission response during transient read failures.
    // Keep checking pending teacher review as well as active AI evaluation.
    void refresh();
    return () => { active = false; window.clearTimeout(timer); };
  }, [submissionId, refreshKey]);

  async function retryFeedback() {
    if (retrying) return;
    setRetrying(true); setFeedbackError("");
    try {
      const saved = await api.retryOverallFeedback(submissionId);
      setSubmission(saved);
      setRefreshKey((value) => value + 1);
    } catch (err) { setFeedbackError(err.message); }
    finally { setRetrying(false); }
  }

  const assessment = submission?.assessment;
  return (
    <div className="mx-auto max-w-5xl space-y-5" aria-live="polite">
      <button className="btn-neutral flex items-center gap-2 px-3 py-2 text-sm" onClick={onBack} type="button"><ArrowLeft size={16} />Back</button>
      <PageHeader eyebrow="Assessment Results" title={assessment?.title || "Assessment Results"} description={assessment?.subject || assessment?.subjectRef?.name} actions={submission && <StatusBadge value={pending ? "Pending" : "Completed"} label={resultStatus(submission)} />} />
      {error && <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{error}<button className="ml-3 font-bold underline" onClick={() => setRefreshKey((value) => value + 1)} type="button">Retry loading results</button></div>}
      {!submission ? <LoadingState label="Loading saved results" /> : <>
        <Panel title="Overall AI Feedback">
          {pending ? <div className="flex items-start gap-3 rounded-lg border border-[#FFE4CC] bg-[#FFF3E8] p-4 text-sm leading-6 text-slate-700" role="status">
            {submission.aiGradingStatus === "processing" && <LoaderCircle className="mt-1 shrink-0 animate-spin text-[#D94F00] motion-reduce:animate-none" size={20} aria-hidden="true" />}
            <p>{resultStatus(submission) !== "Partial Result" && "Grading is in progress; no questions have been graded yet. "}{submission.aiGradingStatus === "processing" ? "Your assessment is being evaluated by GradeSense AI. Available scores are shown below while the remaining questions are graded." : "Some questions are pending teacher review because AI grading could not complete automatically. Available scores are shown below. Your saved answers are preserved, and results and feedback will update automatically when review is complete."}</p>
          </div> : overall?.status === "completed" ? <div className="space-y-4 text-sm leading-6 text-slate-700">
            <div><h2 className="font-bold text-slate-950">Overall Feedback</h2><p className="mt-1 whitespace-pre-wrap">{overall.summary}</p></div>
            <div className="grid gap-4 md:grid-cols-3">{[["Strengths", overall.strengths], ["Areas for Improvement", overall.weaknesses], ["Recommendations", overall.recommendations]].map(([label, items]) => items?.length > 0 && <div key={label}><h3 className="font-bold text-[#D94F00]">{label}</h3><ul className="mt-2 list-disc space-y-2 pl-5">{items.map((item, index) => <li key={index}>{item}</li>)}</ul></div>)}</div>
          </div> : overall?.status === "failed" ? <div role="alert" className="space-y-3 text-sm text-amber-800">
            <p>{overall.message || "GradeSense AI could not generate your overall feedback. Your saved results remain available."}</p>
            <button className="btn-secondary px-4 py-2 disabled:opacity-50" disabled={retrying} onClick={retryFeedback} type="button">{retrying ? "Retrying…" : "Retry overall feedback"}</button>
          </div> : overall?.status === "waiting_for_grading" ? <p role="status" className="text-sm text-slate-700">Overall feedback will be prepared after the remaining question evaluations and any required teacher review are complete.</p> : <div className="flex items-start gap-3 text-sm leading-6 text-slate-700" role="status" aria-busy="true">
            <LoaderCircle className="mt-1 shrink-0 animate-spin text-[#D94F00] motion-reduce:animate-none" size={20} aria-hidden="true" />
            <p>GradeSense AI is analyzing your answers and preparing your overall feedback.</p>
          </div>}
          {feedbackError && <p className="mt-3 text-sm text-red-700" role="alert">{feedbackError}</p>}
        </Panel>
        <Panel title="Results">
          <div className="grid gap-4 text-sm md:grid-cols-3">
            <p>Score: <span className="font-bold">{displayScore(submission)}</span></p>
            <p>Percentage: <span className="font-bold">{displayPercentage(submission)}</span></p>
            <p>Submitted: <span className="font-bold">{submission.submittedAt ? new Date(submission.submittedAt).toLocaleString() : "Recorded"}</span></p>
          </div>
          {submission.teacherComments && <p className="mt-4 text-sm text-slate-700">{submission.teacherComments}</p>}
        </Panel>
        {assessment?.allowAnswerReview !== false && (submission.answers || []).map((answer, index) => {
          const score = answer.finalScore ?? answer.score;
          const answerPending = isAnswerGradePending(answer);
          return <Panel key={answer.question || index} title={`Question ${index + 1}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="font-bold text-slate-950">{answer.questionText}</p>
              <StatusBadge value={answerPending ? "Pending" : answer.questionType === "essay" ? "Graded" : answer.isCorrect ? "Correct" : "Incorrect"} label={answerPending ? answer.aiStatus === "processing" ? "Grading in progress" : "Pending Teacher Review" : undefined} />
            </div>
            <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">Your answer: {answer.answer}</p>
            <p className="mt-2 text-sm">{answer.questionType === "essay" ? "Essay score" : "Score"}: {answerPending ? answer.aiStatus === "processing" ? "Grading in progress" : "Pending teacher review" : `${score}/${answer.pointsPossible}`}</p>
            {answer.questionType === "essay" && Number.isFinite(answer.aiScore) && <p className="mt-2 text-sm">AI score: {answer.aiScore}/{answer.pointsPossible}</p>}
            {!answerPending && answer.isCorrect === false && answer.correctAnswer && <p className="mt-2 text-sm font-semibold text-green-800">Correct answer: {answer.correctAnswer}</p>}
            {answer.feedback && <p className="mt-3 text-sm text-slate-700">{answer.feedback}</p>}
            {answer.teacherFeedback && <p className="mt-2 text-sm text-slate-700">Teacher feedback: {answer.teacherFeedback}</p>}
          </Panel>;
        })}
      </>}
    </div>
  );
}
