const { test, mock } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const assessment = { _id: "quiz", title: "Quiz", status: "published", studentStatus: "Not Started", canSubmit: true,
  assessmentType: "quiz", numberOfQuestions: 1, durationMinutes: 30, questions: [{ _id: "question", type: "identification", text: "Answer", points: 1 }] };
const submitted = { _id: "saved", assessment: "quiz", status: "submitted", aiGradingStatus: "processing", score: null, percentage: null };
const graded = { ...submitted, status: "graded", aiGradingStatus: "completed", score: 0, percentage: 0, totalPossiblePoints: 1 };
const subjectData = (submissions = []) => ({ subject: { _id: "subject", name: "Science", teacher: { name: "Teacher" } }, summary: {}, assessments: [assessment, { ...assessment, _id: "exam", title: "Exam" }], submissions, feedback: [] });

async function mount(file, component, initialData, props = {}, overrides = {}, storage = new Map()) {
  const { transformWithOxc } = await import("../../client/node_modules/vite/dist/node/index.js");
  const { studentAssessmentSubmission } = await import("../../client/src/services/studentAssessmentSubmission.js");
  const grade = await import("../../client/src/services/gradeDisplay.js");
  const source = fs.readFileSync(path.join(__dirname, `../../client/src/pages/student/${file}.jsx`), "utf8")
    .replace(/^import .*;\r?\n/gm, "").replace("export default function", "function");
  const compiled = (await transformWithOxc(source, `${file}.jsx`, { jsx: { runtime: "classic", pragma: "h" } })).code;
  const states = [], effects = [], setters = [], intervals = new Set(), listeners = new Map(), timeouts = new Set();
  let index = 0, dirty = false, pendingEffects = [], tree;
  let serverData = structuredClone(initialData);
  const h = (type, props, ...children) => typeof type === "function" ? type({ ...props, children }) : ({ type, props: props || {}, children: children.flat(Infinity) });
  const api = {
    async subjectDetails() { return structuredClone(serverData); },
    async studentAssessments() { return structuredClone(serverData); },
    async submission() { return structuredClone(serverData); },
    async studentAssessment() { return structuredClone(assessment); },
    async assessmentInstructions() { const { questions, ...details } = structuredClone(assessment); return details; },
    async startAssessment() { const now = new Date(); return { _id: "session", startedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 1800000).toISOString(), serverNow: now.toISOString() }; },
    ...overrides,
  };
  const dependencies = {
    h, React: { Fragment: "Fragment" }, api, studentAssessmentSubmission, ...grade,
    Panel: "Panel", SimpleTable: "SimpleTable", LoadingState: "LoadingState", PageHeader: "PageHeader", StatusBadge: "StatusBadge",
    AssessmentResults: "AssessmentResults", StudentAssessments: "StudentAssessments",
    ArrowLeft: "ArrowLeft", ArrowRight: "ArrowRight", CheckCircle2: "CheckCircle2", Clock: "Clock", FileText: "FileText", Info: "Info", LoaderCircle: "LoaderCircle",
    subjectGradeDisplay: () => ({}),
    useState(initial) {
      const key = index++;
      if (!(key in states)) states[key] = typeof initial === "function" ? initial() : initial;
      setters[key] ||= (next) => { const value = typeof next === "function" ? next(states[key]) : next; if (!Object.is(value, states[key])) { states[key] = value; dirty = true; } };
      return [states[key], setters[key]];
    },
    useRef(initial) { const key = index++; return states[key] || (states[key] = { current: initial }); },
    useMemo: (factory) => factory(),
    useEffect(callback, deps) {
      const key = index++, previous = effects[key];
      if (!previous || deps.some((value, offset) => !Object.is(value, previous.deps[offset]))) pendingEffects.push(() => {
        previous?.cleanup?.(); effects[key] = { deps, cleanup: callback() };
      });
    },
    useAsyncData() {
      const [data, setData] = dependencies.useState(structuredClone(initialData));
      return { data, setData, loading: false, error: "" };
    },
    window: {
      localStorage: { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) },
      confirm: () => true,
      setInterval(callback) { intervals.add(callback); return callback; }, clearInterval(callback) { intervals.delete(callback); },
      setTimeout(callback) { timeouts.add(callback); return callback; }, clearTimeout(callback) { timeouts.delete(callback); },
      addEventListener(event, callback) { listeners.set(event, callback); }, removeEventListener(event) { listeners.delete(event); },
    },
  };
  const instructionsSource = fs.readFileSync(path.join(__dirname, "../../client/src/pages/student/AssessmentInstructions.jsx"), "utf8")
    .replace(/^import .*;\r?\n/gm, "").replace("export default function", "function");
  const instructionsCode = (await transformWithOxc(instructionsSource, "AssessmentInstructions.jsx", { jsx: { runtime: "classic", pragma: "h" } })).code;
  dependencies.AssessmentInstructions = new Function(...Object.keys(dependencies), `${instructionsCode}; return AssessmentInstructions;`)(...Object.values(dependencies));
  const Component = new Function(...Object.keys(dependencies), `${compiled}; return ${component};`)(...Object.values(dependencies));
  function render() {
    let count = 0;
    do {
      dirty = false; index = 0; pendingEffects = [];
      tree = Component(props);
      for (const effect of pendingEffects) effect();
      assert.ok(++count < 30, "Render must settle");
    } while (dirty);
  }
  async function flush() { for (let step = 0; step < 40; step++) { await Promise.resolve(); if (dirty) render(); } }
  const nodes = (node) => !node || typeof node !== "object" ? [] : [node, ...node.children.flatMap((child) => nodes(child))];
  const text = (node) => node && typeof node === "object" ? node.children.map(text).join("") : typeof node === "boolean" ? "" : String(node ?? "");
  const find = (predicate) => nodes(tree).find(predicate);
  const button = (label) => find((node) => node.type === "button" && text(node) === label);
  const table = () => find((node) => node.type === "SimpleTable");
  function unmount() { for (const effect of effects) effect?.cleanup?.(); }
  render(); await flush();
  return { api, find, text, button, table, flush, unmount, intervals, listeners, timeouts, storage, allText: () => text(tree), setServerData(data) { serverData = structuredClone(data); }, async poll() { const callbacks = [...timeouts]; timeouts.clear(); for (const callback of callbacks) await callback(); await flush(); } };
}

