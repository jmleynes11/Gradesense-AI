import LoadingState from "../../components/LoadingState";
import { useEffect, useMemo, useState } from "react";
import PageHeader from "../../components/PageHeader";
import Panel from "../../components/Panel";
import SimpleTable from "../../components/SimpleTable";
import { useAsyncData } from "../../hooks/useAsyncData";
import { api } from "../../services/api";
import StudentAssessments from "./StudentAssessments";
import { subjectGradeDisplay } from "../../services/subjectGradeDisplay";
import AssessmentResults from "./AssessmentResults";
import { studentAssessmentSubmission } from "../../services/studentAssessmentSubmission";

function StudentSubjectDetails({ subjectId, onBack, onNavigate }) {
  const details = useAsyncData(() => api.subjectDetails(subjectId), [subjectId]);
  const [tab, setTab] = useState("Overview");
  const [takingAssessmentId, setTakingAssessmentId] = useState("");
  const [assessmentResultId, setAssessmentResultId] = useState("");
  const [assessmentResult, setAssessmentResult] = useState(null);
  useEffect(() => {
    if (tab !== "Assessments" || takingAssessmentId || assessmentResultId) return undefined;
    let active = true;
    let refreshing = false;
    async function refreshAssessmentStatuses() {
      if (refreshing) return;
      refreshing = true;
      try {
        const latest = await api.subjectDetails(subjectId);
        if (active) details.setData(latest);
      } catch {
        // Retain the last successful database read and retry on focus or the next interval.
      } finally {
        refreshing = false;
      }
    }
    void refreshAssessmentStatuses();
    const timer = window.setInterval(refreshAssessmentStatuses, 30000);
    window.addEventListener("focus", refreshAssessmentStatuses);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshAssessmentStatuses);
    };
  }, [subjectId, tab, takingAssessmentId, assessmentResultId, details.setData]);
  useEffect(() => {
    if (tab !== "Grades" || takingAssessmentId) return undefined;
    let active = true;
    async function refreshGrades() {
      try {
        const data = await api.subjectDetails(subjectId);
        if (active) details.setData(data);
      } catch {
        // Retain the last successful read and retry on focus or the next interval.
      }
    }
    refreshGrades();
    const timer = window.setInterval(refreshGrades, 30000);
    window.addEventListener("focus", refreshGrades);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshGrades);
    };
  }, [subjectId, tab, takingAssessmentId, details.setData]);
  if (details.loading) return <LoadingState label="Loading subject" />;
  if (details.error) return <p className="text-sm text-red-700">{details.error}</p>;
  const data = details.data;
  if (!data) return null;
  const { subject, summary } = data;
  const tabs = ["Overview", "Assessments", "Grades", "Feedback", "Quiz Games"];
  const graded = data.submissions.filter((item) => item.status === "graded");
  const subjectGrades = data.submissions.filter((item) => ["submitted", "graded"].includes(item.status)).map((item) => ({
    ...item,
    gradeDisplay: subjectGradeDisplay(item, data.assessments.find((assessment) => String(assessment._id) === String(item.assessment))),
  }));
  const upcoming = data.assessments.filter((item) => item.dueDate && new Date(item.dueDate) >= new Date());
  const assessmentRows = data.assessments.map((assessment) => ({ ...assessment, ...studentAssessmentSubmission(assessment, data.submissions) }));
  function recordAssessmentSubmission(assessmentId, submission) {
    const saved = { ...submission, assessment: assessmentId };
    details.setData((current) => current ? { ...current, submissions: [saved, ...current.submissions.filter((item) => String(item.assessment?._id || item.assessment) !== String(assessmentId))] } : current);
    setTakingAssessmentId("");
    setAssessmentResult(submission);
    setAssessmentResultId(submission._id);
  }
  if (assessmentResultId) return <AssessmentResults submissionId={assessmentResultId} initialSubmission={assessmentResult?._id === assessmentResultId ? assessmentResult : null} onBack={() => { setAssessmentResultId(""); setAssessmentResult(null); }} />;
  if (takingAssessmentId) return <StudentAssessments assessmentIds={data.assessments.map((item) => item._id)} embedded initialAssessmentId={takingAssessmentId} onSubmitted={recordAssessmentSubmission} onBack={() => setTakingAssessmentId("")} />;
  return <div className="space-y-6"><PageHeader title={subject.name} description={`${subject.code || "No subject code"} · ${subject.teacher?.name || subject.teacher?.email || "Teacher"}`} eyebrow="My subject" actions={<button className="btn-neutral px-4 py-2" onClick={onBack} type="button">Back to My Subjects</button>} />
    <div className="flex gap-2 overflow-x-auto border-b border-slate-200 pb-2">{tabs.map((item) => <button className={`shrink-0 rounded-lg px-3 py-2 text-sm font-bold ${tab === item ? "bg-[#FFF3E8] text-[#D94F00]" : "text-slate-600"}`} key={item} onClick={() => setTab(item)} type="button">{item}</button>)}</div>
    {tab === "Overview" && <><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[["Assessments", summary.assessmentCount], ["Completed", summary.completedCount], ["Average Grade", summary.averageScore == null ? "Not available" : `${summary.averageScore}%`], ["Upcoming", upcoming.length]].map(([label, value]) => <div className="premium-card p-5" key={label}><p className="text-sm text-slate-500">{label}</p><p className="mt-2 text-2xl font-black text-slate-950">{value}</p></div>)}</div><Panel title="Recent Results"><SimpleTable columns={[{ key: "assessment", label: "Assessment", render: (row) => data.assessments.find((item) => String(item._id) === String(row.assessment))?.title || "Assessment" }, { key: "percentage", label: "Score", render: (row) => `${row.percentage}%` }, { key: "status", label: "Status" }]} rows={graded.slice(0, 5)} /></Panel></>}
    {tab === "Assessments" && <Panel title="Subject Assessments" actions={<button className="btn-primary px-3 py-2 text-sm" onClick={() => onNavigate("My Assessments")} type="button">Open Assessments</button>}><SimpleTable columns={[{ key: "title", label: "Assessment" }, { key: "assessmentType", label: "Type" }, { key: "dueDate", label: "Due Date", render: (row) => row.dueDate ? new Date(row.dueDate).toLocaleDateString() : "None" }, { key: "status", label: "Status", render: (row) => row.submissionStatus }, { key: "action", label: "Action", render: (row) => <button className="btn-primary min-h-0 px-2 py-1 text-xs" disabled={row.hasSubmitted && !row.resultsAvailable} onClick={() => row.resultsAvailable ? setAssessmentResultId(row.submission._id) : !row.hasSubmitted && setTakingAssessmentId(row._id)} type="button">{row.actionLabel}</button> }]} rows={assessmentRows} /></Panel>}
    {tab === "Grades" && <Panel title="Subject Grades"><SimpleTable columns={[{ key: "assessment", label: "Assessment", render: (row) => data.assessments.find((item) => String(item._id) === String(row.assessment))?.title || "Assessment" }, { key: "score", label: "Score", render: (row) => row.gradeDisplay.score }, { key: "percentage", label: "Percentage", render: (row) => row.gradeDisplay.percentage }, { key: "submittedAt", label: "Date", render: (row) => row.gradeDisplay.date }, { key: "status", label: "Status" }]} rows={subjectGrades} /></Panel>}
    {tab === "Feedback" && <Panel title="Assessment Feedback"><div className="space-y-3">{data.feedback.map((item) => <article className="rounded-lg border border-slate-200 p-4" key={item._id}><p className="font-bold text-slate-950">{item.assessment?.title || "Assessment"}</p>{item.summary && <p className="mt-1 text-sm text-slate-600">{item.summary}</p>}</article>)}{!data.feedback.length && <p className="text-sm text-slate-500">No feedback is available for this subject.</p>}</div></Panel>}
    {tab === "Quiz Games" && <Panel title="Subject Quiz Games" actions={<button className="btn-primary px-3 py-2 text-sm" onClick={() => onNavigate("Quiz Games")} type="button">Open Quiz Games</button>}><p className="text-sm text-slate-600">Quiz games open in the existing Quiz Game interface. Its attempt restrictions and completed states are unchanged.</p></Panel>}
  </div>;
}

