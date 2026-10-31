import LoadingState from "../../components/LoadingState";
import StatCard from "../../components/StatCard";
import { api } from "../../services/api";
import { useAsyncData } from "../../hooks/useAsyncData";

export default function AdminDashboard() {
  const { data, loading, error } = useAsyncData(api.adminDashboard, []);
  if (loading || error) return <LoadingState label="Loading records" error={error} />;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="Total Teachers" value={data?.totalTeachers} />
        <StatCard label="Total Students" value={data?.totalStudents} />
        <StatCard label="Total Users" value={data?.totalUsers} />
        <StatCard label="Total Assessments" value={data?.totalAssessments} />
        <StatCard label="Total Subjects" value={data?.totalSubjects} />
        <StatCard label="Total Quiz Games" value={data?.totalQuizGames} />
      </div>
    </div>
  );
}
