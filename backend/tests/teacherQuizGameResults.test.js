const { test, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const QuizGame = require("../models/QuizGame");
const QuizGameAttempt = require("../models/QuizGameAttempt");
const controller = require("../controllers/quizGameController");

const teacher = "507f1f77bcf86cd799439011";
const gameId = "507f1f77bcf86cd799439012";
const game = { _id: gameId, title: "Science", questions: [] };
const req = () => ({ user: { _id: teacher, role: "teacher" }, params: { id: gameId } });
const response = () => ({ status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
function query(value, gameQuery = false) {
  const chain = { then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } };
  chain.populate = (path) => {
    if (gameQuery) assert.ok(QuizGame.schema.path(path), `Unknown game relationship: ${path}`);
    return chain;
  };
  chain.select = () => chain;
  chain.sort = (order) => {
    value = [...value].sort((a, b) => {
      for (const [key, direction] of Object.entries(order)) {
        if (a[key] < b[key]) return -direction;
        if (a[key] > b[key]) return direction;
      }
      return 0;
    });
    return chain;
  };
  return chain;
}
function attempt(id, patch = {}) {
  const record = { _id: id, quizGame: gameId, student: { _id: id, name: `Student ${id}` }, score: 100,
    accuracy: 50, completionTime: 20, completedAt: new Date(), rank: 99, ...patch };
  record.toObject = () => ({ ...record });
  return record;
}
function store(records = [], owned = true) {
  const findGame = mock.method(QuizGame, "findOne", (filter) => {
    assert.deepEqual(filter, { _id: gameId, teacher });
    return query(owned ? game : null, true);
  });
  const findAttempts = mock.method(QuizGameAttempt, "find", (filter) => {
    assert.equal(filter.quizGame, gameId);
    return query(records.filter((row) => row.quizGame === filter.quizGame && (!filter.completedAt || row.completedAt != null)));
  });
  return { findGame, findAttempts };
}
afterEach(() => mock.restoreAll());

test("teacher results include unfinished participants and genuine zero scores without ranking unfinished attempts", async () => {
  store([attempt("zero", { score: 0 }), attempt("pending", { completedAt: null, score: 900, status: "in_progress" }), attempt("winner", { score: 250 })]);
  const res = response();
  await controller.teacherResults(req(), res);
  assert.deepEqual(res.body.results.map((row) => [row._id, row.score, row.status, row.rank]), [
    ["winner", 250, "completed", 1], ["zero", 0, "completed", 2], ["pending", 900, "in_progress", null],
  ]);
  assert.equal(res.body.summary.participants, 3);
  assert.equal(res.body.summary.completedAttempts, 2);
  assert.equal(res.body.summary.averageScore, 125);
});

test("teacher leaderboard uses fresh scores, existing tie breakers, and deterministic ordering instead of stale ranks", async () => {
  const records = [attempt("b"), attempt("a"), attempt("accurate", { accuracy: 90 }),
    attempt("fast", { accuracy: 90, completionTime: 10 }), attempt("top", { score: 500 }),
    attempt("unfinished", { score: 999, completedAt: null }), attempt("other", { quizGame: "another-game", score: 1000 })];
  store(records);
  const res = response();
  await controller.teacherLeaderboard(req(), res);
  assert.deepEqual(res.body.leaderboard.map((row) => row._id), ["top", "fast", "accurate", "a", "b"]);
  assert.deepEqual(res.body.leaderboard.map((row) => row.rank), [1, 2, 3, 4, 5]);
  const results = response();
  await controller.teacherResults(req(), results);
  assert.deepEqual(results.body.results.filter((row) => row.rank).map((row) => [row._id, row.rank]), res.body.leaderboard.map((row) => [row._id, row.rank]));
  records[0].score = 1000;
  await controller.teacherLeaderboard(req(), res);
  assert.equal(res.body.leaderboard[0]._id, "b");
});

test("foreign or missing games cannot expose attempts through either teacher read or the existing leaderboard", async () => {
  const { findAttempts } = store([], false);
  for (const handler of [controller.teacherResults, controller.teacherLeaderboard, controller.leaderboard]) {
    const res = response();
    await handler(req(), res);
    assert.equal(res.statusCode, 404);
  }
  assert.equal(findAttempts.mock.callCount(), 0);
});

test("empty games and recorded zero completion times produce finite result summaries", async () => {
  const records = [];
  store(records);
  const res = response();
  await controller.teacherResults(req(), res);
  assert.deepEqual(res.body.results, []);
  assert.equal(res.body.summary.participants, 0);
  await controller.teacherLeaderboard(req(), res);
  assert.deepEqual(res.body.leaderboard, []);
  records.push(attempt("zero-time", { completionTime: 0 }));
  await controller.teacherResults(req(), res);
  assert.equal(res.body.summary.fastestCompletionTime, 0);
});

test("student leaderboard derives ranks from the selected game's sorted results", async () => {
  const findGame = mock.method(QuizGame, "findOne", () => { throw new Error("Student flow changed"); });
  mock.method(QuizGameAttempt, "find", () => query([attempt("student", { rank: 7 })]));
  const res = response();
  await controller.leaderboard({ ...req(), user: { _id: "student", role: "student" } }, res);
  assert.equal(findGame.mock.callCount(), 0);
  assert.equal(res.body[0].rank, 1);
  assert.equal(res.body[0].isCurrentStudent, true);
});

test("both leaderboards isolate every metric and rank when the same students complete another game", async () => {
  const otherGameId = "507f1f77bcf86cd799439013";
  const records = [
    attempt("a", { student: { _id: "same-student", name: "Same Student" }, score: 50, accuracy: 25, completionTime: 40 }),
    attempt("b", { score: 100, accuracy: 50, completionTime: 20 }),
    attempt("c", { quizGame: otherGameId, student: { _id: "same-student", name: "Same Student" }, score: 9000, accuracy: 100, completionTime: 1 }),
    attempt("pending", { quizGame: otherGameId, score: 10000, completedAt: null }),
  ];
  mock.method(QuizGame, "findOne", (filter) => {
    assert.equal(filter.teacher, teacher);
    return query({ ...game, _id: filter._id });
  });
  mock.method(QuizGameAttempt, "find", (filter) => {
    assert.ok([gameId, otherGameId].includes(filter.quizGame));
    assert.deepEqual(filter.completedAt, { $ne: null });
    return query(records.filter((row) => row.quizGame === filter.quizGame && row.completedAt));
  });
  const read = async (handler, id) => {
    const res = response();
    await handler({ ...req(), params: { id } }, res);
    return res.body.leaderboard || res.body;
  };
  for (const handler of [controller.leaderboard, controller.teacherLeaderboard]) {
    const before = await read(handler, gameId);
    assert.deepEqual(before.map(({ rank, score, accuracy, completionTime }) => ({ rank, score, accuracy, completionTime })), [
      { rank: 1, score: 100, accuracy: 50, completionTime: 20 },
      { rank: 2, score: 50, accuracy: 25, completionTime: 40 },
    ]);
    records.find((row) => row._id === "pending").completedAt = new Date();
    const other = await read(handler, otherGameId);
    assert.deepEqual(other.map((row) => row._id), ["pending", "c"]);
    assert.deepEqual(await read(handler, gameId), before);
    records.find((row) => row._id === "pending").completedAt = null;
  }
});

test("teacher result routes reject student and admin roles before invoking their handlers", async () => {
  const router = require("../routes/quizGameRoutes");
  for (const routePath of ["/:id/results", "/:id/teacher-leaderboard", "/attempts/:attemptId"]) {
    const route = router.stack.find((layer) => layer.route?.path === routePath).route;
    const authorize = route.stack[0].handle;
    for (const role of ["student", "admin"]) {
      const res = response();
      authorize({ user: { role } }, res, () => assert.fail("Unauthorized role reached teacher handler"));
      assert.equal(res.statusCode, 403);
    }
  }
});
