const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const games = [
  { _id: "one", title: "First Game", completed: true, showLeaderboard: true, questions: [], participants: 5 },
  { _id: "two", title: "Second Game", completed: true, showLeaderboard: true, questions: [], participants: 1 },
];
const rankings = {
  one: Array.from({ length: 5 }, (_, index) => ({
    _id: `first-${index}`, rank: index + 1, student: { name: `First Player ${index + 1}` },
    score: 500 - index * 100, accuracy: 100 - index * 10, completionTime: 61 + index,
  })),
  two: [{ _id: "second", rank: 1, student: { name: "Second Player" }, score: 9000, accuracy: 75, completionTime: 9 }],
};

async function mount({ props = {}, ...overrides } = {}) {
  const { transformWithOxc } = await import("../../client/node_modules/vite/dist/node/index.js");
  const source = fs.readFileSync(path.join(__dirname, "../../client/src/pages/student/StudentQuizGames.jsx"), "utf8");
  const code = (await transformWithOxc(source.replace(/^import .*;\r?\n/gm, "").replace("export default function", "function"), "StudentQuizGames.jsx", { jsx: { runtime: "classic", pragma: "h" } })).code;
  const states = [], effects = [], calls = [];
  let index = 0, dirty = false, tree, pending = [];
  const api = {
    async quizGameStudentDashboard() { return { games, recentGames: [], stats: {} }; },
    async quizGameStudentResult(id) {
      return { game: games.find((game) => game._id === id), result: { score: 500, accuracy: 100, correctAnswers: 5, completionTime: 61, rank: 1 } };
    },
    async quizGameLeaderboard(id) { calls.push(id); return rankings[id] || []; },
    ...overrides,
  };
  const dependencies = {
    h: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    React: { Fragment: "fragment" }, api,
    document: { getElementById: () => null },
    useQuizGameSounds: () => ({ stopAll() {}, stopMusic() {}, play() {} }),
    useMemo: (callback) => callback(),
    useRef(initial) { const key = index++; return states[key] ||= { current: initial }; },
    useState(initial) {
      const key = index++;
      if (!(key in states)) states[key] = initial;
      return [states[key], (next) => { states[key] = typeof next === "function" ? next(states[key]) : next; dirty = true; }];
    },
    useEffect(callback, deps) {
      const key = index++;
      const previous = effects[key];
      if (!previous || deps.some((value, offset) => !Object.is(value, previous.deps[offset]))) {
        pending.push(() => { previous?.cleanup?.(); effects[key] = { deps, cleanup: callback() }; });
      }
    },
  };
  for (const name of ["ArrowLeft", "CheckCircle2", "Clock", "Gamepad2", "Medal", "Play", "Target", "Trophy", "Volume2", "VolumeX", "Zap", "PageHeader", "Panel", "BrandLogo"]) dependencies[name] = name;
  const Component = new Function(...Object.keys(dependencies), `${code}; return StudentQuizGames;`)(...Object.values(dependencies));
  const render = () => { index = 0; dirty = false; pending = []; tree = Component(props); for (const effect of pending) effect(); };
  async function flush() { for (let step = 0; step < 50; step++) { await Promise.resolve(); if (dirty) render(); } }
  const nodes = (node) => node && typeof node === "object" ? [node, ...node.children.flatMap(nodes)] : [];
  const text = (node) => node && typeof node === "object" ? node.children.map(text).join("") : typeof node === "boolean" ? "" : String(node ?? "");
  async function click(label, offset = 0) {
    const button = nodes(tree).filter((node) => node.type === "button" && text(node) === label)[offset];
    assert.ok(button, `Missing ${label}`);
    await button.props.onClick();
    await flush();
  }
  async function select(id) {
    const selector = nodes(tree).find((node) => node.props["aria-label"] === "Quiz Game leaderboard");
    assert.ok(selector);
    selector.props.onChange({ target: { value: id } });
    await flush();
  }
  render(); await flush();
  return { calls, click, select, flush, nodes: () => nodes(tree), text: () => text(tree) };
}

