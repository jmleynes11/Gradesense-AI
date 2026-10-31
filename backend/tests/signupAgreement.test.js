const { test, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const User = require("../models/User");
const { register } = require("../controllers/authController");

const message = "Please agree to the Terms and Conditions and Privacy Policy to continue.";
const account = { firstName: "Ana", lastName: "Santos", email: "ana@example.test", password: "password123", confirmPassword: "password123", role: "teacher", studentNumber: "S-123" };
function response() {
  return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}
afterEach(() => mock.restoreAll());

test("teacher and student signup require explicit boolean agreement before any lookup or creation", async () => {
  const find = mock.method(User, "findOne", async () => null);
  const create = mock.method(User, "create", async () => { throw new Error("Unexpected creation"); });
  const { signupValidationError } = await import("../../client/src/services/signupValidation.js");
  for (const role of ["teacher", "student"]) {
    for (const agreementAccepted of [undefined, null, false, "true", "false", 1, {}, []]) {
      const body = { ...account, role, agreementAccepted, agreementAcceptedAt: "2000-01-01" };
      const res = response();
      await register({ body }, res);
      assert.equal(res.statusCode, 400);
      assert.equal(res.body.message, message);
      assert.equal(signupValidationError(body), message);
    }
  }
  assert.equal(find.mock.callCount(), 0);
  assert.equal(create.mock.callCount(), 0);
});

test("accepted signup records a server timestamp when the teacher or student account becomes active", async () => {
  mock.method(User, "findOne", async () => null);
  const create = mock.method(User, "create", async (body) => ({ ...body, _id: "507f1f77bcf86cd799439011", isActive: true }));
  for (const role of ["teacher", "student"]) {
    const before = Date.now();
    const res = response();
    await register({ body: { ...account, role, agreementAccepted: true, agreementAcceptedAt: "2000-01-01" } }, res);
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.user.isActive, true);
    const stored = create.mock.calls.at(-1).arguments[0];
    assert.ok(stored.agreementAcceptedAt instanceof Date);
    assert.ok(stored.agreementAcceptedAt.getTime() >= before);
    assert.ok(stored.agreementAcceptedAt.getTime() <= Date.now());
  }
});

let compiled;
async function signupForm(hash = "") {
  const { signupValidationError, AGREEMENT_REQUIRED_MESSAGE } = await import("../../client/src/services/signupValidation.js");
  if (!compiled) {
    const { transformWithOxc } = await import("../../client/node_modules/vite/dist/node/index.js");
    const source = fs.readFileSync(path.join(__dirname, "../../client/src/pages/auth/Login.jsx"), "utf8")
      .replace(/^import .*;\r?\n/gm, "").replace("export default function", "function");
    compiled = (await transformWithOxc(source, "Login.jsx", { jsx: { runtime: "classic", pragma: "h" } })).code;
  }
  const states = [], registrations = [], logins = [];
  let index = 0, tree;
  const dependencies = {
    h: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    React: { Fragment: "Fragment" },
    useState(initial) {
      const id = index++;
      if (!(id in states)) states[id] = typeof initial === "function" ? initial() : initial;
      return [states[id], (next) => { states[id] = typeof next === "function" ? next(states[id]) : next; }];
    },
    useAuth: () => ({ register: async (body) => registrations.push(body), login: async (body) => logins.push(body) }),
    signupValidationError, AGREEMENT_REQUIRED_MESSAGE,
    window: { location: { hash } },
    Bot: "Bot", Eye: "Eye", EyeOff: "EyeOff", GraduationCap: "GraduationCap", ShieldCheck: "ShieldCheck", BrandLogo: "BrandLogo",
  };
  const Component = new Function(...Object.keys(dependencies), `${compiled}; return Login;`)(...Object.values(dependencies));
  const render = () => { index = 0; tree = Component(); };
  const nodes = (node = tree) => !node || typeof node !== "object" ? [] : [node, ...node.children.flatMap((child) => nodes(child))];
  const text = (node) => node && typeof node === "object" ? node.children.map(text).join("") : typeof node === "boolean" ? "" : String(node ?? "");
  const find = (predicate) => nodes().find(predicate);
  function change(name, value) { find((node) => node.props.name === name).props.onChange({ target: { value } }); render(); }
  render();
  return { render, nodes, find, text, change, registrations, logins, submit: async () => { await find((node) => node.type === "form").props.onSubmit({ preventDefault() {} }); render(); } };
}

