import LoadingState from "../../components/LoadingState";
import { api } from "../../services/api";
import { useAsyncData } from "../../hooks/useAsyncData";
import StatCard from "../../components/StatCard";
import Panel from "../../components/Panel";
import PageHeader from "../../components/PageHeader";
import StatusBadge from "../../components/StatusBadge";
import UserAvatar from "../../components/UserAvatar";
import { BarChart3, ClipboardCheck, GraduationCap, Users } from "lucide-react";
import { useAuth } from "../../context/AuthContext";

function Metric({ label, value }) {
  return <div className="rounded-lg border border-slate-200 p-4"><p className="text-sm text-slate-500">{label}</p><p className="mt-1 text-2xl font-black text-slate-950">{value === null || value === undefined ? "No data yet" : `${value}%`}</p></div>;
}

function SubmissionList({ subjects, emptyMessage }) {
  if (!subjects.length) return <p className="text-sm text-slate-500">{emptyMessage}</p>;
  return <div className="space-y-4">{subjects.map((subject, index) => (
    <div key={subject.subjectId}>
      <div className="mb-2 flex items-center justify-between gap-3 text-sm"><div className="min-w-0"><span className="mr-2 text-slate-500">{index + 1}.</span><span className="font-semibold text-slate-800">{subject.name}</span></div><span className="shrink-0 font-bold text-slate-950">{subject.submitted}/{subject.expected} turned in — {subject.percentage}%</span></div>
      <div className="h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-[#FF6B00]" style={{ width: `${Math.min(Math.max(subject.percentage, 0), 100)}%` }} /></div>
    </div>
  ))}</div>;
}

export default function TeacherDashboard({ onNavigate }) {
  const { data, loading, error } = useAsyncData(api.teacherDashboard, []);
  const { user } = useAuth();
  const fullName = user?.name?.trim();
  const risks = data?.riskCategories || {};
  const insights = data?.insights;

  if (loading || error) return <LoadingState label="Loading dashboard" error={error} />;
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Teacher Dashboard" title={fullName ? `Welcome back, ${fullName}.` : "Welcome back!"} description="Here's what's happening across your subjects today." />
      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">Unable to load dashboard data. {error}</div>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Users} label="Students" value={data?.summary?.students ?? "--"} helper="Enrolled across subjects" />
        <StatCard icon={GraduationCap} label="Active Subjects" value={data?.summary?.subjects ?? "--"} helper="Current teaching load" />
        <StatCard icon={ClipboardCheck} label="Assessments" value={data?.summary?.assessments ?? "--"} helper="Drafts and published work" tone="ai" />
        <StatCard icon={BarChart3} label="Assessment Average" value={insights ? `${insights.averageScore}%` : "No data yet"} helper="Current aggregate performance" />
      </div>

      <Panel title="Top Performing Students" eyebrow="Assessment results" actions={<button className="btn-neutral px-3 py-2 text-sm" onClick={() => onNavigate?.("Analytics")} type="button">View All</button>}>
        {loading ? <p className="text-sm text-slate-500">Loading student performance data.</p> : !(data?.topStudents || []).length ? <p className="text-sm text-slate-500">No student performance data available yet.</p> : <div className="divide-y divide-slate-100">{data.topStudents.map((student, index) => <div className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0" key={student._id}><div className="flex min-w-0 items-center gap-3"><span className="w-5 text-sm font-semibold text-slate-500">{index + 1}.</span><UserAvatar user={student} className="h-10 w-10" /><span className="truncate font-semibold text-slate-900">{student.name}</span></div><span className="shrink-0 font-bold text-slate-950">{student.average}%</span></div>)}</div>}
      </Panel>

      <Panel title="Assessment Insights" eyebrow="Assessment results">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5"><Metric label="Average Score" value={insights?.averageScore} /><Metric label="Passing Rate" value={insights?.passingRate} /><Metric label="Completion Rate" value={insights?.completionRate} /><Metric label="Highest Score" value={insights?.highestScore} /><Metric label="Lowest Score" value={insights?.lowestScore} /></div>
      </Panel>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="Subjects With Lowest Quiz Submissions" eyebrow="Top 3"><SubmissionList subjects={data?.lowestQuizSubmissions || []} emptyMessage="No submission data available yet." /></Panel>
        <Panel title="Subjects With Highest Quiz Submissions" eyebrow="Top 3"><SubmissionList subjects={data?.highestQuizSubmissions || []} emptyMessage="No submission data available yet." /></Panel>
      </div>

      <Panel title="At-Risk Students" eyebrow="Needs attention">
        <div className="overflow-x-auto"><table className="w-full min-w-[480px] text-left text-sm"><thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-3">Student</th><th className="px-3 py-3">Average</th><th className="px-3 py-3">Status</th></tr></thead><tbody className="divide-y divide-slate-100">{(risks.atRisk || []).slice(0, 6).map((student) => <tr key={student._id}><td className="px-3 py-3 font-semibold text-slate-950">{student.name}</td><td className="px-3 py-3 font-bold text-slate-950">{student.average}%</td><td className="px-3 py-3"><StatusBadge value="At Risk" /></td></tr>)}</tbody></table>{!(risks.atRisk || []).length && <div className="py-8 text-center text-sm text-slate-500">No at-risk students currently flagged.</div>}</div>
      </Panel>

      <Panel title="Student Risk Categories" eyebrow="Distribution"><div className="grid gap-4 md:grid-cols-3">{[["At Risk", risks.atRisk || [], "border-red-200 bg-red-50"], ["Average", risks.average || [], "border-amber-200 bg-amber-50"], ["Excellent", risks.excellent || [], "border-green-200 bg-green-50"]].map(([label, students, style]) => <div className={`rounded-lg border p-4 ${style}`} key={label}><div className="mb-2 flex items-center justify-between"><h3 className="font-semibold">{label}</h3><span className="text-sm">{students.length}</span></div></div>)}</div></Panel>
    </div>
  );
}
