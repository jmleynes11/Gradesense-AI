import { useEffect, useMemo, useRef, useState } from "react";
import LoadingState from "../../components/LoadingState";
import Panel from "../../components/Panel";
import SimpleTable from "../../components/SimpleTable";
import { useAsyncData } from "../../hooks/useAsyncData";
import { api } from "../../services/api";
import PageHeader from "../../components/PageHeader";
import StatusBadge from "../../components/StatusBadge";
import { Sparkles } from "lucide-react";

function createBlankQuestion() {
  return {
    type: "multiple_choice",
    text: "",
    choices: ["", "", "", ""],
    answerKey: "",
    explanation: "",
    suggestedAnswer: "",
    rubric: { keyPoints: [] },
    programming: {
      language: "JavaScript",
      allowedLanguages: ["Java", "Python", "JavaScript", "C++", "C#"],
      starterCode: "",
      expectedOutput: "",
      sampleInput: "",
      sampleOutput: "",
      timeLimitSeconds: 2
    },
    points: 1
  };
}

function cleanQuestionText(value = "") {
  return String(value ?? "").trim();
}

function cleanExplanation(value = "") {
  return String(value ?? "").trim();
}

function normalizeQuestion(question) {
  const choices = question.type === "multiple_choice" ? (question.choices || []).filter((choice) => choice.trim()) : [];
  return {
    ...question,
    text: cleanQuestionText(question.text),
    explanation: cleanExplanation(question.explanation),
    choices,
    points: Number(question.points) || 1,
    answerKey: question.type === "essay" ? question.answerKey || question.suggestedAnswer || "" : question.answerKey,
    programming: question.type === "coding" ? question.programming : undefined
  };
}

