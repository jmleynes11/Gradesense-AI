const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const compiled = new Map();
async function mount(fileName = "components/ProfilePhotoPreview.jsx", { role = "student", profileImage = "", upload } = {}) {
  if (!compiled.has(fileName)) {
    const { transformWithOxc } = await import("../../client/node_modules/vite/dist/node/index.js");
    const source = fs.readFileSync(path.join(__dirname, "../../client/src", fileName), "utf8").replace(/^import .*;\r?\n/gm, "").replace("export default function", "function");
    compiled.set(fileName, (await transformWithOxc(source, fileName, { jsx: { runtime: "classic", pragma: "h" } })).code);
  }
  const state = [], effects = [], revoked = [], uploads = [], navigated = [];
  let index = 0, dirty = false, pendingEffects = [], tree, closed = 0, pickerClicks = 0, blobId = 0;
  let user = { id: "student-one", role, name: "Student Preview", email: "student@example.test", profileImage };
  const dialog = { open: false, showModal() { this.open = true; }, close() { this.open = false; } };
  const auth = { get user() { return user; }, updateUser(next) { user = next; dirty = true; }, logout() {} };
  const h = (type, props, ...children) => {
    if (props?.ref && type === "dialog") props.ref.current = dialog;
    if (props?.ref && type === "input") props.ref.current = { click() { pickerClicks++; } };
    return { type, props: props || {}, children: children.flat(Infinity) };
  };
  const dependencies = {
    h, useAuth: () => auth,
    api: { updateProfileImage: async (file) => { uploads.push(file); return upload ? upload(file) : { user: { ...user, profileImage: "/uploads/profile-photos/saved.png" } }; } },
    URL: { createObjectURL: () => `blob:preview-${++blobId}`, revokeObjectURL: (url) => revoked.push(url) },
    useState(initial) {
      const id = index++; if (!(id in state)) state[id] = typeof initial === "function" ? initial() : initial;
      return [state[id], (next) => { const value = typeof next === "function" ? next(state[id]) : next; if (!Object.is(value, state[id])) { state[id] = value; dirty = true; } }];
    },
    useRef(initial) { const id = index++; return state[id] || (state[id] = { current: initial }); },
    useEffect(callback, deps) {
      const id = index++, previous = effects[id];
      if (!previous || deps.some((value, key) => !Object.is(value, previous.deps[key]))) pendingEffects.push(() => { previous?.cleanup?.(); effects[id] = { deps, cleanup: callback() }; });
    },
  };
  for (const name of ["UserAvatar", "ProfilePhotoPreview", "NotificationCenter", "BrandLogo", "BarChart3", "BookOpen", "Bot", "ClipboardList", "Gamepad2", "LayoutDashboard", "LogOut", "Menu", "Settings", "Shield", "Trophy", "Users", "X"]) dependencies[name] = name;
  const componentName = fileName.startsWith("layouts") ? "DashboardLayout" : "ProfilePhotoPreview";
  const Component = new Function(...Object.keys(dependencies), `${compiled.get(fileName)}; return ${componentName};`)(...Object.values(dependencies));
  function render() {
    let count = 0;
    do {
      dirty = false; index = 0; pendingEffects = [];
      tree = Component({ onClose: () => { closed++; }, active: "Dashboard", setActive: (value) => navigated.push(value), children: "Dashboard content" });
      for (const effect of pendingEffects) effect();
      assert.ok(++count < 20);
    } while (dirty);
  }
  const nodes = (node = tree) => !node || typeof node !== "object" ? [] : [node, ...node.children.flatMap((child) => nodes(child))];
  const text = (node) => node && typeof node === "object" ? node.children.map(text).join("") : typeof node === "boolean" ? "" : String(node ?? "");
  const find = (predicate) => nodes().find(predicate);
  const button = (label) => find((node) => node.type === "button" && text(node) === label);
  const choose = (file) => { const target = { files: [file], value: "selected" }; find((node) => node.type === "input").props.onChange({ target }); assert.equal(target.value, ""); render(); };
  const unmount = () => { for (const effect of effects) effect?.cleanup?.(); };
  render();
  return { auth, dialog, uploads, revoked, navigated, render, nodes, find, text, button, choose, unmount, get closed() { return closed; }, get pickerClicks() { return pickerClicks; } };
}

test("opening shows a large current avatar and requires a selection before saving", async () => {
  for (const profileImage of ["", "/uploads/profile-photos/current.png"]) {
    const view = await mount(undefined, { profileImage });
    assert.equal(view.dialog.open, true);
    const avatar = view.find((node) => node.type === "UserAvatar");
    assert.equal(avatar.props.user.profileImage, profileImage); assert.equal(avatar.props.className, "h-40 w-40");
    assert.equal(view.button("Save Changes").props.disabled, true);
    view.button("Change Profile Picture").props.onClick(); assert.equal(view.pickerClicks, 1); assert.equal(view.uploads.length, 0);
    view.button("Cancel").props.onClick(); assert.equal(view.closed, 1); assert.equal(view.uploads.length, 0);
    view.unmount(); assert.equal(view.dialog.open, false);
  }
});

