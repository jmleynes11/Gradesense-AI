const Assessment=require("../models/Assessment"),Subject=require("../models/Subject"),Submission=require("../models/Submission");
const {notifyStudents}=require("../services/notificationService"); const {deleteAssessmentCascade}=require("../services/assessmentService"); const {validateQuestionPayload}=require("../services/questionIntegrityService"); const logAction=require("../utils/audit"); const {sortStudents}=require("../utils/studentSort");
const {findTeacherSubject,httpError}=require("../utils/subjectReference");
const { assessmentSnapshot } = require("../services/assessmentSnapshot");
const { pagination, objectId, assessmentListFields, assessmentDetailExclusions } = require("../utils/queryOptions");
const { notifyAssessmentUpdated } = require("../services/notificationEvents");
const assessmentTypes=new Set(["quiz","seatwork","assignment","exam","activity","programming"]);
function validateAssessmentPayload(body,{partial=false}={}){const title=String(body.title||"").trim();if(!partial&&!title)throw httpError("Assessment title is required.",400,"MISSING_TITLE");if(!partial&&!body.dueDate)throw httpError("Submission date is required.",400,"MISSING_DUE_DATE");if(body.dueDate&&Number.isNaN(new Date(body.dueDate).getTime()))throw httpError("Submission date is invalid.",400,"INVALID_DUE_DATE");if(body.assessmentType&&!assessmentTypes.has(body.assessmentType))throw httpError("Assessment type is invalid.",400,"INVALID_ASSESSMENT_TYPE");}
async function assigned(teacher,body){return{subject:await findTeacherSubject(teacher,body.subjectRef)}}
async function listAssessments(req, res) {
  const filter = req.user.role === "teacher" ? { teacher: req.user._id } : {
    status: "published", subjectRef: { $in: (await Subject.find({ students: req.user._id, archived: { $ne: true } }).select("_id").lean()).map((item) => item._id) },
  };
  if (req.query.subjectRef) {
    const subjectRef = objectId(req.query.subjectRef, "subject");
    filter.$and = [{ subjectRef }];
  }
  if (req.user.role === "teacher" && req.query.status) {
    if (!["draft", "published", "closed", "archived", "ai_review"].includes(req.query.status)) throw httpError("Invalid assessment status.", 400, "INVALID_STATUS");
    filter.status = req.query.status === "ai_review" ? "draft" : req.query.status;
    if (req.query.status === "ai_review") filter.generationId = { $exists: true, $ne: null };
  }
  const summary = req.query.view === "summary";
  const page = pagination(req.query);
  let query = Assessment.find(filter).select(assessmentListFields).populate("subjectRef", "name code")
    .sort(req.user.role === "teacher" ? { status: 1, updatedAt: -1, _id: -1 } : { publishedAt: -1, createdAt: -1, _id: -1 }).lean();
  if (summary) query = query.skip(page.skip).limit(page.limit + 1);
  const rows = await query;
  const items = (summary ? rows.slice(0, page.limit) : rows).map((item) => ({ ...item, numberOfQuestions: item.questions?.length || 0 }));
  res.json(summary ? { items, page: page.page, limit: page.limit, hasMore: rows.length > page.limit } : items);
}
async function createAssessment(req,res){validateAssessmentPayload(req.body);const a=await assigned(req.user._id,req.body);const item=await Assessment.create({...req.body,title:req.body.title.trim(),subjectRef:a.subject._id,subject:a.subject.name,teacher:req.user._id,status:"draft",isPublished:false,publishedAt:undefined});await logAction(req,"create_assessment","assessments",item.title);res.status(201).json(item)}
async function updateAssessment(req, res) {
  if (req.body.status === "published" || req.body.isPublished === true) throw httpError("Use the Publish Assessment action to publish a draft.", 400, "EXPLICIT_PUBLISH_REQUIRED");
  const item = await Assessment.findOne({ _id: req.params.id, teacher: req.user._id }).select(assessmentDetailExclusions).populate("questions").lean();
  if (!item) return res.status(404).json({ message: "Assessment not found" });
  if (item.status === "published" && !["closed", "archived"].includes(req.body.status)) return res.status(400).json({ message: "Published assessments can only be closed or archived." });
  validateAssessmentPayload(req.body, { partial: true });
  const editable = ["title", "description", "instructions", "subjectRef", "dueDate", "assessmentType", "difficulty", "passingMark", "startDate", "endDate", "durationMinutes", "allowPreviousQuestions", "lockPreviousQuestions", "randomizeQuestions", "randomizeChoices", "attemptLimit", "allowAnswerReview", "status"];
  const changes = Object.fromEntries(editable.filter((key) => req.body[key] !== undefined).map((key) => [key, req.body[key]]));
  if (changes.status && !["draft", "closed", "archived"].includes(changes.status)) throw httpError("Invalid assessment status.", 400, "INVALID_STATUS");
  if (changes.subjectRef) {
    const subject = await findTeacherSubject(req.user._id, changes.subjectRef);
    changes.subjectRef = subject._id;
    changes.subject = subject.name;
  }
  changes.isPublished = (changes.status || item.status) === "published";
  const snapshot = assessmentSnapshot({ ...item, ...changes });
  const saved = await Assessment.updateOne({ _id: item._id, teacher: req.user._id, status: item.status }, {
    $set: { ...changes, teacherModifiedVersion: snapshot },
    $push: { versionHistory: { action: "assessment_updated", changedBy: req.user._id, createdAt: new Date(), snapshot } },
  }, { runValidators: true });
  if (!saved.matchedCount) throw httpError("Assessment changed while saving. Reload it before editing.", 409, "ASSESSMENT_CHANGED");
  const changed = Object.keys(changes).some((key) => JSON.stringify(item[key]) !== JSON.stringify(changes[key]));
  if (changed && ["published", "closed"].includes(item.status)) await notifyAssessmentUpdated({ ...item, ...changes }, [item.updatedAt, changes]);
  res.json({ ...item, ...changes });
}
async function submissionStatus(req, res) {
  const assessment = await Assessment.findOne({ _id: req.params.id, teacher: req.user._id })
    .select("title subject subjectRef").populate({ path: "subjectRef", select: "name students", populate: { path: "students", select: "name email studentNumber" } }).lean();
  if (!assessment) return res.status(404).json({ message: "Assessment not found" });
  const submissions = await Submission.find({ assessment: assessment._id })
    .select("student status submittedAt score percentage finalScore finalPercentage aiGradingStatus gradedBy").lean();
  const by = new Map(submissions.map((item) => [String(item.student?._id || item.student), item]));
  const students = sortStudents(assessment.subjectRef?.students || []).map((student) => {
    const submission = by.get(String(student._id));
    const done = submission && ["submitted", "graded"].includes(submission.status);
    const pending = submission?.status === "submitted" || (submission?.aiGradingStatus === "pending_review" && !submission?.gradedBy);
    return { student, status: done ? (pending ? "submitted" : submission.status) : "not_submitted",
      aiGradingStatus: submission?.aiGradingStatus, gradedBy: submission?.gradedBy,
      submittedAt: submission?.submittedAt || null, score: done && !pending ? (submission.finalScore ?? submission.score ?? 0) : null,
      percentage: done && !pending ? (submission.finalPercentage ?? submission.percentage ?? 0) : null, submissionId: submission?._id || null };
  });
  const done = students.filter((item) => item.status !== "not_submitted");
  const graded = students.filter((item) => item.status === "graded");
  res.json({ assessment: { _id: assessment._id, title: assessment.title, subject: assessment.subject },
    totalStudents: students.length, turnedIn: done.length, notSubmitted: students.length - done.length,
    averageScore: graded.length ? Math.round(graded.reduce((sum, item) => sum + Number(item.percentage || 0), 0) / graded.length) : null, students });
}
async function deleteAssessment(req,res){const result=await deleteAssessmentCascade(req.params.id,req.user._id);if(!result)return res.status(404).json({message:"Assessment not found"});await logAction(req,"delete_assessment","assessments",result.assessment.title);res.json({message:"Assessment deleted",deleted:result.deleted})}
async function analytics(req,res){const assessments=await Assessment.find({teacher:req.user._id}).select("_id").lean(),submissions=await Submission.find({assessment:{$in:assessments.map(x=>x._id)},status:"graded"}).select("student percentage finalPercentage").populate("student","name email"),scores=submissions.map(x=>Number(x.percentage||0)),assessmentAverage=scores.length?Math.round(scores.reduce((a,b)=>a+b,0)/scores.length):0,groups=submissions.reduce((m,x)=>{const id=String(x.student?._id||"");if(id)(m[id]||={student:x.student,scores:[]}).scores.push(Number(x.finalPercentage??x.percentage??0));return m},{}),students=sortStudents(Object.values(groups).map(x=>({...x.student.toObject(),average:Math.round(x.scores.reduce((a,b)=>a+b,0)/x.scores.length)})));res.json({assessmentAverage,classAverage:assessmentAverage,highestScore:scores.length?Math.max(...scores):0,lowestScore:scores.length?Math.min(...scores):0,passingRate:scores.length?Math.round(scores.filter(x=>x>=75).length/scores.length*100):0,topStudents:students.filter(x=>x.average>=90),atRiskStudents:students.filter(x=>x.average<75),averageStudents:students.filter(x=>x.average>=75&&x.average<90),excellentStudents:students.filter(x=>x.average>=90)})}
async function getAssessment(req,res){const item=await Assessment.findOne({_id:req.params.id,teacher:req.user._id}).select(assessmentDetailExclusions).populate("questions").populate("subjectRef","name code").lean();if(!item)return res.status(404).json({message:"Assessment not found"});res.json(item)}
async function publishSummary(req,res){const item=await Assessment.findOne({_id:req.params.id,teacher:req.user._id}).select(assessmentListFields + " lockPreviousQuestions").lean();if(!item)return res.status(404).json({message:"Assessment not found"});res.json({title:item.title,assessmentType:item.assessmentType,numberOfQuestions:item.questions.length,difficulty:item.difficulty,subject:item.subject,dueDate:item.dueDate,startDate:item.startDate,endDate:item.endDate,durationMinutes:item.durationMinutes,attemptLimit:item.attemptLimit,lockPreviousQuestions:item.lockPreviousQuestions,status:item.status})}
async function publishAssessment(req,res){const item=await Assessment.findOne({_id:req.params.id,teacher:req.user._id}).select(assessmentDetailExclusions).populate("questions");if(!item)return res.status(404).json({message:"Assessment not found"});const subject=await findTeacherSubject(req.user._id,item.subjectRef);if(!item.title?.trim())return res.status(400).json({message:"Assessment title is required before publishing."});if(!item.questions.length)return res.status(400).json({message:"Assessment must have questions before publishing."});for(const q of item.questions)try{validateQuestionPayload(q.toObject())}catch(e){return res.status(400).json({message:`Question ${q.order||""} cannot be published: ${e.message}`})}item.subjectRef=subject._id;item.subject=subject.name;item.status="published";item.isPublished=true;item.publishedAt=new Date();await item.save();await notifyStudents((subject.students||[]).map(String),{subject:subject._id,assessment:item._id,title:`New ${item.assessmentType}: ${item.title}`,message:`Your teacher has assigned a new ${item.assessmentType}: ${item.title}.`,type:"assessments",eventKey:`assessment:published:${item._id}`});await logAction(req,"publish_assessment","assessments",item.title);res.json(assessmentSnapshot(item))}
async function restoreOriginal(req, res) {
  const item = await Assessment.findOne({ _id: req.params.id, teacher: req.user._id }).select("originalAiVersion status").lean();
  if (!item) return res.status(404).json({ message: "Assessment not found" });
  if (!item.originalAiVersion) return res.status(400).json({ message: "No original AI version found." });
  await Assessment.updateOne({ _id: item._id, teacher: req.user._id }, { $set: { teacherModifiedVersion: assessmentSnapshot(item.originalAiVersion) } });
  res.json({ _id: item._id, status: item.status });
}
async function compareVersions(req,res){const item=await Assessment.findOne({_id:req.params.id,teacher:req.user._id});if(!item)return res.status(404).json({message:"Assessment not found"});res.json({originalAiVersion:item.originalAiVersion,teacherModifiedVersion:item.teacherModifiedVersion,versionHistory:item.versionHistory})}
module.exports={listAssessments,createAssessment,updateAssessment,deleteAssessment,analytics,getAssessment,publishSummary,publishAssessment,submissionStatus,restoreOriginal,compareVersions};