test("submission labels distinguish missing, incomplete, pending and finalized records, including zero grades", async () => {
  const { studentAssessmentSubmission: state } = await import("../../client/src/services/studentAssessmentSubmission.js");
  for (const record of [null, { ...submitted, status: "pending" }, { ...graded, assessment: "other" }]) {
    const result = state(assessment, record ? [record] : []);
    assert.equal(result.submissionStatus, "Not Submitted");
    assert.equal(result.actionLabel, "Open Assessment");
  }
  assert.equal(state(assessment, [submitted]).actionLabel, "View Results");
  assert.equal(state(assessment, [graded]).actionLabel, "View Results");
  assert.equal(state(assessment, [{ ...graded, score: null }]).resultsAvailable, true);
  assert.equal(state(assessment, [{ ...graded, aiGradingStatus: "pending_review" }]).resultsAvailable, true);
});

test("subject assessment table preserves its columns and opens pending as well as finalized results", async () => {
  const page = await mount("MySubjects", "StudentSubjectDetails", subjectData([graded]), { subjectId: "subject" });
  page.button("Assessments").props.onClick(); await page.flush();
  let table = page.table();
  assert.deepEqual(table.props.columns.map((column) => column.label), ["Assessment", "Type", "Due Date", "Status", "Action"]);
  const status = table.props.columns.find((column) => column.key === "status");
  const action = table.props.columns.find((column) => column.key === "action");
  assert.deepEqual(table.props.rows.map(status.render), ["Submitted", "Not Submitted"]);
  assert.equal(page.text(action.render(table.props.rows[0])), "View Results");
  assert.equal(page.text(action.render(table.props.rows[1])), "Open Assessment");
  action.render(table.props.rows[0]).props.onClick(); await page.flush();
  const results = page.find((node) => node.type === "AssessmentResults");
  assert.equal(results.props.submissionId, "saved");
  results.props.onBack(); await page.flush();
  page.setServerData(subjectData([submitted]));
  await page.listeners.get("focus")(); await page.flush();
  table = page.table();
  const pendingAction = table.props.columns.find((column) => column.key === "action").render(table.props.rows[0]);
  assert.equal(page.text(pendingAction), "View Results");
  assert.equal(pendingAction.props.disabled, false);
  pendingAction.props.onClick(); await page.flush();
  assert.equal(page.find((node) => node.type === "AssessmentResults").props.submissionId, "saved");
  page.unmount(); assert.equal(page.intervals.size, 0); assert.equal(page.listeners.size, 0);
});

