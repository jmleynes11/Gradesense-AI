import LoadingState from "../../components/LoadingState";
import { useRef, useState } from "react";
import Panel from "../../components/Panel";
import { api } from "../../services/api";
import { useAsyncData } from "../../hooks/useAsyncData";
import PageHeader from "../../components/PageHeader";
import StatusBadge from "../../components/StatusBadge";
import { Bot, CheckCircle2, FileText, Loader2, Sparkles, Trash2, UploadCloud } from "lucide-react";

export default function AIGenerator() {
  const subjects = useAsyncData(api.subjectDashboard, []);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [lessonFile, setLessonFile] = useState(null);
  const fileInputRef = useRef(null);
  const submittingRef = useRef(false);
  const [form, setForm] = useState({
    title: "",
    assessmentType: "quiz",
    subjectRef: "",
    dueDate: "",
    instructions: "Answer all questions using the uploaded lesson material.",
    teacherPrompt: "",
    durationMinutes: 30,
    attemptLimit: 1,
    lockPreviousQuestions: false,
    randomizeQuestions: true,
    randomizeChoices: true,
    multipleChoiceCount: 10,
    trueFalseCount: 10,
    identificationCount: 5,
    essayCount: 3
  });

  function update(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    setError("");
    setResult(null);
    setLoading(true);
    try {
      const body = new FormData();
      Object.entries(form).forEach(([key, value]) => body.append(key, value));
      body.append("generationNonce", globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`);
      if (lessonFile) body.append("lessonFile", lessonFile);
      const data = await api.generateQuiz(body);
      setResult(data);
    } catch (err) {
      console.error("AI assessment generation failed:", err);
      setError(err.message);
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  }

  function formatSize(bytes = 0) {
    if (!bytes) return "";
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function fileType(file) {
    const extension = file?.name?.split(".").pop()?.toUpperCase() || "FILE";
    return extension;
  }

  function removeFile() {
    setLessonFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  if (subjects.loading || subjects.error) return <LoadingState label="Loading subjects" error={subjects.error} />;
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="AI Workspace"
        title="AI Quiz Generator"
        description="Create assessments from your learning materials in seconds."
        actions={<StatusBadge value="AI Assisted" icon={<Sparkles size={13} />} />}
      />

      <form className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]" onSubmit={submit}>
        <Panel title="Content Input" eyebrow="Lesson source">
          <div className="space-y-4">
            <label className="grid cursor-pointer place-items-center rounded-lg border-2 border-dashed border-[#FFE4CC] bg-[#FFF3E8] px-6 py-10 text-center transition hover:border-[#FF6B00]">
              <UploadCloud className="mb-3 text-[#FF6B00]" size={34} />
              <span className="text-base font-black text-slate-950">Drop your lesson materials here</span>
              <span className="mt-1 text-sm text-slate-500">PDF, DOCX, PPTX, or TXT</span>
              <input ref={fileInputRef} className="sr-only" name="lessonFile" type="file" accept=".pdf,.docx,.pptx,.txt" onChange={(event) => setLessonFile(event.target.files?.[0] || null)} />
            </label>
            {lessonFile && (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-4">
                <div className="flex items-center gap-3">
                  <div className="grid h-12 w-12 place-items-center rounded-lg bg-[#FFF3E8] text-[#D94F00]">
                    <FileText size={24} />
                  </div>
                  <div>
                    <p className="font-black text-slate-950">{lessonFile.name}</p>
                    <p className="text-sm text-slate-500">{fileType(lessonFile)}{lessonFile.size ? ` - ${formatSize(lessonFile.size)}` : ""}</p>
                    <p className="mt-1 text-sm font-bold text-green-700">Uploaded Successfully</p>
                  </div>
                </div>
                <button className="btn-neutral flex items-center gap-2 px-3 py-2 text-sm" onClick={removeFile} type="button">
                  <Trash2 size={16} />
                  Remove
                </button>
              </div>
            )}
            <label className="label">
              Custom Quiz Generation Prompt
              <textarea className="field min-h-56" rows="8" placeholder="Describe what kind of quiz you want to generate. Example: Create 10 multiple-choice questions about the uploaded lesson." value={form.teacherPrompt} onChange={(e) => update("teacherPrompt", e.target.value)} />
            </label>
          </div>
        </Panel>

        <Panel title="Assessment Settings" eyebrow="Generation controls">
          <div className="grid gap-4">
            <label className="label">Assessment Title<input className="field" required value={form.title} onChange={(e) => update("title", e.target.value)} /></label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="label">Type<select className="field" required value={form.assessmentType} onChange={(e) => update("assessmentType", e.target.value)}>
                <option value="quiz">Quiz</option>
                <option value="seatwork">Seatwork</option>
                <option value="assignment">Assignment</option>
                <option value="exam">Exam</option>
                <option value="activity">Activity</option>
              </select></label>
            </div>
            <label className="label">Subject<select className="field" required value={form.subjectRef} onChange={(e) => setForm((current) => ({ ...current, subjectRef: e.target.value }))}>
              <option value="">Select existing subject</option>
              {(subjects.data || []).map((subject) => <option key={subject._id} value={subject._id}>{subject.name}</option>)}
            </select></label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="label">Due Date<input className="field" required type="date" value={form.dueDate} onChange={(e) => update("dueDate", e.target.value)} /></label>
              <label className="label">Duration<input className="field" min="1" type="number" value={form.durationMinutes} onChange={(e) => update("durationMinutes", e.target.value)} /></label>
            </div>
            <label className="label">Attempt Limit<select className="field" value={form.attemptLimit} onChange={(e) => update("attemptLimit", e.target.value)}>
              <option value="1">One Attempt</option>
              <option value="2">Two Attempts</option>
              <option value="3">Three Attempts</option>
              <option value="0">Unlimited</option>
            </select></label>
            <div className="grid grid-cols-4 gap-2">
              {[["MC", "multipleChoiceCount"], ["TF", "trueFalseCount"], ["ID", "identificationCount"], ["Essay", "essayCount"]].map(([label, key]) => (
                <label className="label text-xs" key={key}>{label}<input className="field px-2" min="0" type="number" value={form[key]} onChange={(e) => update(key, e.target.value)} /></label>
              ))}
            </div>
            <div className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
              {[
                ["Lock Previous Questions", "lockPreviousQuestions"],
                ["Randomize Questions", "randomizeQuestions"],
                ["Randomize Choices", "randomizeChoices"]
              ].map(([label, key]) => (
                <label className="flex items-center gap-2 font-semibold text-slate-700" key={key}>
                  <input checked={form[key]} onChange={(e) => update(key, e.target.checked)} type="checkbox" />
                  {label}
                </label>
              ))}
            </div>
            {error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
            <button aria-busy={loading} className="btn-primary flex items-center justify-center gap-2 px-4 py-3" disabled={loading} type="submit">
              {loading ? <Loader2 className="animate-spin" size={18} /> : <Sparkles size={18} />}
              {loading ? "Generating Quiz..." : "Generate Assessment"}
            </button>
          </div>
        </Panel>
      </form>
      {loading && (
        <Panel title="AI Generation Progress" eyebrow="Processing">
          <div className="grid gap-3 md:grid-cols-5">
            {["Analyzing lesson", "Identifying key concepts", "Generating questions", "Validating answer choices", "Preparing assessment"].map((step, index) => (
              <div className="rounded-lg border border-slate-200 p-4" key={step}>
                <div className={`mb-3 grid h-9 w-9 place-items-center rounded-full ${index < 2 ? "bg-green-50 text-green-700" : index === 2 ? "bg-[#FFF3E8] text-[#FF6B00] ai-pulse" : "bg-slate-100 text-slate-400"}`}>
                  {index < 2 ? <CheckCircle2 size={18} /> : index === 2 ? <Bot size={18} /> : index + 1}
                </div>
                <p className="text-sm font-bold text-slate-800">{step}</p>
              </div>
            ))}
          </div>
        </Panel>
      )}
      {result && (
        <div className="space-y-4">
          <div className="premium-card-elevated p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#D94F00]">Assessment Ready</p>
                <h2 className="mt-1 text-2xl font-black text-slate-950">{result.assessment.title}</h2>
                <p className="mt-1 text-sm text-slate-600">Draft saved for teacher review. Open Assessment Management to edit and publish.</p>
              </div>
              <StatusBadge value="AI Generated" icon={<Sparkles size={13} />} />
            </div>
            <div className="mt-5 grid gap-3 md:grid-cols-3">
              <div className="rounded-lg border border-slate-200 p-3"><p className="text-sm text-slate-500">Questions</p><p className="text-xl font-black">{result.questions.length}</p></div>
              <div className="rounded-lg border border-slate-200 p-3"><p className="text-sm text-slate-500">Subject</p><p className="text-xl font-black">{result.assessment.subject}</p></div>
            </div>
          </div>
          <Panel title="Lesson Summary" eyebrow="AI Review">
            <p className="mt-1 text-sm text-slate-700">{result.review.lessonSummary}</p>
          </Panel>
          <Panel title="AI Quality Check" eyebrow="Validation">
            <div className="grid gap-3 text-sm md:grid-cols-5">
              {["Lesson grounded", "No duplicate questions", "One correct answer", "Choices validated"].map((item) => (
                <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-3 font-semibold text-green-800" key={item}>
                  <CheckCircle2 size={16} />
                  {item}
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="Topics Identified" eyebrow="Extracted concepts">
            <p className="mt-1 text-sm text-slate-700">{(result.review.topicsIdentified || []).join(", ")}</p>
          </Panel>
          {!!result.review.validationIssues?.length && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <h3 className="font-semibold text-amber-800">Generation Validation</h3>
              <ul className="mt-1 list-disc pl-5 text-sm text-amber-800">
                {result.review.validationIssues.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
