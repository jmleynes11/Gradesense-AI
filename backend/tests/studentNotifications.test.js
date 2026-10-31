const { test, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const Notification = require("../models/Notification");
const User = require("../models/User");
const Subject = require("../models/Subject");
const Assessment = require("../models/Assessment");
const Submission = require("../models/Submission");
const QuizGame = require("../models/QuizGame");
const QuizGameAttempt = require("../models/QuizGameAttempt");
const service = require("../services/notificationService");
const events = require("../services/notificationEvents");
const { createDeadlineReminders } = require("../services/notificationReminders");
const controller = require("../controllers/notificationController");
const subjects = require("../controllers/subjectController");
const assessments = require("../controllers/assessmentController");
const games = require("../controllers/quizGameController");
const { authorize } = require("../middleware/authMiddleware");

const student = "507f1f77bcf86cd799439011";
const other = "507f1f77bcf86cd799439012";
const teacher = "507f1f77bcf86cd799439013";
const subjectId = "507f1f77bcf86cd799439014";
const assessmentId = "507f1f77bcf86cd799439015";
const submissionId = "507f1f77bcf86cd799439016";
const gameId = "507f1f77bcf86cd799439017";
const now = new Date("2026-10-26T08:00:00Z");
function query(value) {
  const result = { then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } };
  for (const name of ["select", "populate", "lean", "sort", "limit"]) result[name] = () => result;
  return result;
}
function response() { return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } }; }
function request(body = {}) { return { user: { _id: student, role: "student" }, body, params: {}, query: {} }; }

function notificationStore() {
  const rows = new Map();
  const sent = [];
  const socketServer = { use() {}, on() {}, to(room) { return { emit(name, row) { sent.push({ room, name, row }); } }; } };
  service.initNotifications(socketServer);
  mock.method(User, "find", (filter) => {
    assert.equal(filter.role, "student");
    return query(filter._id.$in.filter((id) => [student, other].includes(id)).map((_id) => ({ _id })));
  });
  mock.method(Notification, "init", async () => {});
  const writes = mock.method(Notification, "findOneAndUpdate", async (filter, update, options) => {
    if (update.$setOnInsert) {
      assert.equal(options.upsert, true);
      const key = `${filter.student}:${filter.eventKey}`;
      const existing = rows.has(key);
      if (!existing) rows.set(key, { ...update.$setOnInsert, _id: String(rows.size + 1).padStart(24, "0"), createdAt: new Date(now) });
      return { value: rows.get(key), lastErrorObject: { updatedExisting: existing } };
    }
    const row = [...rows.values()].find((item) => item._id === filter._id && item.student === filter.student);
    if (row) Object.assign(row, update);
    return row || null;
  });
  const matches = (row, filter) => row.student === filter.student && (filter.isRead === undefined || row.isRead === filter.isRead)
    && (!filter._id || filter._id.$in.includes(row._id)) && (!filter.type || row.type === filter.type);
  mock.method(Notification, "countDocuments", async (filter) => [...rows.values()].filter((row) => matches(row, filter)).length);
  mock.method(Notification, "updateMany", async (filter, update) => {
    for (const row of rows.values()) if (matches(row, filter)) Object.assign(row, update);
  });
  return { rows, sent, writes };
}

afterEach(() => mock.restoreAll());

test("delivery is student-only, deduplicates recipients and retries, and preserves read state", async () => {
  const store = notificationStore();
  const payload = { eventKey: "published:one", type: "assessments", title: "New assessment", message: "Available now", subject: subjectId, assessment: assessmentId, submission: submissionId, quizGame: gameId };
  await service.notifyStudents([student, student, teacher, other], payload);
  assert.equal(store.rows.size, 2);
  assert.equal(store.sent.length, 2);
  const first = [...store.rows.values()][0]; first.isRead = true;
  await service.notifyStudents([student], payload);
  assert.equal(store.rows.size, 2);
  assert.equal(first.isRead, true);
  assert.equal(first.subject, subjectId);
  assert.equal(first.assessment, assessmentId);
  assert.equal(first.submission, submissionId);
  assert.equal(first.quizGame, gameId);
  assert.equal(store.sent.length, 2);
  assert.deepEqual(store.sent.map((event) => event.room), [`student:${student}`, `student:${other}`]);
});