test("embedded successful submission updates the assessment table immediately without a database refresh", async () => {
  const page = await mount("MySubjects", "StudentSubjectDetails", subjectData(), { subjectId: "subject" });
  page.button("Assessments").props.onClick(); await page.flush();
  const table = page.table();
  table.props.columns.find((column) => column.key === "action").render(table.props.rows[0]).props.onClick(); await page.flush();
  const taking = page.find((node) => node.type === "StudentAssessments");
  assert.equal(taking.props.initialAssessmentId, "quiz");
  // Hold the refresh so the displayed change must come from the successful POST.
  page.api.subjectDetails = () => new Promise(() => {});
  taking.props.onSubmitted("quiz", submitted); await page.flush();
  assert.equal(page.find((node) => node.type === "AssessmentResults").props.submissionId, "saved");
  assert.equal(page.find((node) => node.type === "AssessmentResults").props.initialSubmission.aiGradingStatus, "processing");
  page.find((node) => node.type === "AssessmentResults").props.onBack(); await page.flush();
  const updated = page.table();
  assert.equal(updated.props.columns.find((column) => column.key === "status").render(updated.props.rows[0]), "Submitted");
  const action = updated.props.columns.find((column) => column.key === "action").render(updated.props.rows[0]);
  assert.equal(page.text(action), "View Results"); assert.equal(action.props.disabled, false);
  assert.equal(updated.props.rows[1].submissionStatus, "Not Submitted");
  page.unmount();
});

test("standalone submission blocks double clicks and opens the saved results immediately during grading", async () => {
  let release, posts = 0;
  const page = await mount("StudentAssessments", "StudentAssessments", [assessment], {}, {
    submitAssessment() { posts++; return new Promise((resolve) => { release = resolve; }); },
  });
  const card = page.find((node) => node.type === "button" && page.text(node).includes("Open Assessment"));
  card.props.onClick(); await page.flush();
  await page.button("Start Assessment").props.onClick(); await page.flush();
  page.find((node) => node.type === "textarea").props.onChange({ target: { value: "Student answer" } }); await page.flush();
  const form = page.find((node) => node.type === "form");
  const event = { preventDefault() {}, currentTarget: { supportingDocument: { files: [] } } };
  const first = form.props.onSubmit(event);
  await form.props.onSubmit(event);
  assert.equal(posts, 1);
  release(submitted); await first; await page.flush();
  const results = page.find((node) => node.type === "AssessmentResults");
  assert.equal(results.props.submissionId, "saved");
  assert.equal(results.props.initialSubmission.aiGradingStatus, "processing");
  results.props.onBack(); await page.flush();
  const pending = page.find((node) => node.type === "button" && !node.props.disabled && page.text(node).includes("View Results"));
  assert.ok(pending);
  assert.equal(page.find((node) => node.type === "StatusBadge").props.label, "Submitted");
  assert.equal(page.find((node) => node.type === "AssessmentResults"), undefined);
  page.setServerData([{ ...assessment, canSubmit: false, studentStatus: "Completed", previousSubmission: graded }]);
  await page.listeners.get("focus")(); await page.flush();
  const resultsCard = page.find((node) => node.type === "button" && page.text(node).includes("View Results"));
  assert.ok(resultsCard); resultsCard.props.onClick(); await page.flush();
  assert.equal(page.find((node) => node.type === "AssessmentResults").props.submissionId, "saved");
  page.unmount();
});

