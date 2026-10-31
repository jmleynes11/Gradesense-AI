const Assessment = require("../models/Assessment");
const Submission = require("../models/Submission");
const Subject = require("../models/Subject");

const completedStatuses = new Set(["submitted", "graded"]);

function percentageForSubmission(submission) {
  const possible = Number(submission.totalPossiblePoints);
  const earned = Number(submission.finalScore ?? submission.score);
  if (Number.isFinite(possible) && possible > 0 && Number.isFinite(earned)) {
    return (earned / possible) * 100;
  }

  const percentage = Number(submission.finalPercentage ?? submission.percentage);
  return Number.isFinite(percentage) ? percentage : null;
}

function pointsForSubmission(submission) {
  const possible = Number(submission.totalPossiblePoints);
  const earned = Number(submission.finalScore ?? submission.score);
  if (Number.isFinite(possible) && possible > 0 && Number.isFinite(earned)) {
    return { earned, possible };
  }

  const percentage = percentageForSubmission(submission);
  return percentage === null ? null : { earned: percentage, possible: 100 };
}

function rounded(value) {
  return Math.round(value);
}

async function studentDashboard(req, res) {
  const subjects = await Subject.find({ students: req.user._id, archived: { $ne: true } })
    .select("name code").lean();
  const subjectIds = subjects.map((subject) => subject._id);
  const assessments = await Assessment.find({ subjectRef: { $in: subjectIds }, status: { $in: ["published", "closed"] } })
    .select("title subject assessmentType dueDate endDate startDate subjectRef totalPoints status isPublished")
    .sort({ dueDate: 1, createdAt: 1 }).lean();
  const assessmentIds = assessments.map((assessment) => assessment._id);
  const submissions = await Submission.find({ student: req.user._id, assessment: { $in: assessmentIds } })
    .select("assessment status score finalScore percentage finalPercentage totalPossiblePoints").lean();

  const submissionByAssessment = new Map(submissions.map((submission) => [String(submission.assessment), submission]));
  const graded = submissions.filter((submission) => submission.status === "graded");
  const allPoints = graded.map(pointsForSubmission).filter(Boolean);
  const currentAverage = allPoints.length
    ? rounded((allPoints.reduce((total, item) => total + item.earned, 0) / allPoints.reduce((total, item) => total + item.possible, 0)) * 100)
    : 0;
  const now = new Date();
  const upcomingAssessments = assessments
    .filter((assessment) => assessment.status === "published" && !submissionByAssessment.has(String(assessment._id)))
    .map((assessment) => {
      const deadline = assessment.endDate || assessment.dueDate;
      return {
        _id: assessment._id,
        title: assessment.title,
        subject: assessment.subject,
        assessmentType: assessment.assessmentType,
        dueDate: assessment.dueDate,
        endDate: assessment.endDate,
        isOverdue: Boolean(deadline && new Date(deadline) < now),
      };
    })
    .sort((left, right) => {
      const leftTime = left.endDate || left.dueDate ? new Date(left.endDate || left.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
      const rightTime = right.endDate || right.dueDate ? new Date(right.endDate || right.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
      return leftTime - rightTime;
    });

  const subjectById = new Map(subjects.map((subject) => [String(subject._id), subject]));
  const assessmentById = new Map(assessments.map((assessment) => [String(assessment._id), assessment]));
  const subjectScores = new Map();
  for (const submission of graded) {
    const assessment = assessmentById.get(String(submission.assessment));
    if (!assessment || !subjectById.has(String(assessment.subjectRef))) continue;
    const points = pointsForSubmission(submission);
    if (!points) continue;
    const key = String(assessment.subjectRef);
    const score = subjectScores.get(key) || { earned: 0, possible: 0 };
    score.earned += points.earned;
    score.possible += points.possible;
    subjectScores.set(key, score);
  }
  const subjectAverages = [...subjectScores.entries()]
    .filter(([, score]) => score.possible > 0)
    .map(([subjectId, score]) => ({
      subjectId,
      name: subjectById.get(subjectId)?.name || "Subject",
      percentage: rounded((score.earned / score.possible) * 100),
    }));

  res.json({
    currentAverage,
    completedAssessments: submissions.filter((submission) => completedStatuses.has(submission.status)).length,
    pendingAssessments: upcomingAssessments.length,
    academicStatus: currentAverage >= 75 ? "Passing" : "At Risk",
    performanceTrend: "Not available",
    recommendations: [],
    upcomingAssessments,
    lowestSubjects: [...subjectAverages].sort((a, b) => a.percentage - b.percentage || a.name.localeCompare(b.name)).slice(0, 3),
    highestSubjects: [...subjectAverages].sort((a, b) => b.percentage - a.percentage || a.name.localeCompare(b.name)).slice(0, 3),
  });
}

async function teacherDashboard(req, res) {
  const subjects = await Subject.find({ teacher: req.user._id, archived: { $ne: true } })
    .select("name students").lean();
  const subjectIds = subjects.map((subject) => subject._id);
  const assessments = await Assessment.find({ teacher: req.user._id, subjectRef: { $in: subjectIds } })
    .select("title subjectRef assessmentType status isPublished passingMark").lean();
  const assessmentIds = assessments.map((assessment) => assessment._id);
  const submissions = await Submission.find({ assessment: { $in: assessmentIds } })
    .populate("student", "name email profileImage")
    .select("assessment student status score finalScore percentage finalPercentage totalPossiblePoints").lean();

  const subjectById = new Map(subjects.map((subject) => [String(subject._id), subject]));
  const assessmentById = new Map(assessments.map((assessment) => [String(assessment._id), assessment]));
  const validGraded = submissions.filter((submission) => {
    if (submission.status !== "graded" || !submission.student) return false;
    const assessment = assessmentById.get(String(submission.assessment));
    return assessment && subjectById.get(String(assessment.subjectRef))?.students.some((student) => String(student) === String(submission.student._id)) && pointsForSubmission(submission);
  });

  const studentScores = new Map();
  const percentages = [];
  let passed = 0;
  let totalEarned = 0;
  let totalPossible = 0;
  for (const submission of validGraded) {
    const points = pointsForSubmission(submission);
    const percentage = percentageForSubmission(submission);
    const assessment = assessmentById.get(String(submission.assessment));
    const key = String(submission.student._id);
    const row = studentScores.get(key) || { student: submission.student, earned: 0, possible: 0 };
    row.earned += points.earned;
    row.possible += points.possible;
    studentScores.set(key, row);
    percentages.push(percentage);
    totalEarned += points.earned;
    totalPossible += points.possible;
    if (percentage >= Number(assessment.passingMark ?? 75)) passed += 1;
  }
  const rankedStudents = [...studentScores.values()]
    .filter((row) => row.possible > 0)
    .map((row) => ({
      _id: row.student._id,
      name: row.student.name || row.student.email,
      profileImage: row.student.profileImage || "",
      average: rounded((row.earned / row.possible) * 100),
    }))
    .sort((a, b) => b.average - a.average || a.name.localeCompare(b.name));
  const topStudents = rankedStudents.slice(0, 5);

  const publishedAssessments = assessments.filter((assessment) => assessment.status === "published");
  const submittedByAssessment = new Map();
  for (const submission of submissions) {
    if (!completedStatuses.has(submission.status)) continue;
    const assessment = assessmentById.get(String(submission.assessment));
    const subject = assessment && subjectById.get(String(assessment.subjectRef));
    if (!subject || !submission.student?._id || !subject.students.some((student) => String(student) === String(submission.student._id))) continue;
    const key = String(submission.assessment);
    const set = submittedByAssessment.get(key) || new Set();
    if (submission.student?._id) set.add(String(submission.student._id));
    submittedByAssessment.set(key, set);
  }
  const expected = publishedAssessments.reduce((total, assessment) => total + (subjectById.get(String(assessment.subjectRef))?.students.length || 0), 0);
  const submitted = publishedAssessments.reduce((total, assessment) => total + (submittedByAssessment.get(String(assessment._id))?.size || 0), 0);
  const subjectQuizRows = subjects.map((subject) => {
    const quizzes = publishedAssessments.filter((assessment) => String(assessment.subjectRef) === String(subject._id) && assessment.assessmentType === "quiz");
    const expectedStudents = quizzes.length * subject.students.length;
    const submittedStudents = quizzes.reduce((total, quiz) => total + (submittedByAssessment.get(String(quiz._id))?.size || 0), 0);
    return {
      subjectId: subject._id,
      name: subject.name,
      submitted: submittedStudents,
      expected: expectedStudents,
      percentage: expectedStudents ? rounded((submittedStudents / expectedStudents) * 100) : null,
    };
  }).filter((row) => row.percentage !== null);

  res.json({
    summary: {
      students: new Set(subjects.flatMap((subject) => subject.students.map(String))).size,
      subjects: subjects.length,
      assessments: assessments.length,
    },
    topStudents,
    riskCategories: {
      atRisk: rankedStudents.filter((student) => student.average < 75),
      average: rankedStudents.filter((student) => student.average >= 75 && student.average < 90),
      excellent: rankedStudents.filter((student) => student.average >= 90),
    },
    insights: validGraded.length ? {
      averageScore: rounded((totalEarned / totalPossible) * 100),
      passingRate: rounded((passed / validGraded.length) * 100),
      completionRate: expected ? rounded((submitted / expected) * 100) : null,
      highestScore: rounded(Math.max(...percentages)),
      lowestScore: rounded(Math.min(...percentages)),
    } : null,
    lowestQuizSubmissions: [...subjectQuizRows].sort((a, b) => a.percentage - b.percentage || a.name.localeCompare(b.name)).slice(0, 3),
    highestQuizSubmissions: [...subjectQuizRows].sort((a, b) => b.percentage - a.percentage || a.name.localeCompare(b.name)).slice(0, 3),
  });
}

module.exports = { studentDashboard, teacherDashboard };