test("concurrent duplicate inserts are ignored while real database failures propagate", async () => {
  notificationStore();
  const upsert = mock.method(Notification, "findOneAndUpdate", async () => { throw Object.assign(new Error("duplicate"), { code: 11000 }); });
  const payload = { eventKey: "retry", title: "Update", message: "Updated", type: "subjects" };
  assert.deepEqual(await service.notifyStudents([student], payload), []);
  upsert.mock.mockImplementation(async () => { throw new Error("Database unavailable"); });
  await assert.rejects(service.notifyStudents([student], payload), /Database unavailable/);
});

test("the deduplication index is scoped to each student and leaves legacy notifications valid", async () => {
  const index = Notification.schema.indexes().find(([keys]) => keys.eventKey);
  assert.deepEqual(index[0], { student: 1, eventKey: 1 });
  assert.equal(index[1].unique, true);
  assert.deepEqual(index[1].partialFilterExpression, { eventKey: { $type: "string" } });
  await new Notification({ student, title: "Legacy", message: "Existing message" }).validate();
});

test("socket authentication rejects missing tokens, teachers and disabled users and binds the authenticated room", async () => {
  let middleware, connection;
  service.initNotifications({ use(handler) { middleware = handler; }, on(name, handler) { if (name === "connection") connection = handler; } });
  let account = { _id: student, role: "student", isActive: true };
  mock.method(User, "findById", () => query(account));
  const token = jwt.sign({ id: student }, process.env.JWT_SECRET || "dev_secret");
  const socket = () => ({ handshake: { auth: { token, studentId: other } }, data: {}, rooms: [], join(room) { this.rooms.push(room); } });
  const authenticate = (client) => new Promise((resolve) => middleware(client, resolve));
  const missing = socket(); missing.handshake.auth.token = "";
  assert.ok(await authenticate(missing) instanceof Error);
  account = { ...account, role: "teacher" }; assert.ok(await authenticate(socket()) instanceof Error);
  account = { ...account, role: "student", isActive: false }; assert.ok(await authenticate(socket()) instanceof Error);
  account.isActive = true; const client = socket(); assert.equal(await authenticate(client), undefined);
  connection(client); assert.deepEqual(client.rooms, [`student:${student}`]);
});

test("read and bulk-read operations cannot read another student's notifications", async () => {
  const store = notificationStore();
  await service.notifyStudents([student, other], { eventKey: "private", type: "grades", title: "Grade", message: "Released" });
  const own = [...store.rows.values()].find((item) => item.student === student);
  const foreign = [...store.rows.values()].find((item) => item.student === other);
  const req = request(); req.params.id = foreign._id; const denied = response();
  await controller.markRead(req, denied); assert.equal(denied.statusCode, 404); assert.equal(foreign.isRead, false);
  req.params.id = own._id; const read = response(); await controller.markRead(req, read);
  assert.equal(read.body.unreadCount, 0); assert.equal(own.isRead, true);
  own.isRead = false;
  await controller.markAllRead(request({ ids: [foreign._id] }), response()); assert.equal(own.isRead, false); assert.equal(foreign.isRead, false);
  await controller.markAllRead(request({ ids: [own._id] }), response()); assert.equal(own.isRead, true); assert.equal(foreign.isRead, false);
  own.isRead = false; await controller.markAllRead(request(), response()); assert.equal(own.isRead, true); assert.equal(foreign.isRead, false);
  const invalid = response(); await controller.markAllRead(request({ ids: ["bad-id"] }), invalid); assert.equal(invalid.statusCode, 400);
});

test("notification routes keep teacher and admin accounts outside student reads", () => {
  for (const role of ["teacher", "admin"]) {
    const res = response(); let allowed = false;
    authorize("student")({ user: { role } }, res, () => { allowed = true; });
    assert.equal(allowed, false); assert.equal(res.statusCode, 403);
  }
});

test("listing stays recipient-scoped, newest first, with a global unread count", async () => {
  notificationStore();
  mock.method(Subject, "find", () => query([]));
  const sort = mock.fn(() => ({ limit: async () => [] }));
  const find = mock.method(Notification, "find", () => ({ sort }));
  const count = mock.method(Notification, "countDocuments", async () => 7);
  const req = request(); req.query.type = "grades"; const res = response();
  await controller.listNotifications(req, res);
  assert.deepEqual(find.mock.calls[0].arguments[0], { student, type: "grades" });
  assert.deepEqual(sort.mock.calls[0].arguments[0], { createdAt: -1, _id: -1 });
  assert.deepEqual(count.mock.calls[0].arguments[0], { student, isRead: false });
  assert.equal(res.body.unreadCount, 7);
});

