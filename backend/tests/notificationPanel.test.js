const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

let compiled;
async function mountPanel({ role = "student", notifications = [], overrides = {} } = {}) {
  if (!compiled) {
    const { transformWithOxc } = await import("../../client/node_modules/vite/dist/node/index.js");
    const source = fs.readFileSync(path.join(__dirname, "../../client/src/components/NotificationCenter.jsx"), "utf8")
      .replace(/^import .*;\r?\n/gm, "").replace("export default function", "function");
    compiled = (await transformWithOxc(source, "NotificationCenter.jsx", { jsx: { runtime: "classic", pragma: "h" } })).code;
  }
  const state = [], effects = [], rows = structuredClone(notifications), sockets = [], intervals = new Set(), listeners = new Map(), calls = [], navigated = [];
  let index = 0, dirty = false, pendingEffects = [], mounted = true, lateUpdates = 0, tree;
  const h = (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) });
  const unreadCount = () => rows.filter((row) => !row.isRead).length;
  const api = {
    async notifications() { calls.push("load"); return { notifications: structuredClone(rows), unreadCount: unreadCount() }; },
    async markNotificationsRead(ids) { calls.push(["opened", ids]); for (const row of rows) if (ids.includes(row._id)) row.isRead = true; return { unreadCount: unreadCount() }; },
    async markNotificationRead(id) { calls.push(["clicked", id]); rows.find((row) => row._id === id).isRead = true; return { unreadCount: unreadCount() }; },
    async markAllNotificationsRead() { calls.push("all"); for (const row of rows) row.isRead = true; return { unreadCount: 0 }; },
    ...overrides,
  };
  const dependencies = {
    h, Bell: "Bell", api,
    useAuth: () => ({ user: { id: "student-one", role } }),
    useState(initial) {
      const id = index++;
      if (!(id in state)) state[id] = typeof initial === "function" ? initial() : initial;
      return [state[id], (next) => {
        if (!mounted) { lateUpdates++; return; }
        const value = typeof next === "function" ? next(state[id]) : next;
        if (!Object.is(value, state[id])) { state[id] = value; dirty = true; }
      }];
    },
    useRef(initial) { const id = index++; return state[id] || (state[id] = { current: initial }); },
    useEffect(callback, deps) {
      const id = index++, previous = effects[id];
      if (!previous || deps.some((value, key) => !Object.is(value, previous.deps[key]))) pendingEffects.push(() => {
        previous?.cleanup?.(); effects[id] = { deps, cleanup: callback() };
      });
    },
    connectStudentSocket(id, onNew, onChanged) {
      const socket = { id, onNew, onChanged, disconnected: false, disconnect() { this.disconnected = true; } };
      sockets.push(socket); return socket;
    },
    window: {
      setInterval(callback) { intervals.add(callback); return callback; }, clearInterval(callback) { intervals.delete(callback); },
      addEventListener(event, callback) { listeners.set(`window:${event}`, callback); }, removeEventListener(event) { listeners.delete(`window:${event}`); },
    },
    document: {
      addEventListener(event, callback) { listeners.set(`document:${event}`, callback); }, removeEventListener(event) { listeners.delete(`document:${event}`); },
    },
  };
  const Panel = new Function(...Object.keys(dependencies), `${compiled}; return NotificationCenter;`)(...Object.values(dependencies));
  function render() {
    let count = 0;
    do {
      dirty = false; index = 0; pendingEffects = [];
      tree = Panel({ onNavigate: (item) => navigated.push(item) });
      for (const effect of pendingEffects) effect();
      assert.ok(++count < 30, "Render must settle");
    } while (dirty);
  }
  async function flush() {
    for (let count = 0; count < 30; count++) { await Promise.resolve(); if (dirty && mounted) render(); }
  }
  const nodes = (node = tree) => !node || typeof node !== "object" ? [] : [node, ...node.children.flatMap((child) => nodes(child))];
  const text = (node) => node && typeof node === "object" ? node.children.map(text).join("") : typeof node === "boolean" ? "" : String(node ?? "");
  const find = (predicate) => nodes().find(predicate);
  const button = (label) => find((node) => node.type === "button" && text(node) === label);
  const toggle = () => find((node) => node.props["aria-controls"] === "student-notifications").props.onClick();
  const badge = () => find((node) => node.props["aria-controls"] === "student-notifications")?.props["aria-label"];
  function unmount() { for (const effect of effects) effect?.cleanup?.(); mounted = false; }
  render();
  return { api, rows, sockets, intervals, listeners, calls, navigated, render, flush, find, text, button, toggle, badge, unmount, get lateUpdates() { return lateUpdates; } };
}

function notification(id, type = "assessments") {
  return { _id: String(id).padStart(24, "0"), type, title: `Update ${id}`, message: "Real-event message fixture", createdAt: new Date().toISOString(), isRead: false, assessment: "assessment-one" };
}

