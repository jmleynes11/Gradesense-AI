import LoadingState from "../../components/LoadingState";
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, MoreHorizontal, Plus } from "lucide-react";
import PageHeader from "../../components/PageHeader";
import Panel from "../../components/Panel";
import SimpleTable from "../../components/SimpleTable";
import { useAsyncData } from "../../hooks/useAsyncData";
import { api } from "../../services/api";
import { assessmentStudentName as studentName } from "../../services/assessmentStudentName";
import { subjectSubmissionProgress } from "../../services/subjectSubmissionProgress";

const blankSubject = { name: "", code: "", description: "", academicYear: "" };

function compareStudentNames(left, right) {
  const [leftLastName, leftFirstName = ""] = studentName(left).split(", ");
  const [rightLastName, rightFirstName = ""] = studentName(right).split(", ");
  return leftLastName.localeCompare(rightLastName, "en", { sensitivity: "base" })
    || leftFirstName.localeCompare(rightFirstName, "en", { sensitivity: "base" });
}

function SubjectDetails({ subjectId, onBack, onNavigate, onCreateAssessment, onViewSubmissions }) {
  const details = useAsyncData(() => api.subjectDetails(subjectId), [subjectId]);
  const existingStudents = useAsyncData(api.teacherStudents, []);
  const [tab, setTab] = useState("Overview");
  const [studentId, setStudentId] = useState("");
  const [studentSearch, setStudentSearch] = useState("");
  const [studentDropdownOpen, setStudentDropdownOpen] = useState(false);
  const [assignmentMessage, setAssignmentMessage] = useState("");
  useEffect(() => {
    if (tab !== "Assessments") return undefined;
    let active = true;
    let refreshing = false;
    async function refreshSubmissionProgress() {
      if (refreshing) return;
      refreshing = true;
      try {
        const data = await api.subjectDetails(subjectId);
        if (active) details.setData(data);
      } catch {
        // Keep the last successful counts and retry on focus or the next interval.
      } finally {
        refreshing = false;
      }
    }
    void refreshSubmissionProgress();
    const timer = window.setInterval(refreshSubmissionProgress, 10000);
    window.addEventListener("focus", refreshSubmissionProgress);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshSubmissionProgress);
    };
  }, [subjectId, tab, details.setData]);
  if (details.loading) return <LoadingState label="Loading subject" />;
  if (details.error) return <p className="text-sm text-red-700">{details.error}</p>;
  const data = details.data;
  if (!data) return null;
  const { subject, summary } = data;
  const assignedStudentIds = new Set(data.directStudentIds || []);
  const availableStudents = (existingStudents.data || []).filter((student) => !assignedStudentIds.has(student._id)).sort(compareStudentNames);
  const filteredStudents = availableStudents.filter((student) => `${studentName(student)} ${student.name || ""} ${student.studentNumber || ""} ${student.email || ""}`.toLowerCase().includes(studentSearch.trim().toLowerCase()));
  const selectedStudent = (existingStudents.data || []).find((student) => student._id === studentId);
  const directlyAssignedStudents = (data.students || []).filter((student) => assignedStudentIds.has(student._id)).sort(compareStudentNames);
  async function refreshDetails() { details.setData(await api.subjectDetails(subjectId)); }
  async function assignStudent(event) { event.preventDefault(); try { await api.addStudentToSubject(subjectId, studentId); setStudentId(""); setStudentSearch(""); setAssignmentMessage("Student assigned to subject."); await refreshDetails(); } catch (error) { setAssignmentMessage(error.message); } }
  async function removeStudent(student) { try { await api.removeStudentFromSubject(subjectId, student._id); setAssignmentMessage("Student removed from direct subject assignment."); await refreshDetails(); } catch (error) { setAssignmentMessage(error.message); } }
  const tabs = ["Overview", "Students", "Assessments", "Reports"];
  return <div className="space-y-6">
    <PageHeader title={subject.name} description={subject.code} eyebrow="Subject details" actions={<><button className="btn-neutral px-4 py-2" onClick={onBack} type="button">Back to Subjects</button><button className="btn-primary px-4 py-2" onClick={() => onNavigate("AI Quiz Generator")} type="button">Generate AI Quiz</button></>} />
    <div className="flex gap-2 overflow-x-auto border-b border-slate-200 pb-2">{tabs.map((item) => <button className={`shrink-0 rounded-lg px-3 py-2 text-sm font-bold ${tab === item ? "bg-[#FFF3E8] text-[#D94F00]" : "text-slate-600"}`} key={item} onClick={() => setTab(item)} type="button">{item}</button>)}</div>
    {tab === "Overview" && <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{[["Students", summary.studentCount], ["Assessments", summary.assessmentCount], ["Average Performance", summary.averageScore == null ? "Not available" : `${summary.averageScore}%`]].map(([label, value]) => <div className="premium-card p-5" key={label}><p className="text-sm text-slate-500">{label}</p><p className="mt-2 text-2xl font-black text-slate-950">{value}</p></div>)}</div>
      <Panel title="Recent Assessments" actions={<button className="btn-secondary px-3 py-2 text-sm" onClick={() => onNavigate("Assessments")} type="button">Open Assessments</button>}><div className="space-y-2">{data.assessments.slice(0, 5).map((item) => <div className="flex flex-wrap justify-between gap-2 border-b border-slate-100 py-2 text-sm" key={item._id}><span className="font-bold text-slate-900">{item.title}</span><span className="text-slate-500">{item.assessmentType}</span></div>)}{!data.assessments.length && <p className="text-sm text-slate-500">No assessments associated with this subject.</p>}</div></Panel>
    </>}
    {tab === "Students" && <>
      <Panel title="Assign Existing Student">
        <form className="grid gap-3 md:grid-cols-3" onSubmit={assignStudent}>
          <div className="relative">
            <button aria-expanded={studentDropdownOpen} className="field flex w-full items-center justify-between text-left" onClick={() => setStudentDropdownOpen((open) => !open)} type="button">
              <span className={selectedStudent ? "text-slate-900" : "text-slate-500"}>{selectedStudent ? `${studentName(selectedStudent)} (${selectedStudent.studentNumber || selectedStudent.email})` : "Select registered student"}</span>
              <ChevronDown size={16} />
            </button>
            {studentDropdownOpen && <div className="absolute z-20 mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
              <div className="relative mb-2"><input autoFocus className="field py-2" onChange={(event) => setStudentSearch(event.target.value)} placeholder="Search name, number, or email" value={studentSearch} /></div>
              <div className="max-h-48 overflow-y-auto">
                {filteredStudents.map((student) => <button className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-slate-50" key={student._id} onClick={() => { setStudentId(student._id); setStudentDropdownOpen(false); setStudentSearch(""); }} type="button"><span className="font-medium">{studentName(student)}</span><span className="block text-xs text-slate-500">{student.studentNumber || "No student number"} · {student.email}</span></button>)}
                {!filteredStudents.length && <p className="px-3 py-2 text-sm text-slate-500">No matching registered students.</p>}
              </div>
            </div>}
          </div>
          <button className="btn-primary px-3 py-2" disabled={!studentId} type="submit">Assign Student</button>
        </form>
        {assignmentMessage && <p className="mt-3 text-sm text-slate-600">{assignmentMessage}</p>}
      </Panel>
      <Panel title="Students"><div className="[&_table]:table-fixed [&_td]:break-words"><SimpleTable columns={[{ key: "name", label: "Student", render: studentName }, { key: "email", label: "Email" }, { key: "averageScore", label: "Average Score", render: (row) => row.averageScore == null ? "Not available" : `${row.averageScore}%` }, { key: "studentNumber", label: "Student Number" }, { key: "action", label: "Action", render: (row) => <button className="rounded border px-2 py-1 text-xs" onClick={() => removeStudent(row)} type="button">Remove</button> }]} rows={directlyAssignedStudents} /></div></Panel>
    </>}
    {tab === "Assessments" && <Panel title="Subject Assessments" actions={<button className="btn-primary px-3 py-2 text-sm" onClick={() => onCreateAssessment(subjectId)} type="button">Create Assessment</button>}><SimpleTable columns={[{ key: "title", label: "Assessment" }, { key: "assessmentType", label: "Type" }, { key: "subject", label: "Subject" }, { key: "dueDate", label: "Due Date", render: (row) => row.dueDate ? new Date(row.dueDate).toLocaleDateString() : "None" }, { key: "status", label: "Status" }, { key: "submissions", label: "Submissions", render: (row) => subjectSubmissionProgress(row._id, data.students, data.submissions) }, { key: "action", label: "Submitted Quizzes", render: (row) => <button className="btn-neutral min-h-0 px-2 py-1 text-xs" onClick={() => onViewSubmissions(row._id)} type="button">View Submissions</button> }]} rows={data.assessments} /></Panel>}
    {tab === "Reports" && <Panel title="Subject Reports" actions={<button className="btn-secondary px-3 py-2 text-sm" onClick={() => onNavigate("Analytics")} type="button">Open Analytics</button>}><p className="text-sm text-slate-600">Average performance is based on graded submissions associated with this subject.</p>{summary.averageScore != null && <p className="mt-3 text-2xl font-black text-slate-950">{summary.averageScore}%</p>}</Panel>}
  </div>;
}

export default function Subjects({ onNavigate, onCreateAssessment, onViewSubmissions }) {
  const subjects = useAsyncData(api.subjectDashboard, []);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(null);
  const [selected, setSelected] = useState("");
  const [menu, setMenu] = useState("");
  const [message, setMessage] = useState("");
  const rows = useMemo(() => (subjects.data || []).filter((item) => `${item.name} ${item.code || ""}`.toLowerCase().includes(query.toLowerCase())), [subjects.data, query]);
  async function save(event) { event.preventDefault(); try { const saved = editing._id ? await api.updateDashboardSubject(editing._id, editing) : await api.createDashboardSubject(editing); subjects.setData(editing._id ? (subjects.data || []).map((item) => item._id === saved._id ? { ...item, ...saved } : item) : [...(subjects.data || []), saved]); setEditing(null); setMessage(`Subject ${editing._id ? "updated" : "created"}.`); } catch (error) { setMessage(error.message); } }
  async function remove(id) { if (!window.confirm("Delete this subject? This cannot be undone.")) return; try { await api.deleteDashboardSubject(id); subjects.setData((subjects.data || []).filter((item) => item._id !== id)); setMessage("Subject deleted."); } catch (error) { setMessage(error.message); } }
  async function archive(id) { if (!window.confirm("Archive this subject?")) return; try { await api.archiveDashboardSubject(id); subjects.setData((subjects.data || []).filter((item) => item._id !== id)); setMessage("Subject archived."); } catch (error) { setMessage(error.message); } }
  if (selected) return <SubjectDetails subjectId={selected} onBack={() => setSelected("")} onNavigate={onNavigate} onCreateAssessment={onCreateAssessment} onViewSubmissions={onViewSubmissions} />;
  if (subjects.loading || subjects.error) return <LoadingState label="Loading subjects" error={subjects.error} />;
  return <div className="space-y-6"><PageHeader title="Subjects" description="Manage your subjects, classes, and learning activities." actions={<button className="btn-primary flex items-center gap-2 px-4 py-2" onClick={() => setEditing({ ...blankSubject })} type="button"><Plus size={17} />Create Subject</button>} />
    {message && <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">{message}</p>}
    {editing && <Panel title={editing._id ? "Edit Subject" : "Create Subject"}><form className="grid gap-3 md:grid-cols-2" onSubmit={save}><label className="label">Subject Name *<input className="field" required value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} /></label><label className="label">Subject Code *<input className="field" required value={editing.code || ""} onChange={(event) => setEditing({ ...editing, code: event.target.value.toUpperCase() })} /></label><label className="label md:col-span-2">Description<textarea className="field" rows="3" value={editing.description || ""} onChange={(event) => setEditing({ ...editing, description: event.target.value })} /></label><label className="label">Academic Year<input className="field" value={editing.academicYear || ""} onChange={(event) => setEditing({ ...editing, academicYear: event.target.value })} /></label><div className="flex items-end gap-2"><button className="btn-primary px-4 py-2" type="submit">Save Subject</button><button className="btn-neutral px-4 py-2" onClick={() => setEditing(null)} type="button">Cancel</button></div></form></Panel>}
    <div className="relative max-w-md"><input className="field pl-10" placeholder="Search Subjects" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{rows.map((subject) => <article className="premium-card p-5" key={subject._id}><div className="flex items-start justify-between gap-3"><div><h2 className="text-lg font-bold text-slate-950">{subject.name}</h2><p className="mt-1 text-sm font-semibold text-[#D94F00]">{subject.code || "No code"}</p></div><div className="relative"><button className="grid h-9 w-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100" onClick={() => setMenu(menu === subject._id ? "" : subject._id)} type="button" aria-label="Subject actions"><MoreHorizontal size={20} /></button>{menu === subject._id && <div className="absolute right-0 z-10 w-36 rounded-lg border border-slate-200 bg-white p-1 shadow-lg"><button className="w-full rounded px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => { setEditing({ ...subject }); setMenu(""); }} type="button">Edit Subject</button><button className="w-full rounded px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => archive(subject._id)} type="button">Archive Subject</button><button className="w-full rounded px-3 py-2 text-left text-sm text-red-700 hover:bg-red-50" onClick={() => remove(subject._id)} type="button">Delete Subject</button></div>}</div></div><div className="mt-6 grid grid-cols-3 gap-2 text-center text-sm"><div><p className="font-black text-slate-950">{subject.classCount || 0}</p><p className="text-slate-500">Classes</p></div><div><p className="font-black text-slate-950">{subject.studentCount || 0}</p><p className="text-slate-500">Students</p></div><div><p className="font-black text-slate-950">{subject.assessmentCount || 0}</p><p className="text-slate-500">Assessments</p></div></div><button className="btn-secondary mt-6 w-full px-4 py-2" onClick={() => setSelected(subject._id)} type="button">View Subject</button></article>)}{!rows.length && <Panel className="md:col-span-2 xl:col-span-3" title="No subjects found"><p className="text-sm text-slate-500">Create a subject before assigning it to a class.</p></Panel>}</div>
  </div>;
}