test("deadline reminders use real unsubmitted work, availability windows, and one event per deadline", async () => {
  const store = notificationStore();
  mock.method(Subject, "find", () => query([{ _id: subjectId, students: [student, other] }]));
  const assessment = { _id: assessmentId, title: "Matter", subjectRef: subjectId, dueDate: new Date(now.getTime() + 3600000) };
  const find = mock.method(Assessment, "find", () => query([assessment]));
  mock.method(Submission, "find", () => query([{ student: other, assessment: assessmentId }]));
  await createDeadlineReminders(undefined, now); await createDeadlineReminders(undefined, now);
  assert.equal(store.rows.size, 1); assert.equal([...store.rows.values()][0].student, student);
  const filter = find.mock.calls[0].arguments[0];
  assert.equal(filter.status, "published"); assert.equal(filter.$or[0].endDate.$gt, now);
  assert.equal(filter.$or[0].endDate.$lte.getTime(), now.getTime() + 86400000);
  assert.deepEqual(filter.$and[0].$or[1], { startDate: { $lte: now } });
  assessment.endDate = new Date(now.getTime() + 7200000); await createDeadlineReminders(student, now);
  assert.equal(store.rows.size, 2); assert.ok([...store.rows.values()][1].eventKey.includes(assessment.endDate.toISOString()));
});

test("assignment and removal retries do not notify twice; reassignment creates a new event", async () => {
  const store = notificationStore();
  mock.method(User, "findOne", () => query({ _id: student }));
  let enrolled = []; let revision = 0;
  mock.method(Subject, "findOneAndUpdate", async (_filter, update) => {
    const previous = { _id: subjectId, name: "Science", students: [...enrolled], updatedAt: new Date(now.getTime() + revision++) };
    enrolled = update.$addToSet ? [...new Set([...enrolled, student])] : [];
    return previous;
  });
  mock.method(Subject, "findById", () => query({ _id: subjectId, students: enrolled.map((_id) => ({ _id })) }));
  const req = { ...request({ studentId: student }), user: { _id: teacher }, params: { id: subjectId, studentId: student } };
  await subjects.addStudent(req, response()); await subjects.addStudent(req, response()); assert.equal(store.rows.size, 1);
  await subjects.removeStudent(req, response()); await subjects.removeStudent(req, response()); assert.equal(store.rows.size, 2);
  await subjects.addStudent(req, response()); assert.equal(store.rows.size, 3);
  assert.equal([...store.rows.values()][1].action, "removed");
});

test("publication retries notify each enrolled student only once", async () => {
  const store = notificationStore();
  const item = { _id: assessmentId, title: "Matter", subjectRef: subjectId, assessmentType: "quiz", status: "draft", questions: [{ toObject: () => ({ type: "true_false", text: "Water can freeze.", answerKey: "True" }) }], async save() {} };
  mock.method(Assessment, "findOne", () => query(item));
  mock.method(Subject, "findOne", () => query({ _id: subjectId, name: "Science", students: [student, other] }));
  mock.method(require("../models/AuditLog"), "create", async () => ({}));
  const req = { ...request(), user: { _id: teacher }, params: { id: assessmentId } };
  await assessments.publishAssessment(req, response()); await assessments.publishAssessment(req, response());
  assert.equal(store.rows.size, 2); assert.ok([...store.rows.values()].every((row) => row.assessment === assessmentId));
});

test("visible assessment edits and quiz availability are deduplicated, while drafts stay silent", async () => {
  const store = notificationStore(); mock.method(Subject, "findById", () => query({ students: [student] }));
  const assessment = { _id: assessmentId, subjectRef: subjectId, status: "draft", title: "Matter" };
  await events.notifyAssessmentUpdated(assessment, "one"); assert.equal(store.rows.size, 0);
  assessment.status = "published"; await events.notifyAssessmentUpdated(assessment, "one"); await events.notifyAssessmentUpdated(assessment, "one");
  await events.notifyGameAvailable({ _id: gameId, subjectRef: subjectId, status: "draft" }); assert.equal(store.rows.size, 1);
  const game = { _id: gameId, subjectRef: subjectId, status: "active", title: "Atoms", subject: "Science" };
  await events.notifyGameAvailable(game); await events.notifyGameAvailable(game); assert.equal(store.rows.size, 2);
});

test("releasing a zero grade and teacher feedback sends separate notifications without no-op duplicates", async () => {
  const store = notificationStore();
  const assessment = { _id: assessmentId, subjectRef: subjectId, title: "Matter" };
  const previous = { _id: submissionId, student, status: "submitted", score: null, percentage: null, answers: [] };
  const graded = { ...previous, status: "graded", finalScore: 0, finalPercentage: 0, teacherComments: "Review the lesson.", modifiedAt: now };
  await events.notifySubmissionChanges(previous, graded, assessment); await events.notifySubmissionChanges(previous, graded, assessment);
  assert.deepEqual([...store.rows.values()].map((row) => row.type), ["grades", "feedback"]);
  assert.ok([...store.rows.values()].every((row) => row.submission === submissionId));
  await events.notifySubmissionChanges(graded, { ...graded }, assessment); assert.equal(store.rows.size, 2);
});

