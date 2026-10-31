const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const games = [{ _id: "one", title: "First Game", participants: 2, status: "completed" }, { _id: "two", title: "Second Game", participants: 0 }];
async function mount(overrides = {}) {
  const { transformWithOxc } = await import("../../client/node_modules/vite/dist/node/index.js");
  const source = fs.readFileSync(path.join(__dirname, "../../client/src/pages/teacher/TeacherQuizGame.jsx"), "utf8");
  const code = (await transformWithOxc(source.replace(/^import .*;\r?\n/gm, "").replace("export default function", "function"), "TeacherQuizGame.jsx", { jsx: { runtime: "classic", pragma: "h" } })).code;
  const states = [], effects = [];
  let index = 0, dirty = false, tree, pending = [];
  const calls = [];
  const rows = [{ _id: "attempt", student: { name: "Recorded Student" }, score: 0, status: "completed", rank: 1, accuracy: 0 },
    { _id: "pending", student: { name: "Pending Student" }, score: 0, status: "in_progress", rank: null }];
  const api = {
    async quizGameTeacherDashboard() { return { games, summary: {} }; },
    async quizGameResults(id) { calls.push(["results", id]); return { game: games.find((game) => game._id === id), summary: {}, results: id === "one" ? rows : [] }; },
    async quizGameTeacherLeaderboard(id) { calls.push(["leaderboard", id]); return { game: games.find((game) => game._id === id), leaderboard: id === "one" ? rows.slice(0, 1) : [] }; },
    async quizGame(id) { calls.push(["game", id]); return { ...games.find((game) => game._id === id), questions: [] }; },
    async quizGameAttemptDetail(id) { calls.push(["attempt", id]); return { attempt: rows[0], questions: [{ question: "Recorded question", selectedAnswer: "Recorded answer", isCorrect: false }] }; },
    ...overrides,
  };
  const dependencies = {
    h: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    api,
    useAsyncData: () => ({ data: [] }),
    useState(initial) {
      const key = index++;
      if (!(key in states)) states[key] = initial;
      return [states[key], (next) => { states[key] = typeof next === "function" ? next(states[key]) : next; dirty = true; }];
    },
    useEffect(callback) { const key = index++; if (!effects[key]) { effects[key] = true; pending.push(callback); } },
  };
  for (const name of ["Archive", "ArrowLeft", "BarChart3", "Edit3", "Eye", "Gamepad2", "Medal", "Plus", "Save", "Send", "Trash2", "Trophy", "Users", "XCircle", "BrandLogo"]) dependencies[name] = name;
  const Component = new Function(...Object.keys(dependencies), `${code}; return TeacherQuizGame;`)(...Object.values(dependencies));
  const render = () => { index = 0; dirty = false; pending = []; tree = Component({}); for (const effect of pending) effect(); };
  async function flush() { for (let step = 0; step < 30; step++) { await Promise.resolve(); if (dirty) render(); } }
  const nodes = (node) => node && typeof node === "object" ? [node, ...node.children.flatMap(nodes)] : [];
  const text = (node) => node && typeof node === "object" ? node.children.map(text).join("") : typeof node === "boolean" ? "" : String(node ?? "");
  const buttons = (label) => nodes(tree).filter((node) => node.type === "button" && text(node) === label);
  async function click(label, offset = 0) { const button = buttons(label)[offset]; assert.ok(button, `Missing ${label}`); const task = button.props.onClick(); if (dirty) render(); await task; await flush(); }
  render(); await flush();
  return { api, calls, buttons, click, text: () => text(tree), nodes: () => nodes(tree), flush };
}

