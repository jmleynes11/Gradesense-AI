import LoadingState from "../../components/LoadingState";
import { useMemo } from "react";
import StatCard from "../../components/StatCard";
import Panel from "../../components/Panel";
import { api } from "../../services/api";
import { useAsyncData } from "../../hooks/useAsyncData";
import PageHeader from "../../components/PageHeader";
import { Bot, CheckCircle2, ClipboardList, TrendingUp } from "lucide-react";
import { useAuth } from "../../context/AuthContext";

function formatType(type = "") {
  return type.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function relativeDeadline(date, overdue) {
  if (!date) return "No due date";
  const milliseconds = new Date(date).getTime() - Date.now();
  const absolute = Math.abs(milliseconds);
  const days = Math.floor(absolute / 86400000);
  const hours = Math.floor((absolute % 86400000) / 3600000);
  const value = days ? `${days} day${days === 1 ? "" : "s"}` : `${Math.max(hours, 1)} hour${hours === 1 ? "" : "s"}`;
  return overdue || milliseconds < 0 ? `${value} overdue` : `${value} remaining`;
}

function SubjectAverageList({ subjects, emptyMessage }) {
  if (!subjects.length) return <p className="text-sm text-slate-500">{emptyMessage}</p>;
  return <div className="space-y-4">{subjects.map((subject, index) => (
    <div key={subject.subjectId}>
      <div className="mb-2 flex items-center justify-between gap-3 text-sm">
        <div className="min-w-0"><span className="mr-2 text-slate-500">{index + 1}.</span><span className="font-semibold text-slate-800">{subject.name}</span></div>
        <span className="font-bold text-slate-950">{subject.percentage}%</span>
      </div>
      <div className="h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-[#FF6B00]" style={{ width: `${Math.min(Math.max(subject.percentage, 0), 100)}%` }} /></div>
    </div>
  ))}</div>;
}

export default function StudentDashboard({ onNavigate }) {
  const { data, loading, error } = useAsyncData(api.studentDashboard, []);
  const { user } = useAuth();
  const upcoming = useMemo(() => data?.upcomingAssessments || [], [data]);
  const fullName = user?.name?.trim();

  if (loading || error) return <LoadingState label="Loading dashboard" error={error} />;
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Student Dashboard" title={fullName ? `Welcome back, ${fullName}.` : "Welcome back!"} description="Here's your learning progress." />
      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">Unable to load dashboard data. {error}</div>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={TrendingUp} label="Overall Average" value={data ? `${data.currentAverage}%` : "--"} helper="Current academic standing" />
        <StatCard icon={CheckCircle2} label="Completed" value={data?.completedAssessments ?? "--"} helper="Submitted assessments" />
        <StatCard icon={ClipboardList} label="Pending" value={data?.pendingAssessments ?? "--"} helper="Assessments to complete" />
        <StatCard icon={Bot} label="Performance Trend" value={data?.performanceTrend || "--"} helper="Recent movement" tone="ai" />
      </div>

      <Panel title="Upcoming Assessment Deadlines" eyebrow="Assessments">
        {loading ? <p className="text-sm text-slate-500">Loading assessment deadlines.</p> : !upcoming.length ? <p className="text-sm text-slate-500">No upcoming assessment deadlines.</p> : (
          <div className="divide-y divide-slate-100">
            {upcoming.map((assessment) => {
              const deadline = assessment.endDate || assessment.dueDate;
              return <div className="flex flex-wrap items-center justify-between gap-4 py-4 first:pt-0 last:pb-0" key={assessment._id}>
                <div className="min-w-0"><p className="font-semibold text-slate-950">{assessment.title}</p><p className="mt-1 text-sm text-slate-600">{assessment.subject} · {formatType(assessment.assessmentType)}</p></div>
                <div className="flex flex-wrap items-center gap-3 text-sm"><div className="text-right"><p className="font-medium text-slate-800">{deadline ? new Date(deadline).toLocaleString() : "No due date"}</p><p className={assessment.isOverdue ? "font-semibold text-red-600" : "text-slate-500"}>{relativeDeadline(deadline, assessment.isOverdue)}</p></div><button className="btn-primary px-3 py-2 text-sm" onClick={() => onNavigate?.("My Assessments")} type="button">Open</button></div>
              </div>;
            })}
          </div>
        )}
      </Panel>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="Subjects With Lowest Assessment Average" eyebrow="Top 3"><SubjectAverageList subjects={data?.lowestSubjects || []} emptyMessage="No assessment data available yet." /></Panel>
        <Panel title="Subjects With Highest Assessment Average" eyebrow="Top 3"><SubjectAverageList subjects={data?.highestSubjects || []} emptyMessage="No assessment data available yet." /></Panel>
      </div>

      <Panel title="Academic Status">
        <div className="grid gap-3 text-sm md:grid-cols-3">
          <div className="rounded-lg border border-slate-200 p-3"><p className="text-slate-500">Overall Average</p><p className="text-xl font-semibold">{data ? `${data.currentAverage}%` : "--"}</p></div>
          <div className={`rounded-lg border p-3 ${data?.academicStatus === "At Risk" ? "border-red-200 bg-red-50 text-red-800" : "border-green-200 bg-green-50 text-green-800"}`}><p>Academic Status</p><p className="text-xl font-semibold">{data?.academicStatus || "No data yet"}</p></div>
          <div className="rounded-lg border border-slate-200 p-3"><p className="text-slate-500">Graded Assessments</p><p className="text-xl font-semibold">{data?.completedAssessments ?? "--"}</p></div>
        </div>
      </Panel>

      <Panel title="Student Information">
        <div className="grid gap-3 text-sm md:grid-cols-3">
          <div className="rounded-lg border border-slate-200 p-3"><p className="text-slate-500">Name</p><p className="font-semibold text-slate-900">{fullName || "Not available"}</p></div>
          <div className="rounded-lg border border-slate-200 p-3"><p className="text-slate-500">Student Number</p><p className="font-semibold text-slate-900">{user?.studentNumber || "Not available"}</p></div>
          <div className="rounded-lg border border-slate-200 p-3"><p className="text-slate-500">Email / Username</p><p className="font-semibold text-slate-900">{user?.email || "Not available"}</p></div>
        </div>
      </Panel>
    </div>
  );
}