test("results poll through grading and overall feedback without hiding available scores or questions", async () => {
  const meta = { _id: "quiz", title: "Matter", subject: "Science", allowAnswerReview: true };
  const pending = { ...submitted, assessment: meta, overallFeedback: { status: "waiting_for_grading" } };
  const page = await mount("AssessmentResults", "AssessmentResults", pending, { submissionId: "saved", initialSubmission: pending });
  assert.match(page.allText(), /being evaluated by GradeSense AI/);
  assert.equal(page.timeouts.size, 1);
  const ready = { ...graded, assessment: meta, overallFeedback: { status: "processing" }, answers: [{ question: "q", questionText: "Describe matter", answer: "My saved answer", score: 0, pointsPossible: 1, isCorrect: false, correctAnswer: "Matter has mass", feedback: "Review mass" }] };
  page.setServerData(ready); await page.poll();
  assert.match(page.allText(), /analyzing your answers and preparing your overall feedback/);
  assert.match(page.allText(), /0\/1/); assert.match(page.allText(), /0%/);
  assert.match(page.allText(), /My saved answer/); assert.match(page.allText(), /Matter has mass/);
  assert.equal(page.timeouts.size, 1);
  page.setServerData({ ...ready, overallFeedback: { status: "completed", summary: "Your response missed the role of mass.", weaknesses: ["Mass was missing."], recommendations: ["Review mass and volume."], strengths: [] } });
  await page.poll();
  assert.match(page.allText(), /Your response missed/); assert.match(page.allText(), /Areas for Improvement/);
  assert.doesNotMatch(page.allText(), /Strengths/);
  assert.ok(page.allText().indexOf("Your response missed") < page.allText().indexOf("Score:"));
  assert.equal(page.timeouts.size, 0);
  page.unmount();
});