test("JPG, JPEG, PNG and existing WEBP support preview locally and cancel without uploading", async () => {
  for (const [name, type] of [["photo.jpg", "image/jpeg"], ["photo.jpeg", "image/jpeg"], ["photo.png", "image/png"], ["photo.webp", "image/webp"]]) {
    const view = await mount(); view.choose({ name, type, size: 2048 });
    assert.ok(view.find((node) => node.type === "img" && node.props.src.startsWith("blob:")));
    assert.equal(view.button("Save Changes").props.disabled, false); assert.equal(view.uploads.length, 0);
    view.button("Cancel").props.onClick(); view.unmount(); assert.equal(view.uploads.length, 0); assert.equal(view.revoked.length, 1);
  }
});

test("unsupported and oversized images do not upload or enable saving", async () => {
  const view = await mount();
  for (const file of [{ type: "image/gif", size: 10 }, { type: "image/png", size: 5 * 1024 * 1024 + 1 }]) {
    view.choose(file); assert.ok(view.find((node) => node.props.role === "alert")); assert.equal(view.button("Save Changes").props.disabled, true);
  }
  assert.equal(view.uploads.length, 0); view.unmount();
});

test("saving uploads once, blocks duplicate saves and refreshes shared user state", async () => {
  let release;
  const view = await mount(undefined, { upload: () => new Promise((resolve) => { release = resolve; }) });
  const file = { name: "photo.png", type: "image/png", size: 2048 }; view.choose(file);
  const save = view.button("Save Changes").props.onClick;
  const pending = save(); await save(); view.render();
  assert.equal(view.uploads.length, 1); assert.equal(view.uploads[0], file);
  assert.equal(view.button("Saving...").props.disabled, true); assert.equal(view.button("Cancel").props.disabled, true);
  let prevented = false; view.find((node) => node.type === "dialog").props.onCancel({ preventDefault() { prevented = true; } }); assert.equal(prevented, true); assert.equal(view.closed, 0);
  const user = { ...view.auth.user, profileImage: "/uploads/profile-photos/new.png" }; release({ user }); await pending;
  assert.equal(view.auth.user, user); assert.equal(view.closed, 1); view.unmount();
});

test("upload failure keeps the selection for retry and does not replace the saved avatar", async () => {
  const view = await mount(undefined, { profileImage: "/uploads/profile-photos/current.png", upload: async () => { throw new Error("Upload failed"); } });
  view.choose({ name: "photo.png", type: "image/png", size: 2048 }); await view.button("Save Changes").props.onClick(); view.render();
  assert.match(view.text(view.find((node) => node.props.role === "alert")), /Upload failed/);
  assert.equal(view.auth.user.profileImage, "/uploads/profile-photos/current.png"); assert.equal(view.closed, 0); assert.equal(view.button("Save Changes").props.disabled, false);
  view.unmount();
});

test("a late upload response after unmount cannot replace the next account's profile", async () => {
  let release; const view = await mount(undefined, { upload: () => new Promise((resolve) => { release = resolve; }) });
  view.choose({ name: "photo.png", type: "image/png", size: 2048 }); const pending = view.button("Save Changes").props.onClick(); view.unmount();
  release({ user: { ...view.auth.user, profileImage: "/uploads/profile-photos/old-account.png" } }); await pending;
  assert.equal(view.auth.user.profileImage, ""); assert.equal(view.closed, 0);
});

test("student dropdown preview retains account information and account actions", async () => {
  const view = await mount("layouts/DashboardLayout.jsx");
  view.find((node) => node.props["aria-label"] === "Open account menu").props.onClick(); view.render();
  const menu = view.find((node) => node.props.role === "menu"); assert.match(view.text(menu), /Student Preview/); assert.match(view.text(menu), /student@example.test/);
  const signOut = view.button("Sign out").props.onClick; assert.equal(signOut, view.auth.logout);
  const preview = view.nodes(menu).find((node) => node.type === "button" && node.props["aria-label"] === "Preview profile picture"); preview.props.onClick(); view.render();
  assert.ok(view.find((node) => node.type === "ProfilePhotoPreview")); assert.equal(view.pickerClicks, 0);
  const next = { ...view.auth.user, profileImage: "/uploads/profile-photos/new.png" }; view.auth.updateUser(next); view.render();
  assert.ok(view.nodes().filter((node) => node.type === "UserAvatar").every((node) => node.props.user === next));
  view.button("Account Settings").props.onClick(); view.render(); assert.deepEqual(view.navigated, ["Settings"]); view.unmount();
});

test("teacher dropdown keeps its existing direct upload action", async () => {
  const view = await mount("layouts/DashboardLayout.jsx", { role: "teacher" });
  view.find((node) => node.props["aria-haspopup"] === "menu").props.onClick(); view.render();
  view.find((node) => node.props["aria-label"] === "Change profile photo").props.onClick();
  assert.equal(view.pickerClicks, 1); assert.ok(!view.find((node) => node.type === "ProfilePhotoPreview")); view.unmount();
});
