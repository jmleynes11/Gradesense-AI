const Subject=require("../models/Subject"),Assessment=require("../models/Assessment"),Submission=require("../models/Submission"),Feedback=require("../models/Feedback"),User=require("../models/User");const {sortStudents}=require("../utils/studentSort");
const normalize=p=>({name:String(p.name||"").trim(),code:String(p.code||"").trim().toUpperCase(),description:String(p.description||"").trim(),academicYear:String(p.academicYear||"").trim()});
const { notifySubjectMembership } = require("../services/notificationEvents");
async function allowed(req){const s=await Subject.findById(req.params.id).populate("teacher","name email");if(!s)return null;return req.user.role==="teacher"?String(s.teacher._id)===String(req.user._id)?s:null:(s.students||[]).some(x=>String(x)===String(req.user._id))?s:null}
async function listSubjects(req, res) {
  const filter = req.user.role === "teacher" ? { teacher: req.user._id, archived: { $ne: true } } : { students: req.user._id, archived: { $ne: true } };
  const subjects = await Subject.find(filter).populate("teacher", "name email").sort({ name: 1 }).lean();
  const assessments = await Assessment.find({ subjectRef: { $in: subjects.map((subject) => subject._id) }, ...(req.user.role === "student" ? { status: { $in: ["published", "closed"] } } : {}) }).select("_id subjectRef").lean();
  const submissions = req.user.role === "student" ? await Submission.find({ student: req.user._id, assessment: { $in: assessments.map((item) => item._id) } }).select("assessment status percentage").lean() : [];
  const assessmentSubjects = new Map(assessments.map((item) => [String(item._id), String(item.subjectRef)]));
  const metrics = new Map();
  for (const assessment of assessments) {
    const key = String(assessment.subjectRef);
    const row = metrics.get(key) || { assessmentCount: 0, completed: 0, graded: 0, score: 0 };
    row.assessmentCount += 1;
    metrics.set(key, row);
  }
  for (const submission of submissions) {
    const row = metrics.get(assessmentSubjects.get(String(submission.assessment)));
    if (!row) continue;
    if (["submitted", "graded"].includes(submission.status)) row.completed += 1;
    if (submission.status === "graded") { row.graded += 1; row.score += Number(submission.percentage || 0); }
  }
  res.json(subjects.map((subject) => {
    const row = metrics.get(String(subject._id));
    return { ...subject, studentCount: subject.students.length, assessmentCount: row?.assessmentCount || 0, completedAssessments: row?.completed || 0, averageScore: row?.graded ? Math.round(row.score / row.graded) : null };
  }));
}
async function addStudent(req, res) {
  const student = await User.findOne({ _id: req.body.studentId, role: "student" }).select("name email studentNumber");
  if (!student) return res.status(404).json({ message: "Student account not found." });
  const previous = await Subject.findOneAndUpdate({ _id: req.params.id, teacher: req.user._id }, { $addToSet: { students: student._id } }, { new: false });
  if (!previous) return res.status(404).json({ message: "Subject not found." });
  if (!previous.students.some((id) => String(id) === String(student._id))) await notifySubjectMembership(previous, student._id, "assigned");
  const subject = await Subject.findById(previous._id).populate("students", "name email studentNumber");
  subject.students = sortStudents(subject.students);
  res.json(subject);
}
async function listStudents(req,res){res.json(sortStudents(await User.find({role:"student"}).select("name firstName lastName email studentNumber")))}
async function removeStudent(req, res) {
  const previous = await Subject.findOneAndUpdate({ _id: req.params.id, teacher: req.user._id }, { $pull: { students: req.params.studentId } }, { new: false });
  if (!previous) return res.status(404).json({ message: "Subject not found." });
  if (previous.students.some((id) => String(id) === String(req.params.studentId))) await notifySubjectMembership(previous, req.params.studentId, "removed");
  const subject = await Subject.findById(previous._id).populate("students", "name email studentNumber");
  subject.students = sortStudents(subject.students);
  res.json(subject);
}
async function createSubject(req,res){const v=normalize(req.body);if(!v.name||!v.code)return res.status(400).json({message:"Subject name and subject code are required."});try{res.status(201).json(await Subject.create({...v,teacher:req.user._id}))}catch(e){if(e.code===11000)return res.status(400).json({message:"A subject with this name or code already exists."});throw e}}
async function updateSubject(req,res){const s=await Subject.findOne({_id:req.params.id,teacher:req.user._id});if(!s)return res.status(404).json({message:"Subject not found."});const v=normalize(req.body);if(!v.name||!v.code)return res.status(400).json({message:"Subject name and subject code are required."});try{const old=s.name;Object.assign(s,v);await s.save();if(old!==s.name)await Assessment.updateMany({subjectRef:s._id},{subject:s.name});res.json(s)}catch(e){if(e.code===11000)return res.status(400).json({message:"A subject with this name or code already exists."});throw e}}
async function archiveSubject(req,res){const s=await Subject.findOneAndUpdate({_id:req.params.id,teacher:req.user._id},{archived:true},{new:true});if(!s)return res.status(404).json({message:"Subject not found."});res.json(s)}
async function deleteSubject(req,res){const s=await Subject.findOne({_id:req.params.id,teacher:req.user._id});if(!s)return res.status(404).json({message:"Subject not found."});if(await Assessment.exists({subjectRef:s._id}))return res.status(400).json({message:"Subject has assessments and cannot be deleted."});await s.deleteOne();res.json({message:"Subject deleted."})}
async function subjectDetails(req,res){const subject=await allowed(req);if(!subject)return res.status(404).json({message:"Subject not found."});const populated=await Subject.findById(subject._id).populate("students","name firstName lastName email studentNumber");const filter={subjectRef:subject._id,...(req.user.role==="student"?{status:{$in:["published","closed"]}}:{})};const assessments=await Assessment.find(filter).select("title subject subjectRef assessmentType status dueDate totalPoints questions createdAt").sort({dueDate:-1,createdAt:-1}).lean();const submissions=await Submission.find(req.user.role==="teacher"?{assessment:{$in:assessments.map(x=>x._id)}}:{assessment:{$in:assessments.map(x=>x._id)},student:req.user._id}).select("assessment student status score percentage finalScore finalPercentage totalPossiblePoints answers.pointsPossible submittedAt aiGradingStatus gradedBy createdAt").populate("student","name email studentNumber").sort({createdAt:-1});const feedback=req.user.role==="student"?await Feedback.find({student:req.user._id,assessment:{$in:assessments.map(x=>x._id)}}).populate("assessment","title").sort({createdAt:-1}):[];const graded=submissions.filter(x=>x.status==="graded"),scores=graded.reduce((m,x)=>{const id=String(x.student?._id||x.student);(m[id]||=[]).push(x.percentage);return m},{}),students=sortStudents(populated.students.map(x=>({...x.toObject(),averageScore:scores[String(x._id)]?.length?Math.round(scores[String(x._id)].reduce((a,b)=>a+b,0)/scores[String(x._id)].length):null})));res.json({subject,directStudentIds:populated.students.map(x=>String(x._id)),students,assessments,submissions,feedback,summary:{studentCount:students.length,assessmentCount:assessments.length,completedCount:submissions.filter(x=>["submitted","graded"].includes(x.status)).length,averageScore:graded.length?Math.round(graded.reduce((n,x)=>n+x.percentage,0)/graded.length):null}})}
module.exports={listSubjects,createSubject,updateSubject,archiveSubject,deleteSubject,addStudent,removeStudent,listStudents,subjectDetails};