test("partial results survive page refresh, poll teacher review, and refresh as final results", async () => {
  const partial = { ...submitted, aiGradingStatus: "pending_review", assessment: { title: "Mixed quiz", subject: "Science" },
    totalPossiblePoints: 15, gradedPointsEarned: 2, gradedPossiblePoints: 5, gradedQuestionCount: 2, pendingQuestionCount: 1,
    finalScore: null, finalPercentage: null, overallFeedback: { status: "waiting_for_grading" }, answers: [
      { question: "mc", questionType: "multiple_choice", questionText: "Choose", answer: "A", score: 2, finalScore: 2, pointsPossible: 2, aiStatus: "not_applicable", isCorrect: true },
      { question: "tf", questionType: "true_false", questionText: "True or false", answer: "True", score: 0, finalScore: 0, pointsPossible: 3, aiStatus: "not_applicable", isCorrect: false },
      { question: "essay", questionType: "essay", questionText: "Explain", answer: "Saved essay", score: null, finalScore: null, pointsPossible: 10, aiStatus: "pending_review" },
    ] };
  let page = await mount("AssessmentResults", "AssessmentResults", partial, { submissionId: "saved", initialSubmission: partial });
  assert.match(page.allText(), /2\/5 \(Partial Result\)/);
  assert.match(page.allText(), /Score: 0\/3/);
  assert.doesNotMatch(page.allText(), /%/);
  assert.equal(page.find((node) => node.type === "PageHeader").props.actions.props.label, "Partial Result");
  assert.equal(page.find((node) => node.type === "StatusBadge" && node.props.value === "Pending").props.label, "Pending Teacher Review");
  page.unmount();
  page = await mount("AssessmentResults", "AssessmentResults", partial, { submissionId: "saved" });
  assert.match(page.allText(), /2\/5 \(Partial Result\)/);
  assert.match(page.allText(), /Saved essay/);
  assert.equal(page.timeouts.size, 1);
  const final = { ...partial, status: "graded", aiGradingStatus: "completed", gradedBy: "teacher", pendingQuestionCount: 0,
    gradedPointsEarned: 10, gradedPossiblePoints: 15, gradedQuestionCount: 3,
    finalScore: 10, finalPercentage: 10 / 15 * 100, overallFeedback: { status: "completed", summary: "Reviewed." },
    answers: partial.answers.map((answer) => answer.question === "essay"
      ? { ...answer, score: 8, finalScore: 8, aiStatus: "teacher_reviewed", teacherFeedback: "Clear reasoning." } : answer) };
  page.setServerData(final); await page.poll();
  assert.match(page.allText(), /10\/15/); assert.match(page.allText(), /66.67%/);
  assert.match(page.allText(), /Clear reasoning/);
  assert.equal(page.find((node) => node.type === "PageHeader").props.actions.props.label, "Completed");
  assert.equal(page.timeouts.size, 0);
  page.unmount();
  page = await mount("AssessmentResults", "AssessmentResults", final, { submissionId: "saved" });
  assert.match(page.allText(), /10\/15/); assert.match(page.allText(), /66.67%/);
  assert.match(page.allText(), /Saved essay/); assert.match(page.allText(), /Clear reasoning/);
  page.unmount();
});

test("pending results with answer review disabled still show saved partial totals", async () => {
  const partial = { ...submitted, aiGradingStatus: "pending_review", assessment: { allowAnswerReview: false },
    gradedPointsEarned: 0, gradedPossiblePoints: 5, gradedQuestionCount: 2, pendingQuestionCount: 1, answers: [],
    overallFeedback: { status: "waiting_for_grading" } };
  const page = await mount("AssessmentResults", "AssessmentResults", partial, { submissionId: "saved" });
  assert.match(page.allText(), /0\/5 \(Partial Result\)/);
  assert.doesNotMatch(page.allText(), /%/);
  assert.equal(page.timeouts.size, 1);
  page.unmount();
});

test("failed feedback offers a retry while scores remain visible and resumes automatic polling", async () => {
  let retries = 0;
  const ready = { ...graded, overallFeedback: { status: "failed", message: "Feedback is unavailable." } };
  const page = await mount("AssessmentResults", "AssessmentResults", ready, { submissionId: "saved", initialSubmission: ready }, {
    async retryOverallFeedback(id) { assert.equal(id, "saved"); retries++; return { ...ready, overallFeedback: { status: "processing" } }; },
  });
  assert.match(page.allText(), /Feedback is unavailable/); assert.match(page.allText(), /0\/1/);
  page.setServerData({ ...ready, overallFeedback: { status: "processing" } });
  await page.button("Retry overall feedback").props.onClick(); await page.flush();
  assert.equal(retries, 1); assert.equal(page.timeouts.size, 1);
  assert.match(page.allText(), /preparing your overall feedback/);
  page.unmount(); assert.equal(page.timeouts.size, 0);
});

test("results preserve saved data during read failures and stop polling on unmount", async () => {
  const ready = { ...graded, overallFeedback: { status: "completed", summary: "Saved summary" } };
  const page = await mount("AssessmentResults", "AssessmentResults", ready, { submissionId: "saved", initialSubmission: ready }, {
    async submission() { throw new Error("Connection lost"); },
  });
  assert.match(page.allText(), /Connection lost/); assert.match(page.allText(), /0\/1/);
  assert.match(page.allText(), /Saved summary/); assert.ok(page.button("Retry loading results"));
  assert.equal(page.timeouts.size, 1);
  page.unmount(); assert.equal(page.timeouts.size, 0);
});