test("signup alone shows one unchecked required agreement above Register with separate legal links", async () => {
  const form = await signupForm();
  assert.equal(form.find((node) => node.props.type === "checkbox"), undefined);
  form.find((node) => node.type === "button" && form.text(node) === "Create teacher or student account").props.onClick();
  form.render();
  const checkbox = form.find((node) => node.props.type === "checkbox");
  assert.equal(checkbox.props.checked, false);
  assert.equal(checkbox.props.required, true);
  assert.equal(form.nodes().filter((node) => node.props.type === "checkbox").length, 1);
  const label = form.find((node) => node.props.htmlFor === checkbox.props.id);
  assert.equal(form.text(label), "I have read and agree to the Terms and Conditions and Privacy Policy.");
  const nodes = form.nodes();
  assert.ok(nodes.indexOf(checkbox) > nodes.findIndex((node) => node.props.name === "confirmPassword"));
  assert.ok(nodes.indexOf(checkbox) < nodes.findIndex((node) => node.type === "button" && node.props.type === "submit"));
  const links = nodes.filter((node) => node.type === "a");
  assert.equal(links.length, 2);
  for (const [index, document] of ["terms-and-conditions", "privacy-policy"].entries()) {
    assert.equal(links[index].props.href, `/legal/${document}.html`);
    assert.equal(links[index].props.target, "_blank");
    assert.match(links[index].props.rel, /noopener/);
    const html = fs.readFileSync(path.join(__dirname, "../../client/public", links[index].props.href), "utf8");
    assert.match(html, new RegExp(`<h1[^>]*>${form.text(links[index])}</h1>`));
    assert.match(html, /href="\/#signup">Return to signup/);
    assert.doesNotMatch(html, /Approved document not yet available|ha(?:ve|s) not been provided|placeholder/i);
  }
});

test("legal-document return links open the signup form with its existing agreement validation", async () => {
  const form = await signupForm("#signup");
  assert.equal(form.find((node) => node.props.name === "agreementAccepted").props.checked, false);
  assert.ok(form.find((node) => node.props.name === "confirmPassword"));
  assert.ok(form.find((node) => node.type === "button" && form.text(node) === "Register"));
});

test("unchecked agreement shows the exact message and blocks registration until checked", async () => {
  const form = await signupForm();
  form.find((node) => node.type === "button" && form.text(node) === "Create teacher or student account").props.onClick();
  form.render();
  form.change("firstName", "Ana"); form.change("lastName", "Santos"); form.change("confirmPassword", "password123");
  await form.submit();
  assert.equal(form.registrations.length, 0);
  assert.ok(form.find((node) => node.type === "p" && form.text(node) === message));
  let validity = "";
  const currentTarget = { setCustomValidity(value) { validity = value; } };
  const checkbox = form.find((node) => node.props.type === "checkbox");
  checkbox.props.onInvalid({ currentTarget });
  assert.equal(validity, message);
  checkbox.props.onChange({ currentTarget, target: { checked: true } });
  assert.equal(validity, "");
  form.render(); await form.submit();
  assert.equal(form.registrations.length, 1);
  assert.equal(form.registrations[0].agreementAccepted, true);
  form.find((node) => node.type === "button" && form.text(node) === "Use existing account").props.onClick();
  form.render(); await form.submit();
  assert.equal(form.logins.length, 1);
  assert.equal(form.logins[0].agreementAccepted, undefined);
});