test("the bell loads actual API counts, marks opened notifications read and navigates on click", async () => {
  const panel = await mountPanel({ notifications: [notification(2), notification(1)] });
  await panel.flush(); assert.equal(panel.badge(), "Notifications, 2 unread");
  panel.toggle(); await panel.flush();
  assert.equal(panel.badge(), "Notifications"); assert.ok(panel.rows.every((row) => row.isRead));
  assert.equal(panel.calls.filter((call) => Array.isArray(call) && call[0] === "opened").length, 1);
  const item = panel.find((node) => node.type === "button" && panel.text(node).includes("Update 2"));
  await item.props.onClick(); await panel.flush();
  assert.equal(panel.navigated[0]._id, notification(2)._id);
  assert.ok(!panel.find((node) => node.props.id === "student-notifications")); panel.unmount();
});

test("category reads affect only visible items and mark-all clears the remaining unread items", async () => {
  const panel = await mountPanel({ notifications: [notification(1, "subjects"), notification(2, "grades")] });
  await panel.flush(); panel.toggle(); panel.render();
  panel.find((node) => node.type === "select").props.onChange({ target: { value: "subjects" } }); await panel.flush();
  assert.equal(panel.rows[0].isRead, true); assert.equal(panel.rows[1].isRead, false); assert.equal(panel.badge(), "Notifications, 1 unread");
  assert.ok(panel.find((node) => node.type === "button" && panel.text(node).includes("Update 1")));
  assert.ok(!panel.find((node) => node.type === "button" && panel.text(node).includes("Update 2")));
  await panel.button("Mark all as read").props.onClick(); await panel.flush();
  assert.ok(panel.rows.every((row) => row.isRead)); assert.equal(panel.badge(), "Notifications"); panel.unmount();
});

test("real-time retries, reconnects and polling refresh from the server without inflating counts", async () => {
  const panel = await mountPanel({ notifications: [notification(1)] }); await panel.flush();
  panel.rows.unshift(notification(2)); panel.sockets[0].onNew(panel.rows[0]); panel.sockets[0].onNew(panel.rows[0]); await panel.flush();
  assert.equal(panel.badge(), "Notifications, 2 unread");
  panel.sockets[0].onChanged(); await panel.flush(); assert.equal(panel.badge(), "Notifications, 2 unread");
  panel.rows[0].isRead = true; for (const poll of panel.intervals) poll(); await panel.flush();
  assert.equal(panel.badge(), "Notifications, 1 unread");
  panel.unmount(); assert.equal(panel.sockets[0].disconnected, true); assert.equal(panel.intervals.size, 0); assert.equal(panel.listeners.size, 0);
});

test("failed requests have a retry state and do not invent an empty successful response", async () => {
  const panel = await mountPanel({ overrides: { async notifications() { throw new Error("Unavailable"); } } });
  await panel.flush(); panel.toggle(); await panel.flush();
  assert.match(panel.text(panel.find((node) => node.props.role === "alert")), /Unavailable/);
  assert.ok(!panel.find((node) => panel.text(node) === "You're all caught up."));
  panel.api.notifications = async () => ({ notifications: [], unreadCount: 0 });
  panel.button("Retry").props.onClick(); await panel.flush();
  assert.ok(panel.find((node) => panel.text(node) === "You're all caught up.")); panel.unmount();
});

test("clicking an unread item still persists read state when opening auto-read failed", async () => {
  const panel = await mountPanel({ notifications: [notification(1)], overrides: { async markNotificationsRead() { throw new Error("Retry reading"); } } });
  await panel.flush(); panel.toggle(); await panel.flush();
  assert.equal(panel.rows[0].isRead, false);
  await panel.find((node) => node.type === "button" && panel.text(node).includes("Update 1")).props.onClick(); await panel.flush();
  assert.equal(panel.rows[0].isRead, true); assert.equal(panel.navigated.length, 1); panel.unmount();
});

test("late responses after logout cannot update state or leave a socket connected", async () => {
  let release;
  const panel = await mountPanel({ overrides: { notifications: () => new Promise((resolve) => { release = resolve; }) } });
  panel.unmount(); release({ notifications: [notification(1)], unreadCount: 1 }); await panel.flush();
  assert.equal(panel.lateUpdates, 0); assert.equal(panel.sockets[0].disconnected, true);
});

test("teacher and admin dashboards never request notifications or create notification sockets", async () => {
  for (const role of ["teacher", "admin"]) {
    const panel = await mountPanel({ role }); await panel.flush();
    assert.equal(panel.calls.length, 0); assert.equal(panel.sockets.length, 0); assert.equal(panel.badge(), undefined); panel.unmount();
  }
});

test("Escape closes the panel without altering notifications", async () => {
  const panel = await mountPanel(); await panel.flush(); panel.toggle(); await panel.flush();
  panel.listeners.get("document:keydown")({ type: "keydown", key: "Escape" }); await panel.flush();
  assert.ok(!panel.find((node) => node.props.id === "student-notifications")); panel.unmount();
});