test("a saved submission recovered after a lost response opens results without submitting twice", async () => {
  let posts = 0;
  const page = await mount("StudentAssessments", "StudentAssessments", [assessment], { initialAssessmentId: "quiz" }, {
    async submitAssessment() { posts++; throw Object.assign(new Error("Response lost"), { submissionId: "saved" }); },
    async submission(id) { assert.equal(id, "saved"); return submitted; },
  });
  await page.button("Start Assessment").props.onClick(); await page.flush();
  page.find((node) => node.type === "textarea").props.onChange({ target: { value: "My answer" } }); await page.flush();
  await page.find((node) => node.type === "form").props.onSubmit({ preventDefault() {} }); await page.flush();
  assert.equal(page.find((node) => node.type === "AssessmentResults").props.submissionId, "saved");
  assert.equal(posts, 1);
  page.unmount();
});

test("opening and leaving instructions never starts an attempt, fetches questions, or runs a countdown", async () => {
  let starts = 0, questionReads = 0;
  const page = await mount("StudentAssessments", "StudentAssessments", [assessment], {}, {
    startAssessment() { starts++; throw new Error("Must not start while reading"); },
    studentAssessment() { questionReads++; throw new Error("Must not load questions while reading"); },
    async assessmentInstructions() { return { ...assessment, questions: undefined, attemptLimit: 1, durationMinutes: 40, numberOfQuestions: 18 }; },
  });
  page.find((node) => node.type === "button" && page.text(node).includes("Open Assessment")).props.onClick(); await page.flush();
  assert.match(page.allText(), /Assessment Instructions/);
  assert.match(page.allText(), /18 items/); assert.match(page.allText(), /40 minutes/);
  assert.match(page.allText(), /1 attempt/); assert.match(page.allText(), /cannot be retaken/);
  assert.match(page.allText(), /AI-Powered Grading Notice/); assert.match(page.allText(), /Essay and open-ended/);
  assert.equal(page.find((node) => node.type === "form"), undefined);
  assert.equal(page.find((node) => node.type === "textarea"), undefined);
  assert.equal(page.intervals.size, 1); // Status refresh only.
  assert.equal(page.storage.size, 0);
  page.button("Back to Assessments").props.onClick(); await page.flush();
  assert.ok(page.find((node) => node.type === "button" && page.text(node).includes("Open Assessment")));
  assert.equal(starts, 0); assert.equal(questionReads, 0);
  page.unmount();
});

test("Start blocks duplicate clicks and the timer catches up after skipped background ticks", async () => {
  let release, starts = 0, monotonic = 0;
  mock.method(performance, "now", () => monotonic);
  const base = Date.parse("2026-11-01T10:00:00Z");
  const attempt = { _id: "session", startedAt: new Date(base).toISOString(), expiresAt: new Date(base + 1800000).toISOString(), serverNow: new Date(base).toISOString() };
  let page;
  try {
    page = await mount("StudentAssessments", "StudentAssessments", [assessment], { initialAssessmentId: "quiz" }, {
      startAssessment() { starts++; return new Promise((resolve) => { release = resolve; }); },
    });
    const start = page.button("Start Assessment");
    const pending = start.props.onClick(); await page.flush();
    assert.equal(page.button("Starting Assessment…").props.disabled, true);
    await start.props.onClick(); assert.equal(starts, 1);
    release(attempt); await pending; await page.flush();
    assert.ok(page.find((node) => node.type === "textarea"));
    assert.match(page.allText(), /30:00/); assert.equal(page.intervals.size, 2);
    monotonic = 65000;
    for (const callback of page.intervals) await callback();
    await page.flush();
    assert.match(page.allText(), /28:55/);
  } finally { page?.unmount(); mock.restoreAll(); }
});