test("each card retains VIEW GAME styling and destination while results and leaderboard load their selected games", async () => {
  const ui = await mount();
  assert.equal(ui.buttons("VIEW GAME").length, 2);
  assert.equal(ui.buttons("VIEW GAME")[0].props.className, "rounded-xl bg-[#FF6B00] px-4 py-2.5 text-sm font-black text-white hover:bg-[#D94F00]");
  await ui.click("VIEW RESULTS");
  assert.deepEqual(ui.calls, [["results", "one"]]);
  assert.match(ui.text(), /Recorded Student/);
  assert.match(ui.text(), /Pending Student/);
  assert.match(ui.text(), /In progress/);
  assert.equal(ui.buttons("View").length, 1);
  await ui.click("View");
  assert.match(ui.text(), /Recorded answer/);
  await ui.click("Lobby");
  await ui.click("LEADERBOARD");
  assert.deepEqual(ui.calls.at(-1), ["leaderboard", "one"]);
  assert.match(ui.text(), /Recorded Student/);
  assert.doesNotMatch(ui.text(), /Pending Student|Recorded answer/);
  await ui.click("Lobby");
  await ui.click("VIEW GAME", 1);
  assert.deepEqual(ui.calls.at(-1), ["game", "two"]);
  assert.match(ui.text(), /Manage Challenge/);
  assert.match(ui.text(), /Second Game/);
});

test("a completed teacher game places its leaderboard above its existing status", async () => {
  const ui = await mount();
  const nodes = ui.nodes();
  const leaderboardIndex = nodes.indexOf(ui.buttons("LEADERBOARD")[0]);
  const statusIndex = nodes.findIndex((node) => node.type === "span" && node.children.includes("completed"));
  assert.ok(leaderboardIndex > 0 && leaderboardIndex < statusIndex);
  assert.equal(ui.buttons("LEADERBOARD").length, 2);
  assert.equal(nodes[statusIndex].props.className, "rounded-full border border-[#FF6B00]/30 bg-[#FF6B00]/10 px-2.5 py-1 text-xs font-black uppercase text-[#FFB36B]");
});

test("opening a completed teacher game shows its existing leaderboard table above the status", async () => {
  const ui = await mount();
  await ui.click("VIEW GAME");
  assert.deepEqual(ui.calls, [["game", "one"], ["leaderboard", "one"]]);
  assert.match(ui.text(), /Recorded Student/);
  assert.doesNotMatch(ui.text(), /Pending Student/);
  assert.ok(ui.text().indexOf("Leaderboard") < ui.text().indexOf("Manage Challenge"));
  const nodes = ui.nodes();
  assert.ok(nodes.findIndex((node) => node.type === "table") < nodes.findIndex((node) => node.type === "span" && node.children.includes("completed")));
  assert.equal(nodes.find((node) => node.type === "table").props.className, "w-full min-w-[500px] text-left text-sm");
  await ui.click("Lobby");
  await ui.click("VIEW GAME", 1);
  assert.doesNotMatch(ui.text(), /Recorded Student/);
});

test("an unavailable inline leaderboard does not block the completed game or show another game's players", async () => {
  const ui = await mount({ async quizGameTeacherLeaderboard() { throw new Error("Unavailable"); } });
  await ui.click("VIEW GAME");
  assert.match(ui.text(), /Manage Challenge/);
  assert.match(ui.text(), /Unable to load quiz game leaderboard/);
  assert.doesNotMatch(ui.text(), /Recorded Student/);
});

test("switching games replaces old results and shows explicit empty result and leaderboard states", async () => {
  const ui = await mount();
  await ui.click("VIEW RESULTS");
  await ui.click("Lobby");
  await ui.click("VIEW RESULTS", 1);
  assert.deepEqual(ui.calls.at(-1), ["results", "two"]);
  assert.match(ui.text(), /Second Game/);
  assert.match(ui.text(), /No students have participated/);
  assert.doesNotMatch(ui.text(), /Recorded Student/);
  await ui.click("Lobby");
  await ui.click("LEADERBOARD", 1);
  assert.match(ui.text(), /Second Game/);
  assert.match(ui.text(), /No completed attempts yet/);
  assert.doesNotMatch(ui.text(), /Recorded Student/);
});

test("result and leaderboard read failures show the server error and leave loading cleared so teachers can retry", async () => {
  const ui = await mount({
    async quizGameResults() { throw new Error("Results access denied"); },
    async quizGameTeacherLeaderboard() { throw new Error("Leaderboard unavailable"); },
  });
  for (const [label, error] of [["VIEW RESULTS", /Results access denied/], ["LEADERBOARD", /Leaderboard unavailable/]]) {
    await ui.click(label);
    assert.match(ui.text(), error);
    assert.equal(ui.buttons("VIEW GAME").length, 2);
    assert.ok(!ui.nodes().some((node) => typeof node.type === "function" && node.type.name === "ArenaLoading"));
  }
});