test("completed cards link above Completed to their own leaderboard and retain ranking card styling", async () => {
  const ui = await mount();
  const nodes = ui.nodes();
  assert.ok(nodes.findIndex((node) => node.type === "button" && node.children.includes("VIEW LEADERBOARD")) < nodes.findIndex((node) => node.type === "span" && node.children.includes("Completed")));
  await ui.click("VIEW LEADERBOARD");
  assert.deepEqual(ui.calls, ["one"]);
  assert.match(ui.text(), /First Player 1/);
  assert.match(ui.text(), /First Player 5/);
  assert.match(ui.text(), /500 XP100% accuracy - 1:01/);
  assert.doesNotMatch(ui.text(), /Second Player/);
  assert.ok(ui.nodes().some((node) => node.props.className === "grid gap-4 md:grid-cols-3"));
  assert.ok(ui.nodes().some((node) => node.props.className === "rounded-2xl border p-5 text-center border-yellow-400/50 bg-yellow-400/10 md:-mt-4"));
  assert.equal(ui.nodes().filter((node) => node.type === "Medal").length, 3);
  await ui.click("Game Lobby");
  await ui.click("VIEW LEADERBOARD", 1);
  assert.deepEqual(ui.calls, ["one", "two"]);
  assert.match(ui.text(), /Second Player/);
  assert.doesNotMatch(ui.text(), /First Player/);
});

test("reopened completed games display their rankings above the unchanged completion panel", async () => {
  const ui = await mount({ props: { initialView: "complete", initialGameId: "one" } });
  assert.deepEqual(ui.calls, ["one"]);
  const text = ui.text();
  assert.ok(text.indexOf("LEADERBOARD") < text.indexOf("Challenge Complete"));
  assert.ok(text.indexOf("First Player 5") < text.indexOf("COMPLETED"));
  assert.match(text, /Final Score/);
  const completed = ui.nodes().find((node) => node.type === "button" && node.props.disabled);
  assert.equal(completed.props.className, "cursor-not-allowed rounded-xl bg-green-500/20 px-5 py-3 font-black text-green-100");
});

test("the Leaderboard navigation loads a game and selection replaces its rankings", async () => {
  const ui = await mount();
  await ui.click("Leaderboard");
  assert.deepEqual(ui.calls, ["one"]);
  await ui.select("two");
  assert.deepEqual(ui.calls, ["one", "two"]);
  assert.match(ui.text(), /Second Player/);
  assert.doesNotMatch(ui.text(), /First Player/);
  await ui.select("one");
  assert.match(ui.text(), /First Player 1/);
  assert.doesNotMatch(ui.text(), /Second Player/);
});

test("late responses from another game cannot overwrite the selected leaderboard", async () => {
  let finishFirst;
  const ui = await mount({
    props: { initialView: "leaderboard", initialGameId: "one" },
    quizGameLeaderboard(id) { return id === "one" ? new Promise((resolve) => { finishFirst = resolve; }) : Promise.resolve(rankings.two); },
  });
  await ui.select("two");
  assert.match(ui.text(), /Second Player/);
  finishFirst(rankings.one);
  await ui.flush();
  assert.match(ui.text(), /Second Player/);
  assert.doesNotMatch(ui.text(), /First Player/);
});

test("empty and failed leaderboards clear the previous game's players", async () => {
  const ui = await mount({ async quizGameLeaderboard(id) { return id === "one" ? rankings.one : []; } });
  await ui.click("Leaderboard");
  await ui.select("two");
  assert.match(ui.text(), /No completed attempts yet/);
  assert.doesNotMatch(ui.text(), /First Player/);
  const failed = await mount({ async quizGameLeaderboard(id) { if (id === "two") throw new Error("Leaderboard unavailable"); return rankings.one; } });
  await failed.click("Leaderboard");
  await failed.select("two");
  assert.match(failed.text(), /Leaderboard unavailable/);
  assert.doesNotMatch(failed.text(), /First Player/);
});