test("saved quiz results are scoped to the signed-in student and do not create or start attempts", async () => {
  const find = mock.method(QuizGameAttempt, "findOne", () => query({ _id: submissionId, student, quizGame: gameId, completedAt: now, score: 100 }));
  mock.method(QuizGame, "findById", () => query({ _id: gameId, title: "Atoms", questions: [assessmentId] }));
  const create = mock.method(QuizGameAttempt, "create", async () => { throw new Error("Must not start an attempt"); });
  const req = request(); req.params.id = gameId; const res = response(); await games.studentResult(req, res);
  assert.deepEqual(find.mock.calls[0].arguments[0], { quizGame: gameId, student, completedAt: { $ne: null } });
  assert.equal(res.body.result.score, 100); assert.equal(create.mock.callCount(), 0);
});

test("publishing a quiz game delivers availability notifications once to its actual roster", async () => {
  const store = notificationStore();
  const question = { questionText: "What is a solid?", choices: ["Ice", "Steam", "Air", "Water"], correctAnswer: "A" };
  const game = { _id: gameId, subjectRef: subjectId, subject: "Science", title: "Matter", status: "draft", questions: [question], async save() {} };
  mock.method(QuizGame, "findOne", () => query(game));
  mock.method(Subject, "findById", () => query({ students: [student] }));
  const req = { ...request(), user: { _id: teacher }, params: { id: gameId } };
  await games.publishGame(req, response()); await games.publishGame(req, response());
  assert.equal(store.rows.size, 1); assert.equal(game.status, "active");
  assert.equal([...store.rows.values()][0].quizGame, gameId);
});

test("finishing a quiz creates one results notification and does not change attempt restrictions", async () => {
  const store = notificationStore();
  const attempt = { _id: submissionId, quizGame: gameId, student, questionSequence: [assessmentId], async save() {} };
  const game = { _id: gameId, title: "Matter", subjectRef: subjectId, questions: [{ _id: assessmentId, correctAnswer: "A", choices: [{ _id: subjectId, label: "A", value: "Ice" }] }], scoring: { correctPoints: 100 }, enablePoints: true };
  mock.method(QuizGameAttempt, "findOne", async () => attempt);
  mock.method(QuizGame, "findById", () => query(game));
  mock.method(QuizGameAttempt, "find", () => query([attempt]));
  mock.method(QuizGameAttempt, "findByIdAndUpdate", async (_id, update) => Object.assign(attempt, update));
  mock.method(QuizGameAttempt, "findById", () => query(attempt));
  const req = request({ answers: [{ questionId: assessmentId, selectedChoiceId: subjectId, timeTaken: 12 }], completionTime: 12 });
  req.params.attemptId = submissionId; const res = response(); await games.submitAttempt(req, res);
  assert.equal(res.body.score, 100); assert.equal(res.body.status, "completed"); assert.equal(store.rows.size, 1);
  assert.equal([...store.rows.values()][0].action, "results");
  const retry = response(); await games.submitAttempt(req, retry); assert.equal(retry.statusCode, 400); assert.equal(store.rows.size, 1);
});

test("notification links choose the specific record, preserve old assessment links and handle removal", async () => {
  const { notificationTarget } = await import("../../client/src/services/notificationTarget.js");
  assert.deepEqual(notificationTarget({ type: "subjects", subject: subjectId }), { page: "My Subjects", subjectId });
  assert.deepEqual(notificationTarget({ type: "subjects", subject: subjectId, action: "removed" }), { page: "My Subjects", subjectId: "" });
  assert.deepEqual(notificationTarget({ type: "assessments", assessment: assessmentId }), { page: "My Assessments", assessmentId });
  assert.deepEqual(notificationTarget({ type: "feedback", assessment: assessmentId, submission: submissionId }), { page: "Grades & Feedback", submissionId, assessmentId });
  assert.deepEqual(notificationTarget({ type: "grades", assessment: { _id: assessmentId } }), { page: "Grades & Feedback", submissionId: "", assessmentId });
  assert.deepEqual(notificationTarget({ quizGame: gameId, action: "results" }), { page: "Quiz Games", gameId, results: true });
});