test("refresh resumes the original timer and locally saved answers through instructions", async () => {
  const base = Date.parse("2026-11-01T10:00:00Z");
  const storage = new Map(); let elapsed = 0;
  const overrides = { async startAssessment() { return { _id: "persistent-session", startedAt: new Date(base).toISOString(), expiresAt: new Date(base + 1800000).toISOString(), serverNow: new Date(base + elapsed).toISOString() }; } };
  let page = await mount("StudentAssessments", "StudentAssessments", [assessment], { initialAssessmentId: "quiz" }, overrides, storage);
  await page.button("Start Assessment").props.onClick(); await page.flush();
  page.find((node) => node.type === "textarea").props.onChange({ target: { value: "Saved answer" } }); await page.flush();
  assert.equal(JSON.parse(storage.get("gradesense-assessment-draft:persistent-session")).answers.question, "Saved answer");
  page.unmount(); elapsed = 300000;
  page = await mount("StudentAssessments", "StudentAssessments", [assessment], { initialAssessmentId: "quiz" }, overrides, storage);
  assert.ok(page.button("Start Assessment")); assert.equal(page.intervals.size, 1);
  await page.button("Start Assessment").props.onClick(); await page.flush();
  assert.equal(page.find((node) => node.type === "textarea").props.value, "Saved answer");
  assert.match(page.allText(), /25:00/);
  page.unmount();
});

test("instructions reflect configured windows, multiple attempts and navigation rules", async () => {
  for (const attemptLimit of [3, 0]) {
    const page = await mount("StudentAssessments", "StudentAssessments", [assessment], { initialAssessmentId: "quiz" }, {
      async assessmentInstructions() { return { ...assessment, questions: undefined, attemptLimit, lockPreviousQuestions: true,
        startDate: "2026-11-01T00:00:00Z", dueDate: "2026-11-15T00:00:00Z", endDate: "2026-11-16T00:00:00Z" }; },
    });
    assert.doesNotMatch(page.allText(), /cannot be retaken/);
    assert.match(page.allText(), attemptLimit ? /3 attempts/ : /Unlimited/);
    assert.match(page.allText(), /Available From/); assert.match(page.allText(), /Submissions Close/);
    assert.match(page.allText(), /allows submissions after the due date/);
    assert.match(page.allText(), /cannot change previous answers/);
    page.unmount();
  }
});

test("unavailable cards still open instructions with a disabled Start button and a clear reason", async () => {
  let starts = 0;
  const closed = { ...assessment, canSubmit: false, canStart: false, studentStatus: "Missing", startBlockedReason: "The submission deadline has passed." };
  const page = await mount("StudentAssessments", "StudentAssessments", [closed], {}, {
    async assessmentInstructions() { return closed; },
    startAssessment() { starts++; },
  });
  const card = page.find((node) => node.type === "button" && page.text(node).includes("Open Assessment"));
  assert.equal(card.props.disabled, false);
  card.props.onClick(); await page.flush();
  const start = page.button("Start Assessment");
  assert.equal(start.props.disabled, true); assert.match(page.allText(), /deadline has passed/);
  await start.props.onClick(); assert.equal(starts, 0);
  page.unmount();
});

test("a deadline passing while instructions are open is rechecked at Start without exposing questions", async () => {
  let reads = 0;
  const page = await mount("StudentAssessments", "StudentAssessments", [assessment], { initialAssessmentId: "quiz" }, {
    async assessmentInstructions() { reads++; return { ...assessment, canStart: reads === 1, canSubmit: reads === 1, startBlockedReason: reads > 1 ? "The deadline has passed." : "" }; },
    async startAssessment() { throw new Error("The deadline has passed."); },
  });
  await page.button("Start Assessment").props.onClick(); await page.flush();
  assert.equal(page.button("Start Assessment").props.disabled, true);
  assert.match(page.allText(), /deadline has passed/);
  assert.equal(page.find((node) => node.type === "textarea"), undefined);
  assert.equal(page.intervals.size, 1);
  page.unmount();
});
