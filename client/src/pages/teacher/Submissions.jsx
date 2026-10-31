import { useEffect, useRef, useState } from "react";
import Panel from "../../components/Panel";
import SimpleTable from "../../components/SimpleTable";
import { api, saveBlob } from "../../services/api";
import { useAsyncData } from "../../hooks/useAsyncData";
import LoadingState from "../../components/LoadingState";
import { displayScore, displayPercentage } from "../../services/gradeDisplay";
import { assessmentStudentName } from "../../services/assessmentStudentName";

function formatType(type = "") {
  return type.replace("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatStatus(status = "") {
  return status ? status.replace("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) : "Pending";
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : "Not recorded";
}

function questionId(answer) {
  return typeof answer.question === "object" ? answer.question?._id : answer.question;
}

function questionText(answer) {
  return answer.questionText || answer.question?.text || "Question text unavailable";
}

function questionType(answer) {
  return answer.questionType || answer.question?.type || "";
}

function correctAnswer(answer) {
  return answer.correctAnswer || answer.question?.answerKey || "";
}

function pointsPossible(answer) {
  return Number(answer.pointsPossible || answer.question?.points || 0);
}

export default function Submissions({ assessmentId = "", onClearAssessment }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const loadSequence = useRef(0);
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState(null);
  const [answerEdits, setAnswerEdits] = useState({});
  const [savingAnswerId, setSavingAnswerId] = useState("");
  const [assessmentStatus, setAssessmentStatus] = useState(null);
  const [subjectFilter, setSubjectFilter] = useState("");
  const subjects = useAsyncData(api.subjectDashboard, []);

  async function loadSubmissions() {
    const requestId = ++loadSequence.current;
    setLoading(true);
    setMessage("");
    try {
      const [items, status] = await Promise.all([api.submissions(assessmentId), assessmentId ? api.assessmentSubmissionStatus(assessmentId) : Promise.resolve(null)]);
      if (requestId === loadSequence.current) { setRows(items); setAssessmentStatus(status); }
    } catch (error) {
      if (requestId === loadSequence.current) setMessage(error.message || "Unable to load submissions.");
    } finally {
      if (requestId === loadSequence.current) setLoading(false);
    }
  }

  useEffect(() => {
    loadSubmissions();
  }, [assessmentId]);

  async function download(type) {
    if (downloading) return;
    setDownloading(true);
    try {
      if (!assessmentId) throw new Error("Open an assessment's submissions before generating a report.");
      const blob = type === "pdf" ? await api.pdfReport(assessmentId) : await api.excelReport(assessmentId);
      saveBlob(blob, `gradesense-assessment-${assessmentId}.${type === "pdf" ? "pdf" : "xlsx"}`);
    } catch (error) { setMessage(error.message); }
    finally { setDownloading(false); }
  }

  async function openSubmission(id) {
    setMessage("");
    setDetailLoading(true);
    try {
      const detail = await api.submission(id);
      setSelected(detail);
      setAnswerEdits({});
    } catch (error) { setMessage(error.message); }
    finally { setDetailLoading(false); }
  }

  function updateAnswerEdit(id, patch) {
    setAnswerEdits((current) => ({
      ...current,
      [id]: {
        ...(current[id] || {}),
        ...patch,
      },
    }));
  }

  async function saveAnswerOverride(answer) {
    const id = questionId(answer);
    const edit = answerEdits[id] || {};
    setSavingAnswerId(id);
    setMessage("");
    try {
      const updated = await api.overrideSubmissionAnswer(selected._id, id, {
        finalScore: edit.finalScore ?? answer.finalScore ?? answer.score,
        teacherFeedback: edit.teacherFeedback ?? answer.teacherFeedback ?? "",
        feedback: answer.feedback,
      });
      const detail = await api.submission(updated._id);
      setSelected(detail);
      setRows((current) => current.map((row) => row._id === detail._id ? detail : row));
      setAnswerEdits((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      setMessage("Grade updated.");
    } catch (error) {
      setMessage(error.message || "Unable to save grade update.");
    } finally {
      setSavingAnswerId("");
    }
  }

  if (detailLoading) return <LoadingState label="Loading submission answers" />;
  if (selected) {
    return (
      <Panel title="Submission Review">
        <div className="mb-4 flex flex-wrap gap-2">
          <button className="rounded border px-3 py-2 text-sm" onClick={() => { setSelected(null); loadSubmissions(); }} type="button">Back to Submissions</button>
        </div>
        {message && <p className="mb-4 rounded bg-slate-100 p-2 text-sm">{message}</p>}
        <div className="mb-4 grid gap-3 rounded border border-slate-200 bg-slate-50 p-4 text-sm md:grid-cols-4">
          <div><p className="text-slate-500">Student</p><p className="font-medium">{selected.student?.name || "Unknown"}</p></div>
          <div><p className="text-slate-500">Student Number</p><p className="font-medium">{selected.student?.studentNumber || "None"}</p></div>
          <div><p className="text-slate-500">Subject</p><p className="font-medium">{selected.assessment?.subject || "Unassigned"}</p></div>
          <div><p className="text-slate-500">Assessment</p><p className="font-medium">{selected.assessment?.title || "Assessment"}</p></div>
          <div><p className="text-slate-500">Submitted</p><p className="font-medium">{formatDate(selected.submittedAt || selected.createdAt)}</p></div>
          <div><p className="text-slate-500">Status</p><p className="font-medium">{formatStatus(selected.status)}</p></div>
          <div><p className="text-slate-500">Score</p><p className="font-medium">{displayScore(selected)}</p></div>
          <div><p className="text-slate-500">Percentage</p><p className="font-medium">{displayPercentage(selected)}</p></div>
          <div><p className="text-slate-500">Pass/Fail</p><p className="font-medium">{formatStatus(selected.passStatus)}</p></div>
          <div><p className="text-slate-500">Graded</p><p className="font-medium">{formatDate(selected.gradedAt)}</p></div>
          <div><p className="text-slate-500">Graded By</p><p className="font-medium">{selected.gradedBy?.name || "System"}</p></div>
          <div><p className="text-slate-500">AI Status</p><p className="font-medium">{formatStatus(selected.aiGradingStatus)}</p></div>
        </div>

        <div className="space-y-4">
          {(selected.answers || []).map((answer, index) => {
            const id = questionId(answer);
            const edit = answerEdits[id] || {};
            const type = questionType(answer);
            const possible = pointsPossible(answer);
            const isEssay = type === "essay";
            const isCoding = type === "coding";
            const finalScore = edit.finalScore ?? answer.finalScore ?? answer.score ?? 0;
            const teacherFeedback = edit.teacherFeedback ?? answer.teacherFeedback ?? "";
            return (
              <div className="rounded border border-slate-200 p-4" key={id || index}>
                <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase text-slate-500">{formatType(type)} - {possible} point(s)</p>
                    <h3 className="mt-1 font-medium">{index + 1}. {questionText(answer)}</h3>
                  </div>
                  <span className={`rounded px-2 py-1 text-xs ${answer.isCorrect ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>
                    {isCoding ? "Coding Review" : isEssay ? "Essay" : answer.isCorrect ? "Correct" : "Incorrect"}
                  </span>
                </div>

                <div className="grid gap-3 text-sm md:grid-cols-2">
                  <div>
                    <p className="text-slate-500">{isCoding ? "Student Code" : isEssay ? "Student Essay Answer" : "Student Answer"}</p>
                    <p className="mt-1 whitespace-pre-wrap rounded border border-slate-200 bg-white p-3">{answer.answer || "No answer"}</p>
                  </div>
                  {isCoding && (
                    <div>
                      <p className="text-slate-500">Programming Details</p>
                      <div className="mt-1 space-y-1 rounded border border-slate-200 bg-white p-3">
                        <p>Language: {answer.codeLanguage || "Not specified"}</p>
                        <p>Expected Output: {answer.expectedOutput || "Not set"}</p>
                        <p>Sample Input: {answer.sampleInput || "None"}</p>
                      </div>
                    </div>
                  )}
                  {!isEssay && !isCoding && (
                    <div>
                      <p className="text-slate-500">Correct Answer</p>
                      <p className="mt-1 rounded border border-slate-200 bg-white p-3">{correctAnswer(answer) || "Not set"}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-slate-500">Score Earned</p>
                    <p className="mt-1 font-medium">{["pending_review", "failed"].includes(answer.aiStatus) ? "Pending teacher review" : `${answer.finalScore ?? answer.score ?? 0}/${possible}`}</p>
                  </div>
                  {isEssay && (
                    <div>
                      <p className="text-slate-500">AI Feedback</p>
                      <p className="mt-1 whitespace-pre-wrap rounded border border-slate-200 bg-white p-3">{answer.feedback || "No AI feedback"}</p>
                    </div>
                  )}
                  {isEssay && <div><p className="text-slate-500">AI Score</p><p className="mt-1 font-medium">{answer.aiScore != null ? `${answer.aiScore}/${possible}` : answer.aiStatus === "teacher_reviewed" ? "Unavailable; teacher reviewed" : "Pending teacher review"}</p></div>}
                  {isEssay && answer.rubricBreakdown && (
                    <div className="md:col-span-2">
                      <p className="text-slate-500">Rubric Breakdown</p>
                      <div className="mt-1 grid gap-2 rounded border border-slate-200 bg-white p-3 md:grid-cols-4">
                        {(answer.rubricBreakdown.criteria || Object.entries(answer.rubricBreakdown).map(([criterion, score]) => ({ criterion, score }))).map((item, index) => (
                          <div key={`${item.criterion}-${index}`}>
                            <p className="font-medium">{formatType(item.criterion)}</p>
                            <p>{item.score}{item.maxScore != null ? `/${item.maxScore}` : ""}</p>
                            {item.feedback && <p className="mt-1 text-xs text-slate-500">{item.feedback}</p>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {isEssay && answer.plagiarismReport && (
                    <div className="md:col-span-2">
                      <p className="text-slate-500">Plagiarism Review</p>
                      <div className="mt-1 space-y-2 rounded border border-slate-200 bg-white p-3">
                        <p>Similarity: {answer.plagiarismReport.similarityPercentage || 0}%</p>
                        <p>Matching Student: {answer.plagiarismReport.matchingStudentName || "None"}</p>
                        <p>Status: {answer.plagiarismReport.status || "Low Risk"}</p>
                        {!!answer.plagiarismReport.highlightedText?.length && (
                          <div>
                            <p className="font-medium">Highlighted Similar Text</p>
                            <ul className="list-disc pl-5">
                              {answer.plagiarismReport.highlightedText.map((text) => <li key={text}>{text}</li>)}
                            </ul>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  {isEssay && answer.aiContentReport && (
                    <div className="md:col-span-2">
                      <p className="text-slate-500">AI-Generated Content Review</p>
                      <div className="mt-1 space-y-2 rounded border border-slate-200 bg-white p-3">
                        <p>AI Content Probability: {answer.aiContentReport.probability}</p>
                        <p>Confidence: {answer.aiContentReport.confidencePercentage || 0}%</p>
                        <p>Reasoning: {answer.aiContentReport.reasoning}</p>
                        <ul className="list-disc pl-5">
                          {(answer.aiContentReport.writingPatternAnalysis || []).map((item) => <li key={item}>{item}</li>)}
                        </ul>
                      </div>
                    </div>
                  )}
                  {(isEssay || isCoding) && (
                    <div className="md:col-span-2">
                      <div className="grid gap-2 md:grid-cols-3">
                        <label className="grid gap-1">
                          <span className="text-slate-500">Assigned Score</span>
                          <input
                            className="rounded border px-3 py-2"
                            max={possible}
                            min="0"
                            step="1"
                            type="number"
                            value={finalScore}
                            onChange={(event) => updateAnswerEdit(id, { finalScore: event.target.value })}
                          />
                        </label>
                        <label className="grid gap-1 md:col-span-2">
                          <span className="text-slate-500">Teacher Feedback</span>
                          <input
                            className="rounded border px-3 py-2"
                            value={teacherFeedback}
                            onChange={(event) => updateAnswerEdit(id, { teacherFeedback: event.target.value })}
                          />
                        </label>
                      </div>
                      <button
                        className="mt-2 rounded bg-slate-900 px-3 py-2 text-sm text-white disabled:cursor-not-allowed disabled:bg-slate-400"
                        disabled={savingAnswerId === id}
                        onClick={() => saveAnswerOverride(answer)}
                        type="button"
                      >
                        {savingAnswerId === id ? "Saving..." : "Save Grade"}
                      </button>
                    </div>
                  )}
                  {(isEssay || isCoding) && answer.teacherFeedback && (
                    <div className="md:col-span-2">
                      <p className="text-slate-500">Saved Teacher Feedback</p>
                      <p className="mt-1 whitespace-pre-wrap rounded border border-slate-200 bg-white p-3">{answer.teacherFeedback}</p>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Panel>
    );
  }

  return (
    <Panel title="Student Submission Management">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <button className="rounded border px-3 py-2 text-sm" onClick={loadSubmissions} type="button">Refresh</button>
          {assessmentId && <button className="rounded border px-3 py-2 text-sm" onClick={onClearAssessment} type="button">Show All Submissions</button>}
        </div>
        <div className="flex gap-2">
          <button className="rounded border px-3 py-2 text-sm" disabled={downloading} onClick={() => download("pdf")} type="button">{downloading ? "Preparing report…" : "PDF Report"}</button>
          <button className="rounded border px-3 py-2 text-sm" disabled={downloading} onClick={() => download("excel")} type="button">{downloading ? "Preparing report…" : "Excel Report"}</button>
        </div>
      </div>
      {message && <p className="mb-4 rounded bg-slate-100 p-2 text-sm">{message}</p>}
      {!assessmentId && <select className="field mb-4 max-w-sm" value={subjectFilter} onChange={(event) => setSubjectFilter(event.target.value)}>
        <option value="">All subjects</option>
        {(subjects.data || []).map((subject) => <option key={subject._id} value={subject.name}>{subject.name}</option>)}
      </select>}
      {assessmentStatus && <>
        <div className="mb-4 grid gap-3 md:grid-cols-4">
          <div className="rounded border border-slate-200 bg-slate-50 p-3"><p className="text-sm text-slate-500">Total students</p><p className="text-xl font-bold">{assessmentStatus.totalStudents}</p></div>
          <div className="rounded border border-slate-200 bg-slate-50 p-3"><p className="text-sm text-slate-500">Turned In</p><p className="text-xl font-bold">{assessmentStatus.turnedIn}/{assessmentStatus.totalStudents}</p></div>
          <div className="rounded border border-slate-200 bg-slate-50 p-3"><p className="text-sm text-slate-500">Submitted</p><p className="text-xl font-bold">{assessmentStatus.turnedIn}</p></div>
          <div className="rounded border border-slate-200 bg-slate-50 p-3"><p className="text-sm text-slate-500">Not submitted</p><p className="text-xl font-bold">{assessmentStatus.notSubmitted}</p></div>
          <div className="rounded border border-slate-200 bg-slate-50 p-3"><p className="text-sm text-slate-500">Average score</p><p className="text-xl font-bold">{assessmentStatus.averageScore == null ? "Pending" : `${assessmentStatus.averageScore}%`}</p></div>
        </div>
      </>}
      {loading ? (
        <p className="text-sm text-slate-600">Loading submissions...</p>
      ) : (
        <SimpleTable columns={[
          { key: "student", label: "Student", render: (row) => assessmentStudentName(row.student) },
          { key: "studentNumber", label: "Student Number", render: (row) => row.student?.studentNumber || "None" },
          { key: "subject", label: "Subject", render: (row) => row.assessment?.subject || "Unassigned" },
          { key: "assessment", label: "Assessment", render: (row) => row.assessment?.title || "Assessment" },
          { key: "submittedAt", label: "Submitted", render: (row) => row.status === "not_submitted" ? "Not recorded" : formatDate(row.submittedAt || row.createdAt) },
          { key: "status", label: "Status", render: (row) => formatStatus(row.status) },
          { key: "score", label: "Total Score", render: (row) => row.status === "not_submitted" ? "Not submitted" : displayScore(row) },
          { key: "percentage", label: "Percentage", render: (row) => row.status === "not_submitted" ? "Not submitted" : displayPercentage(row) },
          { key: "action", label: "Action", render: (row) => row.status === "not_submitted" ? "" : <button className="rounded border px-2 py-1 text-xs" onClick={() => openSubmission(row._id)} type="button">Review Submission</button> }
        ]} rows={rows.filter((row) => !subjectFilter || row.assessment?.subject === subjectFilter)} />
      )}
    </Panel>
  );
}
