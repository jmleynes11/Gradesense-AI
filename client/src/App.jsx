import { useEffect, useState } from "react";
import { AuthProvider, useAuth } from "./context/AuthContext";
import DashboardLayout from "./layouts/DashboardLayout";
import Login from "./pages/auth/Login";
import AdminDashboard from "./pages/admin/AdminDashboard";
import UserManagement from "./pages/admin/UserManagement";
import AuditLogs from "./pages/admin/AuditLogs";
import TeacherDashboard from "./pages/teacher/TeacherDashboard";
import Assessments from "./pages/teacher/Assessments";
import AIGenerator from "./pages/teacher/AIGenerator";
import TeacherQuizGame from "./pages/teacher/TeacherQuizGame";
import Submissions from "./pages/teacher/Submissions";
import Announcements from "./pages/teacher/Announcements";
import Subjects from "./pages/teacher/Subjects";
import StudentDashboard from "./pages/student/StudentDashboard";
import StudentAssessments from "./pages/student/StudentAssessments";
import StudentQuizGames from "./pages/student/StudentQuizGames";
import GradeHistory from "./pages/student/GradeHistory";
import MySubjects from "./pages/student/MySubjects";
import DataPrivacyNotice from "./components/DataPrivacyNotice";
import ProfileSettings from "./pages/teacher/ProfileSettings";
import { notificationTarget } from "./services/notificationTarget";

function Dashboard() {
  const { user } = useAuth();
  const [active, setActive] = useState("Dashboard");
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [submissionAssessmentId, setSubmissionAssessmentId] = useState("");
  const [assessmentSubjectId, setAssessmentSubjectId] = useState("");
  const [notificationLink, setNotificationLink] = useState(null);

  function navigateFromNotification(notification) {
    const target = notificationTarget(notification);
    setNotificationLink({ ...target, key: `${notification._id}:${Date.now()}` });
    setActive(target.page);
  }

  function navigate(page) {
    setNotificationLink(null);
    setActive(page);
  }

  useEffect(() => {
    if (!user) return;
    setShowPrivacy(["teacher", "student"].includes(user.role) && !sessionStorage.getItem(`privacy_seen_${user.id}`));
  }, [user]);

  if (!user) return <Login />;

  const pages = {
    admin: {
      Dashboard: <AdminDashboard />,
      Users: <UserManagement />,
      "Audit Logs": <AuditLogs />
    },
    teacher: {
      Dashboard: <TeacherDashboard onNavigate={setActive} />,
      Subjects: <Subjects onNavigate={setActive} onCreateAssessment={(subjectId) => {
        setAssessmentSubjectId(subjectId);
        setActive("Assessments");
      }} onViewSubmissions={(assessmentId) => {
        setSubmissionAssessmentId(assessmentId);
        setActive("Analytics");
      }} />,
      Assessments: <Assessments initialSubjectId={assessmentSubjectId} onViewSubmissions={(assessmentId) => {
        setSubmissionAssessmentId(assessmentId);
        setActive("Analytics");
      }} />,
      "AI Quiz Generator": <AIGenerator />,
      "Quiz Game": <TeacherQuizGame onExit={() => setActive("Dashboard")} />,
      Analytics: <Submissions assessmentId={submissionAssessmentId} onClearAssessment={() => setSubmissionAssessmentId("")} />,
      Reports: <Announcements />,
      Settings: <ProfileSettings />,
      "Profile Settings": <ProfileSettings />
    },
    student: {
      Dashboard: <StudentDashboard onNavigate={navigate} />,
      "My Subjects": <MySubjects key={notificationLink?.key || "subjects"} initialSubjectId={notificationLink?.subjectId} onNavigate={navigate} />,
      "My Assessments": <StudentAssessments key={notificationLink?.key || "assessments"} initialAssessmentId={notificationLink?.assessmentId} />,
      "Quiz Games": <StudentQuizGames key={notificationLink?.key || "games"} initialGameId={notificationLink?.gameId} initialView={notificationLink?.results ? "complete" : "dashboard"} />,
      "Grades & Feedback": <GradeHistory key={notificationLink?.key || "grades"} initialSubmissionId={notificationLink?.submissionId} initialAssessmentId={notificationLink?.assessmentId} />,
      Progress: <GradeHistory />,
      Leaderboard: <StudentQuizGames initialView="leaderboard" />,
      Notifications: <StudentDashboard />,
      Settings: <ProfileSettings />,
      "Profile Settings": <ProfileSettings />
    }
  };

  return (
    <DashboardLayout active={active} setActive={user.role === "student" ? navigate : setActive} onNotificationNavigate={navigateFromNotification}>
      {showPrivacy && (
        <DataPrivacyNotice
          role={user.role}
          onClose={() => {
            sessionStorage.setItem(`privacy_seen_${user.id}`, "true");
            setShowPrivacy(false);
          }}
        />
      )}
      {pages[user.role][active] || pages[user.role].Dashboard}
    </DashboardLayout>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Dashboard />
    </AuthProvider>
  );
}
