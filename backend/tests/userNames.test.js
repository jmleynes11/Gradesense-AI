const { test, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const AuditLog = require("../models/AuditLog");
const auth = require("../controllers/authController");
const admin = require("../controllers/adminController");

const account = { firstName: "Mary Jane", lastName: "de la Cruz", email: "names@example.test", password: "password123", confirmPassword: "password123", role: "teacher", agreementAccepted: true };
function response() {
  return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}
function mockWrites() {
  const inserted = mock.method(User.collection, "insertOne", async (doc) => ({ acknowledged: true, insertedId: doc._id }));
  const updated = mock.method(User.collection, "updateOne", async () => ({ acknowledged: true, matchedCount: 1, modifiedCount: 1 }));
  mock.method(AuditLog, "create", async () => ({}));
  return { inserted, updated };
}
afterEach(() => mock.restoreAll());

test("signup rejects missing, blank, and non-string name parts before database access", async () => {
  const find = mock.method(User, "findOne", async () => null);
  for (const parts of [{ firstName: undefined }, { lastName: undefined }, { firstName: "  " }, { lastName: "\t" }, { firstName: {} }, { lastName: ["Smith"] }]) {
    const res = response();
    await auth.register({ body: { ...account, ...parts } }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /First name and last name are required/);
  }
  assert.equal(find.mock.callCount(), 0);
});

test("teacher and student signup persist separate trimmed names, full display name, and hashed password", async () => {
  const { inserted } = mockWrites();
  mock.method(User, "findOne", async () => null);
  for (const role of ["teacher", "student"]) {
    const res = response();
    await auth.register({ body: { ...account, firstName: " Mary Jane ", lastName: " de la Cruz ", role, studentNumber: " S-123 " } }, res);
    assert.equal(res.statusCode, 201);
    const stored = inserted.mock.calls.at(-1).arguments[0];
    assert.equal(stored.firstName, "Mary Jane");
    assert.equal(stored.lastName, "de la Cruz");
    assert.equal(stored.name, "Mary Jane de la Cruz");
    assert.notEqual(stored.password, account.password);
    assert.equal(stored.confirmPassword, undefined);
    assert.ok(stored.agreementAcceptedAt instanceof Date);
    assert.equal(stored.isActive, true);
    assert.equal(await User.hydrate(stored).matchPassword(account.password), true);
    assert.equal(stored.studentNumber, role === "student" ? "S-123" : "");
    assert.equal(res.body.user.name, stored.name);
    assert.equal(res.body.user.firstName, stored.firstName);
    assert.equal(res.body.user.lastName, stored.lastName);
    assert.equal(res.body.user.password, undefined);
    assert.equal(jwt.verify(res.body.token, process.env.JWT_SECRET || "dev_secret").id, String(stored._id));
  }
});

test("existing registration restrictions still apply", async () => {
  for (const body of [{ ...account, role: "admin" }, { ...account, role: "student" }]) {
    const res = response();
    await auth.register({ body }, res);
    assert.equal(res.statusCode, 400);
  }
  mock.method(User, "findOne", async () => ({ email: account.email }));
  const res = response();
  await auth.register({ body: account }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.message, "This email address is already registered.");
});

test("schema requires both name parts for new accounts and rejects clearing either part", async () => {
  for (const parts of [{ firstName: undefined }, { lastName: undefined }, { firstName: " " }, { lastName: " " }]) {
    await assert.rejects(new User({ ...account, ...parts }).validate(), { name: "ValidationError" });
  }
  const user = User.hydrate({ ...account, name: "Mary Jane de la Cruz" });
  user.lastName = " ";
  await assert.rejects(user.validate(), /lastName/);
});

test("login and session reads retain full names for new and legacy accounts", async () => {
  const { inserted, updated } = mockWrites();
  const created = await User.create(account);
  const stored = inserted.mock.calls[0].arguments[0];
  for (const legacy of [false, true]) {
    const data = { ...stored };
    if (legacy) { delete data.firstName; delete data.lastName; }
    const user = User.hydrate(data);
    mock.method(User, "findOne", () => ({ select: async () => user }));
    const res = response();
    await auth.login({ body: { email: account.email, password: account.password } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.user.name, created.name);
    assert.equal(res.body.user.firstName, legacy ? "" : account.firstName);
    assert.equal(res.body.user.lastName, legacy ? "" : account.lastName);
    const session = response();
    await auth.me({ user }, session);
    assert.deepEqual(session.body.user, res.body.user);
  }
  assert.equal(updated.mock.callCount(), 2);
});

test("profile changes persist both parts and synchronize every full-name display", async () => {
  const { updated } = mockWrites();
  mock.method(User, "findOne", async () => null);
  const user = User.hydrate({ ...account, name: "Mary Jane de la Cruz", _id: "507f1f77bcf86cd799439011" });
  const res = response();
  await auth.updateProfile({ user, body: { firstName: " Ana Maria ", lastName: " Santos ", email: account.email } }, res);
  assert.equal(res.body.user.name, "Ana Maria Santos");
  assert.equal(res.body.user.firstName, "Ana Maria");
  assert.equal(res.body.user.lastName, "Santos");
  const changes = updated.mock.calls[0].arguments[1].$set;
  assert.equal(changes.name, "Ana Maria Santos");
  assert.equal(changes.firstName, "Ana Maria");
  assert.equal(changes.lastName, "Santos");
  for (const parts of [{ firstName: "" }, { lastName: " " }]) {
    const invalid = response();
    await auth.updateProfile({ user, body: { ...account, ...parts } }, invalid);
    assert.equal(invalid.statusCode, 400);
  }
});

test("admin creation, edits, and account toggles preserve names and existing passwords", async () => {
  const { inserted, updated } = mockWrites();
  mock.method(User, "findOne", async () => null);
  const res = response();
  await admin.createUser({ body: account }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(inserted.mock.calls[0].arguments[0].agreementAcceptedAt, undefined);
  assert.equal(res.body.name, "Mary Jane de la Cruz");
  assert.equal(res.body.firstName, "Mary Jane");
  const user = User.hydrate(inserted.mock.calls[0].arguments[0]);
  const password = user.password;
  mock.method(User, "findById", () => ({ select: async () => user }));
  const edited = response();
  await admin.updateUser({ params: { id: user._id }, body: { firstName: "Ana Maria", lastName: "Santos" } }, edited);
  assert.equal(edited.body.name, "Ana Maria Santos");
  assert.equal(edited.body.lastName, "Santos");
  const toggled = response();
  await admin.updateUser({ params: { id: user._id }, body: { isActive: false } }, toggled);
  assert.equal(toggled.body.isActive, false);
  assert.equal(toggled.body.name, "Ana Maria Santos");
  assert.equal(user.password, password);
  assert.equal(updated.mock.callCount(), 2);
});

test("legacy accounts can save unrelated changes without inventing name parts", async () => {
  const user = User.hydrate({ name: "Legacy", email: account.email, password: "existing-hash", role: "student" });
  user.isActive = false;
  await user.validate();
  assert.equal(user.name, "Legacy");
  assert.equal(user.firstName, undefined);
  assert.equal(user.lastName, undefined);
});

test("legacy full-name editing endpoints keep separate fields consistent", async () => {
  const user = User.hydrate({ ...account, name: "Mary Jane de la Cruz" });
  user.name = "Ana Santos";
  await user.validate();
  assert.equal(user.firstName, "Ana");
  assert.equal(user.lastName, "Santos");
});

test("profile and admin editors preserve multiword fields and prefill legacy names", async () => {
  const { nameFields } = await import("../../client/src/services/userName.js");
  assert.deepEqual(nameFields(account), { firstName: "Mary Jane", lastName: "de la Cruz" });
  assert.deepEqual(nameFields({ name: "Legacy User" }), { firstName: "Legacy", lastName: "User" });
  assert.deepEqual(nameFields({ name: "Legacy" }), { firstName: "Legacy", lastName: "" });
  assert.deepEqual(nameFields(null), { firstName: "", lastName: "" });
});