export default function MySubjects({ onNavigate, initialSubjectId = "" }) {
  const subjects = useAsyncData(api.subjectDashboard, []);
  const [selected, setSelected] = useState(initialSubjectId);
  const rows = useMemo(() => subjects.data || [], [subjects.data]);
  if (selected) return <StudentSubjectDetails subjectId={selected} onBack={() => setSelected("")} onNavigate={onNavigate} />;
  if (subjects.loading || subjects.error) return <LoadingState label="Loading subjects" error={subjects.error} />;
  return <div className="space-y-6"><PageHeader title="My Subjects" description="View your enrolled subjects and learning activities." />
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{rows.map((subject) => { const progress = subject.assessmentCount ? Math.round((subject.completedAssessments / subject.assessmentCount) * 100) : null; return <article className="premium-card p-5" key={subject._id}><h2 className="text-lg font-bold text-slate-950">{subject.name}</h2><p className="mt-1 text-sm font-semibold text-[#D94F00]">{subject.code || "No code"}</p><p className="mt-5 text-sm text-slate-600">Teacher: <span className="font-semibold text-slate-900">{subject.teacher?.name || subject.teacher?.email || "Not available"}</span></p><p className="mt-2 text-sm text-slate-600">{subject.assessmentCount} Assessments</p>{progress != null && <div className="mt-5"><div className="mb-1 flex justify-between text-sm text-slate-600"><span>Progress</span><span>{progress}%</span></div><div className="h-2 rounded-full bg-slate-200"><div className="h-2 rounded-full bg-[#FF6B00]" style={{ width: `${progress}%` }} /></div></div>}<button className="btn-secondary mt-6 w-full px-4 py-2" onClick={() => setSelected(subject._id)} type="button">View Subject</button></article>; })}{!rows.length && <Panel className="md:col-span-2 xl:col-span-3" title="No enrolled subjects"><p className="text-sm text-slate-500">Subjects will appear after enrollment in a class.</p></Panel>}</div>
  </div>;
}