export default function Assessments({ initialSubjectId = "", onViewSubmissions }) {
  const subjects = useAsyncData(api.subjectDashboard, []);
  const [subjectFilter, setSubjectFilter] = useState("");
  const [assessmentFilter, setAssessmentFilter] = useState("all");
  const [page, setPage] = useState(1);
  const assessments = useAsyncData(() => api.assessments({ view: "summary", page, limit: 20,
    ...(subjectFilter ? { subjectRef: subjectFilter } : {}),
    ...(assessmentFilter !== "all" ? { status: assessmentFilter } : {}),
  }), [page, subjectFilter, assessmentFilter]);
  const assessmentRows = assessments.data?.items || [];
  const [reviewLoading, setReviewLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const reviewRequest = useRef(0);
  function updateAssessmentRows(updater) {
    assessments.setData((current) => ({ ...current, items: updater(current?.items || []) }));
  }
  const [form, setForm] = useState({
    title: "",
    description: "",
    instructions: "Read each question carefully.",
    subjectRef: "",
    dueDate: "",
    durationMinutes: 30,
    attemptLimit: 1,
    lockPreviousQuestions: false,
    randomizeQuestions: true,
    randomizeChoices: true,
    assessmentType: "quiz",
    status: "draft"
  });
  const [review, setReview] = useState(null);
  const [message, setMessage] = useState("");
  const [confirm, setConfirm] = useState(null);
  const [adding, setAdding] = useState(false);
  const [newQuestion, setNewQuestion] = useState(createBlankQuestion);
  const [questionDrafts, setQuestionDrafts] = useState({});
  const [deletingId, setDeletingId] = useState("");
  const [deleteCandidate, setDeleteCandidate] = useState(null);
  const [regeneratingId, setRegeneratingId] = useState("");
  const [savingQuestion, setSavingQuestion] = useState(false);

  // Keep typing events inside editor controls. This deliberately does not call
  // preventDefault, so Space continues to insert a normal space character.
  function keepTextEntryLocal(event) {
    event.stopPropagation();
  }

  useEffect(() => {
    if (!initialSubjectId) return;
    setForm((current) => ({ ...current, subjectRef: initialSubjectId }));
    setSubjectFilter(initialSubjectId);
  }, [initialSubjectId]);

  const visibleAssessments = useMemo(() => assessmentRows.filter((item) => {
    const subjectId = String(item.subjectRef?._id || item.subjectRef || "");
    const isAiGenerated = Boolean(item.generationId || item.originalAiVersion);
    if (subjectFilter && subjectId !== subjectFilter) return false;
    if (assessmentFilter === "published") return item.status === "published";
    if (assessmentFilter === "draft") return item.status === "draft";
    if (assessmentFilter === "ai_review") return isAiGenerated && item.status === "draft";
    return true;
  }), [assessments.data, assessmentFilter, subjectFilter]);

  async function create(event) {
    event.preventDefault();
    setMessage("");
    if (!form.title.trim() || !form.subjectRef || !form.dueDate) {
      setMessage("Title, subject, and submission date are required.");
      return;
    }
    try {
      const item = await api.createAssessment(form);
      updateAssessmentRows((rows) => [item, ...rows]);
      setMessage("Assessment created successfully.");
      setForm((current) => ({ ...current, title: "", description: "", subjectRef: "", dueDate: "" }));
    } catch (error) {
      console.error("Assessment draft creation failed:", error);
      setMessage(error.message || "Assessment creation failed.");
    }
  }

  async function openReview(id) {
    const requestId = ++reviewRequest.current;
    setReviewLoading(true);
    setMessage("");
    setConfirm(null);
    setAdding(false);
    setQuestionDrafts({});
    setNewQuestion(createBlankQuestion());
    try {
      const item = await api.assessment(id);
      if (reviewRequest.current === requestId) setReview(item);
    } catch (error) {
      if (reviewRequest.current === requestId) setMessage(error.message);
    } finally {
      if (reviewRequest.current === requestId) setReviewLoading(false);
    }
  }

  async function saveAssessment(field, value) {
    const updated = await api.updateAssessment(review._id, { [field]: value });
    setReview({ ...review, ...updated });
    updateAssessmentRows((rows) => rows.map((item) => item._id === updated._id ? updated : item));
  }

  function draftFor(question) {
    return questionDrafts[question._id] || question;
  }

  function updateQuestionDraft(question, patch) {
    setQuestionDrafts((current) => ({
      ...current,
      [question._id]: normalizeQuestionPatch({ ...(current[question._id] || question), ...patch }, patch)
    }));
  }

  async function saveQuestion(question) {
    try {
      const draft = normalizeQuestion(draftFor(question));
      const updated = await api.updateQuestion(question._id, draft);
      setReview((current) => ({ ...current, questions: current.questions.map((item) => item._id === question._id ? updated : item) }));
      setQuestionDrafts((current) => {
        const next = { ...current };
        delete next[question._id];
        return next;
      });
      setMessage("Question saved.");
    } catch (error) {
      console.error("Question update failed:", error);
      setMessage(error.message || "Question update failed.");
    }
  }

  async function addQuestion(event) {
    event.preventDefault();
    if (savingQuestion) return;
    const question = normalizeQuestion({ ...newQuestion, assessment: review._id, subject: review.subject });
    if (!question.text) {
      setMessage("Question text is required.");
      return;
    }
    if (["multiple_choice", "true_false", "identification"].includes(question.type) && !String(question.answerKey || "").trim()) {
      setMessage("Answer key is required.");
      return;
    }
    if (question.type === "multiple_choice" && (question.choices || []).length !== 4) {
      setMessage("Multiple choice questions need exactly four choices.");
      return;
    }
    if (review.questions.some((item) => item.text.trim() === question.text.trim())) {
      setMessage("This question already exists in the assessment.");
      return;
    }
    setSavingQuestion(true);
    setMessage("");
    try {
      const created = await api.createQuestion(question);
      setReview((current) => ({ ...current, questions: [...current.questions, created] }));
      setNewQuestion(createBlankQuestion());
      setMessage("Question added successfully.");
    } catch (error) {
      console.error("Question creation failed:", error);
      setMessage(error.message || "Question creation failed.");
    } finally {
      setSavingQuestion(false);
    }
  }

  async function duplicateQuestion(id) {
    const created = await api.duplicateQuestion(id);
    setReview({ ...review, questions: [...review.questions, created] });
  }

  async function regenerateQuestion(id) {
    if (regeneratingId) return;
    setRegeneratingId(id);
    setMessage("");
    try {
      const updated = await api.regenerateQuestion(id);
      setReview({ ...review, questions: review.questions.map((item) => item._id === id ? updated : item) });
      setQuestionDrafts((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      setMessage("Question regenerated.");
    } catch (error) {
      setMessage(error.message || "Question regeneration failed.");
    } finally {
      setRegeneratingId("");
    }
  }

  async function deleteQuestion(id) {
    if (!window.confirm("Delete this question?")) return;
    await api.deleteQuestion(id);
    setReview({ ...review, questions: review.questions.filter((item) => item._id !== id) });
  }

  function requestDelete(assessment) {
    if (!deletingId) setDeleteCandidate(assessment);
  }

  async function deleteAssessment() {
    const id = deleteCandidate?._id;
    if (!id) return;
    if (deletingId) return;

    setDeletingId(id);
    setMessage("");
    try {
      await api.deleteAssessment(id);
      updateAssessmentRows((rows) => rows.filter((item) => item._id !== id));
      if (review?._id === id) setReview(null);
      setDeleteCandidate(null);
      setMessage("Assessment deleted successfully.");
    } catch (error) {
      setMessage(error.message || "Assessment deletion failed.");
    } finally {
      setDeletingId("");
    }
  }

  function updateNewQuestion(patch) {
    setNewQuestion((current) => {
      return normalizeQuestionPatch({ ...current, ...patch }, patch);
    });
  }

  function normalizeQuestionPatch(question, patch) {
    const next = { ...question };
    if (Object.prototype.hasOwnProperty.call(patch, "type")) {
      if (next.type === "multiple_choice" && !next.choices?.length) next.choices = ["", "", "", ""];
      if (next.type !== "multiple_choice") next.choices = [];
      if (next.type === "true_false" && !["true", "false"].includes(next.answerKey)) next.answerKey = "true";
      if (next.type === "essay") next.answerKey = next.answerKey || next.suggestedAnswer || "";
      if (next.type === "coding" && !next.programming) next.programming = createBlankQuestion().programming;
    }
    return next;
  }

  function choiceControls(question, onPatch) {
    const choices = question.choices?.length ? question.choices : [""];
    return (
      <div className="mt-2 space-y-2">
        {choices.map((choice, choiceIndex) => (
          <div className="flex gap-2" key={choiceIndex}>
            <input checked={question.answerKey === choice && !!choice} onChange={() => onPatch({ answerKey: choice })} type="radio" />
            <input className="flex-1 rounded border px-3 py-2" value={choice} onKeyDown={keepTextEntryLocal} onChange={(e) => {
              const nextChoices = [...choices];
              const previous = nextChoices[choiceIndex];
              nextChoices[choiceIndex] = e.target.value;
              onPatch({ choices: nextChoices, answerKey: question.answerKey === previous ? e.target.value : question.answerKey });
            }} placeholder={`Choice ${choiceIndex + 1}`} />
            <button className="rounded border px-2 py-1 text-xs" onClick={() => {
              const nextChoices = choices.filter((_, index) => index !== choiceIndex);
              onPatch({ choices: nextChoices, answerKey: question.answerKey === choice ? "" : question.answerKey });
            }} disabled={choices.length <= 4} type="button">Delete</button>
          </div>
        ))}
        <button className="rounded border px-2 py-1 text-xs" disabled={choices.length >= 4} onClick={() => onPatch({ choices: [...choices, ""] })} type="button">Add Choice</button>
      </div>
    );
  }

  function answerKeyControl(question, onPatch) {
    if (question.type === "multiple_choice") return choiceControls(question, onPatch);
    if (question.type === "true_false") {
      return (
        <select className="rounded border px-3 py-2" value={question.answerKey || "true"} onChange={(e) => onPatch({ answerKey: e.target.value })}>
          <option value="true">True</option>
          <option value="false">False</option>
        </select>
      );
    }
    if (question.type === "essay") {
      return (
        <div className="grid gap-2 md:col-span-3">
          <textarea className="rounded border px-3 py-2" rows="2" value={question.suggestedAnswer || question.answerKey || ""} onKeyDown={keepTextEntryLocal} onChange={(e) => onPatch({ suggestedAnswer: e.target.value, answerKey: e.target.value })} placeholder="Suggested answer" />
          <textarea className="rounded border px-3 py-2" rows="3" value={(question.rubric?.keyPoints || []).join("\n")} onKeyDown={keepTextEntryLocal} onChange={(e) => onPatch({ rubric: { ...(question.rubric || {}), keyPoints: e.target.value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean) } })} placeholder="Grading criteria / expected key points, one per line" />
        </div>
      );
    }
    if (question.type === "coding") {
      const programming = question.programming || createBlankQuestion().programming;
      const patchProgramming = (patch) => onPatch({ programming: { ...programming, ...patch } });
      return (
        <div className="grid gap-2 md:grid-cols-3">
          <select className="rounded border px-3 py-2" value={programming.language || "JavaScript"} onChange={(e) => patchProgramming({ language: e.target.value })}>
            <option value="Java">Java</option>
            <option value="Python">Python</option>
            <option value="JavaScript">JavaScript</option>
            <option value="C++">C++</option>
            <option value="C#">C#</option>
          </select>
          <input className="rounded border px-3 py-2" min="1" type="number" value={programming.timeLimitSeconds || 2} onChange={(e) => patchProgramming({ timeLimitSeconds: Number(e.target.value) })} placeholder="Time limit seconds" />
          <input className="rounded border px-3 py-2" value={programming.expectedOutput || ""} onKeyDown={keepTextEntryLocal} onChange={(e) => patchProgramming({ expectedOutput: e.target.value })} placeholder="Expected output" />
          <textarea className="rounded border px-3 py-2 md:col-span-3" rows="3" value={programming.starterCode || ""} onKeyDown={keepTextEntryLocal} onChange={(e) => patchProgramming({ starterCode: e.target.value })} placeholder="Starter code" />
          <textarea className="rounded border px-3 py-2" rows="2" value={programming.sampleInput || ""} onKeyDown={keepTextEntryLocal} onChange={(e) => patchProgramming({ sampleInput: e.target.value })} placeholder="Sample input" />
          <textarea className="rounded border px-3 py-2" rows="2" value={programming.sampleOutput || ""} onKeyDown={keepTextEntryLocal} onChange={(e) => patchProgramming({ sampleOutput: e.target.value })} placeholder="Sample output" />
        </div>
      );
    }
    return <input className="rounded border px-3 py-2" value={question.answerKey || ""} onKeyDown={keepTextEntryLocal} onChange={(e) => onPatch({ answerKey: e.target.value })} placeholder="Expected answer" />;
  }

  async function moveQuestion(index, direction) {
    const next = [...review.questions];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setReview({ ...review, questions: next });
    await api.reorderQuestions(review._id, next.map((item) => item._id));
  }

  async function showPublishConfirm() {
    if (!review.title.trim()) {
      setMessage("Publishing blocked: assessment title is required.");
      return;
    }
    setConfirmLoading(true);
    try { setConfirm(await api.publishSummary(review._id)); }
    catch (error) { setMessage(error.message); }
    finally { setConfirmLoading(false); }
  }

  async function restoreReview() {
    const id = review._id;
    setReviewLoading(true);
    try { await api.restoreOriginalAssessment(id); await openReview(id); }
    catch (error) { setMessage(error.message); }
    finally { setReviewLoading(false); }
  }

  async function publish() {
    if (publishing) return;
    setPublishing(true);
    try {
      const updated = await api.publishAssessment(review._id);
      setReview({ ...review, ...updated });
      updateAssessmentRows((rows) => rows.map((item) => item._id === updated._id ? updated : item));
      setConfirm(null);
      setMessage("Assessment published successfully.");
    } catch (error) {
      console.error("Assessment publication failed:", error);
      setMessage(error.message || "Assessment publication failed.");
    } finally {
      setPublishing(false);
    }
  }

  if (reviewLoading) return <LoadingState label="Loading assessment questions" />;
  if (review) {
    return (
      <div className="space-y-6">
      <PageHeader
        eyebrow="Assessment Builder"
        title={review.title || "Teacher Review Page"}
        description="Review, edit, regenerate, and publish the assessment. AI assists; the teacher remains the final authority."
        actions={<StatusBadge value={review.status} />}
      />
      <Panel title="Assessment Editor" eyebrow="Teacher authority">
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <button className="btn-neutral px-3 py-2 text-sm" onClick={() => setReview(null)} type="button">Back</button>
          <button className="btn-secondary px-3 py-2 text-sm" onClick={() => setAdding(!adding)} type="button">Add Question</button>
          <button className="btn-neutral px-3 py-2 text-sm" onClick={restoreReview} type="button">Restore Original AI Version</button>
          <button className="btn-primary px-3 py-2 text-sm" disabled={publishing || confirmLoading || review.status === "published"} onClick={showPublishConfirm} type="button">{publishing ? "Publishing…" : confirmLoading ? "Preparing summary…" : "Publish Assessment"}</button>
        </div>
        {message && <p className="mb-4 rounded bg-slate-100 p-2 text-sm">{message}</p>}
        {adding && (
          <form className="mb-5 rounded-lg border border-[#FFE4CC] bg-[#FFF8F2] p-4" onSubmit={addQuestion}>
            <div className="grid gap-3 md:grid-cols-4">
              <select className="field" value={newQuestion.type} onChange={(e) => updateNewQuestion({ type: e.target.value })}>
                <option value="multiple_choice">Multiple Choice</option>
                <option value="true_false">True/False</option>
                <option value="identification">Identification</option>
                <option value="essay">Essay</option>
                <option value="coding">Coding</option>
              </select>
              <input className="field" min="1" type="number" value={newQuestion.points} onChange={(e) => updateNewQuestion({ points: Number(e.target.value) })} />
              <div className="flex gap-2">
                <button className="btn-primary px-3 py-2 text-sm" disabled={savingQuestion} type="submit">{savingQuestion ? "Saving..." : "Save Question"}</button>
                <button className="btn-neutral px-3 py-2 text-sm" onClick={() => setAdding(false)} type="button">Cancel</button>
              </div>
              <textarea className="field md:col-span-4" rows="2" value={newQuestion.text} onKeyDown={keepTextEntryLocal} onChange={(e) => updateNewQuestion({ text: e.target.value })} placeholder="Question text" />
              <div className="md:col-span-4">
                {answerKeyControl(newQuestion, updateNewQuestion)}
              </div>
            </div>
          </form>
        )}
        {confirm && (
          <div className="mb-4 rounded border border-slate-300 bg-white p-4">
            <h3 className="font-semibold">Publish Confirmation</h3>
            <div className="mt-2 grid gap-2 text-sm md:grid-cols-2">
              <p>Title: {confirm.title}</p>
              <p>Type: {confirm.assessmentType}</p>
              <p>Questions: {confirm.numberOfQuestions}</p>
              <p>Subject: {review.subject}</p>
              <p>Due Date: {confirm.dueDate ? new Date(confirm.dueDate).toLocaleDateString() : "None"}</p>
            </div>
            <button className="mt-3 rounded bg-slate-900 px-3 py-2 text-sm text-white" disabled={publishing} onClick={publish} type="button">{publishing ? "Publishing…" : "Confirm Publish"}</button>
          </div>
        )}
        <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 md:grid-cols-2">
          <input className="field" value={review.title} onKeyDown={keepTextEntryLocal} onChange={(e) => saveAssessment("title", e.target.value)} placeholder="Assessment title" />
          <select className="field" value={review.subjectRef?._id || review.subjectRef || ""} onChange={(e) => saveAssessment("subjectRef", e.target.value)}>
            {(subjects.data || []).map((subject) => <option key={subject._id} value={subject._id}>{subject.name}</option>)}
          </select>
          <input className="field" type="date" value={review.dueDate?.slice(0, 10) || ""} onChange={(e) => saveAssessment("dueDate", e.target.value)} />
          <textarea className="field md:col-span-2" rows="3" value={review.instructions || ""} onKeyDown={keepTextEntryLocal} onChange={(e) => saveAssessment("instructions", e.target.value)} />
          <input className="field" min="1" type="number" value={review.durationMinutes || 30} onChange={(e) => saveAssessment("durationMinutes", Number(e.target.value))} />
          <select className="field" value={review.attemptLimit ?? 1} onChange={(e) => saveAssessment("attemptLimit", Number(e.target.value))}>
            <option value="1">One Attempt</option>
            <option value="2">Two Attempts</option>
            <option value="3">Three Attempts</option>
            <option value="0">Unlimited</option>
          </select>
          <label className="flex items-center gap-2 rounded border px-3 py-2 text-sm">
            <input checked={!!review.lockPreviousQuestions} onChange={(e) => saveAssessment("lockPreviousQuestions", e.target.checked)} type="checkbox" />
            Lock Previous Questions
          </label>
          <label className="flex items-center gap-2 rounded border px-3 py-2 text-sm">
            <input checked={review.randomizeQuestions !== false} onChange={(e) => saveAssessment("randomizeQuestions", e.target.checked)} type="checkbox" />
            Randomize Questions
          </label>
          <label className="flex items-center gap-2 rounded border px-3 py-2 text-sm">
            <input checked={review.randomizeChoices !== false} onChange={(e) => saveAssessment("randomizeChoices", e.target.checked)} type="checkbox" />
            Randomize Choices
          </label>
        </div>
        <div className="mt-4 space-y-3">
          {review.questions.map((question, index) => {
            const draft = draftFor(question);
            return (
              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm" key={question._id}>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#D94F00]">Question {index + 1}</p>
                    <p className="text-sm text-slate-500">{draft.points || 1} point(s)</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                  <button className="rounded border px-2 py-1 text-xs" onClick={() => moveQuestion(index, -1)} type="button">Up</button>
                  <button className="rounded border px-2 py-1 text-xs" onClick={() => moveQuestion(index, 1)} type="button">Down</button>
                  <button className="rounded border px-2 py-1 text-xs" onClick={() => duplicateQuestion(question._id)} type="button">Duplicate</button>
                  <button className="rounded border px-2 py-1 text-xs" disabled={regeneratingId === question._id || draft.type !== "multiple_choice"} onClick={() => regenerateQuestion(question._id)} type="button">
                    {regeneratingId === question._id ? "Regenerating..." : "Regenerate Question"}
                  </button>
                  <button className="rounded border px-2 py-1 text-xs" onClick={() => saveQuestion(question)} type="button">Save</button>
                  <button className="rounded border px-2 py-1 text-xs" onClick={() => deleteQuestion(question._id)} type="button">Delete</button>
                  </div>
                </div>
                <div className="grid gap-2 md:grid-cols-4">
                  <select className="field" value={draft.type} onChange={(e) => updateQuestionDraft(question, { type: e.target.value })}>
                    <option value="multiple_choice">Multiple Choice</option>
                    <option value="true_false">True/False</option>
                    <option value="identification">Identification</option>
                    <option value="essay">Essay</option>
                    <option value="coding">Coding</option>
                  </select>
                  <input className="field" min="1" type="number" value={draft.points || 1} onChange={(e) => updateQuestionDraft(question, { points: Number(e.target.value) })} />
                  <textarea className="field md:col-span-4" rows="2" value={draft.text} onKeyDown={keepTextEntryLocal} onChange={(e) => updateQuestionDraft(question, { text: e.target.value })} placeholder="Question text" />
                  <div className="md:col-span-4">
                    {answerKeyControl(draft, (patch) => updateQuestionDraft(question, patch))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Panel>
      </div>
    );
  }

  return (
    <div className="space-y-6">
    <PageHeader
      eyebrow="Assessments"
      title="Assessment Management"
      description="Create drafts, review AI-generated assessments, publish work, and inspect submissions."
      actions={<StatusBadge value="AI Assisted" icon={<Sparkles size={13} />} />}
    />
    <Panel title="Create Assessment Draft" eyebrow="Manual setup">
      {deleteCandidate && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4" role="dialog" aria-modal="true" aria-labelledby="delete-assessment-title">
        <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
          <h2 className="text-lg font-black text-slate-950" id="delete-assessment-title">Delete Assessment</h2>
          <p className="mt-3 text-sm text-slate-600">Are you sure you want to delete this assessment?</p>
          <p className="mt-1 text-sm font-semibold text-slate-900">{deleteCandidate.title}</p>
          <div className="mt-6 flex justify-end gap-2">
            <button className="btn-neutral px-4 py-2 text-sm" disabled={!!deletingId} onClick={() => setDeleteCandidate(null)} type="button">Cancel</button>
            <button className="rounded bg-red-700 px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60" disabled={!!deletingId} onClick={deleteAssessment} type="button">{deletingId ? "Deleting..." : "Delete"}</button>
          </div>
        </div>
      </div>}
      <form className="mb-4 grid gap-3 md:grid-cols-3" onSubmit={create}>
        <input className="field" placeholder="Title" value={form.title} onKeyDown={keepTextEntryLocal} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
        <select className="field" value={form.assessmentType} onChange={(e) => setForm({ ...form, assessmentType: e.target.value })}>
          <option value="quiz">Quiz</option>
          <option value="seatwork">Seatwork</option>
          <option value="assignment">Assignment</option>
          <option value="exam">Exam</option>
          <option value="activity">Activity</option>
          <option value="programming">Programming</option>
        </select>
        <select className="field" value={form.subjectRef} onChange={(e) => setForm({ ...form, subjectRef: e.target.value })} required>
          <option value="">Select existing subject</option>
          {(subjects.data || []).map((subject) => <option key={subject._id} value={subject._id}>{subject.name}</option>)}
        </select>
        <label className="label">Submission Date<input className="field" type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} required /></label>
        <input className="field" min="1" type="number" value={form.durationMinutes} onChange={(e) => setForm({ ...form, durationMinutes: Number(e.target.value) })} />
        <select className="field" value={form.attemptLimit} onChange={(e) => setForm({ ...form, attemptLimit: Number(e.target.value) })}>
          <option value="1">One Attempt</option>
          <option value="2">Two Attempts</option>
          <option value="3">Three Attempts</option>
          <option value="0">Unlimited</option>
        </select>
        <label className="flex items-center gap-2 rounded border px-3 py-2 text-sm">
          <input checked={form.lockPreviousQuestions} onChange={(e) => setForm({ ...form, lockPreviousQuestions: e.target.checked })} type="checkbox" />
          Lock Previous
        </label>
        <label className="flex items-center gap-2 rounded border px-3 py-2 text-sm">
          <input checked={form.randomizeQuestions} onChange={(e) => setForm({ ...form, randomizeQuestions: e.target.checked })} type="checkbox" />
          Randomize Questions
        </label>
        <label className="flex items-center gap-2 rounded border px-3 py-2 text-sm">
          <input checked={form.randomizeChoices} onChange={(e) => setForm({ ...form, randomizeChoices: e.target.checked })} type="checkbox" />
          Randomize Choices
        </label>
        <button className="btn-primary px-3 py-2" type="submit">Create Draft</button>
      </form>
      {message && <p className={`mb-4 rounded border p-2 text-sm ${message === "Assessment created successfully." ? "border-green-200 bg-green-50 text-green-800" : "border-slate-200 bg-slate-100"}`} role="status">{message}</p>}
      <div className="mb-4 flex flex-wrap gap-2">
        {[ ["all", "All"], ["published", "Published"], ["draft", "Drafts"], ["ai_review", "AI Review"] ].map(([value, label]) => <button className={`rounded-lg border px-3 py-2 text-sm font-bold ${assessmentFilter === value ? "border-[#FF6B00] bg-[#FFF3E8] text-[#D94F00]" : "border-slate-200 text-slate-600"}`} key={value} onClick={() => { setPage(1); setAssessmentFilter(value); }} type="button">{label}</button>)}
      </div>
      <select className="field mb-4 max-w-sm" value={subjectFilter} onChange={(e) => { setPage(1); setSubjectFilter(e.target.value); }}>
        <option value="">All subjects</option>
        {(subjects.data || []).map((subject) => <option key={subject._id} value={subject._id}>{subject.name}</option>)}
      </select>
      {assessments.loading ? <LoadingState label="Loading assessments" /> : assessments.error ? <LoadingState error={assessments.error} /> : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {visibleAssessments.map((row) => {
          const isAiGenerated = Boolean(row.generationId || row.originalAiVersion);
          return <article className="premium-card p-5" key={row._id}>
            <div className="flex items-start justify-between gap-3"><div><h3 className="font-black text-slate-950">{row.title}</h3><p className="mt-1 text-sm text-slate-500">{row.subject}</p></div><StatusBadge value={row.status} /></div>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-slate-500">Source</dt><dd className="font-semibold">{isAiGenerated ? "AI Generated" : "Manual"}</dd></div><div><dt className="text-slate-500">Questions</dt><dd className="font-semibold">{row.questions?.length || 0}</dd></div><div><dt className="text-slate-500">Created</dt><dd className="font-semibold">{row.createdAt ? new Date(row.createdAt).toLocaleDateString() : "None"}</dd></div><div><dt className="text-slate-500">Due</dt><dd className="font-semibold">{row.dueDate ? new Date(row.dueDate).toLocaleDateString() : "None"}</dd></div></dl>
            <div className="mt-5 flex flex-wrap gap-2"><button className="btn-secondary min-h-0 px-2 py-1 text-xs" onClick={() => openReview(row._id)} type="button">{row.status === "published" ? "View / Edit" : isAiGenerated ? "Review" : "Continue Setup"}</button><button className="btn-neutral min-h-0 px-2 py-1 text-xs" onClick={() => onViewSubmissions?.(row._id)} type="button">Submissions</button><button className="rounded border border-red-300 px-2 py-1 text-xs text-red-700 disabled:cursor-not-allowed disabled:opacity-60" disabled={!!deletingId} onClick={() => requestDelete(row)} type="button">Delete</button></div>
          </article>;
        })}
      </div>}
      {!assessments.loading && !assessments.error && !visibleAssessments.length && <p className="text-sm text-slate-500">No assessments match the selected filters.</p>}
      <div className="mt-4 flex items-center gap-3">
        <button className="btn-neutral" disabled={page === 1 || assessments.loading} onClick={() => setPage((value) => value - 1)} type="button">Previous</button>
        <span className="text-sm text-slate-600">Page {page}</span>
        <button className="btn-neutral" disabled={!assessments.data?.hasMore || assessments.loading} onClick={() => setPage((value) => value + 1)} type="button">Next</button>
      </div>
    </Panel>
    </div>
  );
}
