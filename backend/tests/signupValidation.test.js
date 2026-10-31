const { test, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const User = require("../models/User");
const { register } = require("../controllers/authController");

const account = { firstName: "Ana", lastName: "Santos", email: "ana@example.test", password: "password123", confirmPassword: "password123", role: "teacher", studentNumber: "", agreementAccepted: true };
function response() {
  return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}
afterEach(() => mock.restoreAll());

test("signup required-field errors prevent lookups and writes", async () => {
  const find = mock.method(User, "findOne", async () => null);
  const create = mock.method(User, "create", async () => { throw new Error("Unexpected account creation"); });
  for (const field of ["firstName", "lastName", "email", "password", "confirmPassword", "role"]) {
    for (const value of [undefined, null, "", " \t ", {}]) {
      const res = response();
      await register({ body: { ...account, [field]: value } }, res);
      assert.equal(res.statusCode, 400, `${field} must be required`);
      assert.match(res.body.message, /required/);
    }
  }
  for (const value of [undefined, null, "", " \t "]) {
    const res = response();
    await register({ body: { ...account, role: "student", studentNumber: value } }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /Student Number is required/);
  }
  assert.equal(find.mock.callCount(), 0);
  assert.equal(create.mock.callCount(), 0);
});

test("signup enforces the existing eight-character password minimum before database access", async () => {
  const find = mock.method(User, "findOne", async () => null);
  for (const password of ["a", "1234567", " abcdef"]) {
    const res = response();
    await register({ body: { ...account, password, confirmPassword: password } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.message, "Password must be at least 8 characters.");
  }
  assert.equal(find.mock.callCount(), 0);
});

test("signup accepts eight-character passwords without adding composition rules or trimming them", async () => {
  mock.method(User, "findOne", async () => null);
  const create = mock.method(User, "create", async (body) => ({ ...body, _id: "507f1f77bcf86cd799439011" }));
  for (const password of ["abcdefgh", "12345678", " abcdef "]) {
    const res = response();
    await register({ body: { ...account, password, confirmPassword: password } }, res);
    assert.equal(res.statusCode, 201);
    assert.equal(create.mock.calls.at(-1).arguments[0].password, password);
    assert.equal(create.mock.calls.at(-1).arguments[0].confirmPassword, undefined);
    assert.equal(res.body.user.password, undefined);
    assert.equal(res.body.user.confirmPassword, undefined);
  }
});

test("signup normalizes email before lookup and rejects an existing account with the exact message", async () => {
  const find = mock.method(User, "findOne", async () => ({ email: account.email }));
  const create = mock.method(User, "create", async () => { throw new Error("Unexpected account creation"); });
  const res = response();
  await register({ body: { ...account, email: "  ANA@EXAMPLE.TEST  " } }, res);
  assert.deepEqual(find.mock.calls[0].arguments[0], { email: account.email });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.message, "This email address is already registered.");
  assert.equal(create.mock.callCount(), 0);
});

test("signup stores the normalized email", async () => {
  mock.method(User, "findOne", async () => null);
  const create = mock.method(User, "create", async (body) => ({ ...body, _id: "507f1f77bcf86cd799439011" }));
  const res = response();
  await register({ body: { ...account, email: "  ANA@EXAMPLE.TEST  " } }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(create.mock.calls[0].arguments[0].email, account.email);
});

test("signup catches duplicate-email races rejected by the existing database unique index", async () => {
  mock.method(User, "findOne", async () => null);
  mock.method(User, "create", async () => { throw Object.assign(new Error("duplicate key"), { code: 11000, keyPattern: { email: 1 } }); });
  const res = response();
  await register({ body: account }, res);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { message: "This email address is already registered." });
});

test("signup does not misreport unrelated database failures as duplicate email", async () => {
  mock.method(User, "findOne", async () => null);
  const failure = new Error("Database unavailable");
  mock.method(User, "create", async () => { throw failure; });
  await assert.rejects(register({ body: account }, response()), (error) => error === failure);
});

test("frontend signup validation rejects each blank required field and student-only requirements", async () => {
  const { signupValidationError } = await import("../../client/src/services/signupValidation.js");
  const fields = { firstName: "First name", lastName: "Last name", email: "Email address", password: "Password", confirmPassword: "Confirm Password", role: "Role" };
  for (const [field, label] of Object.entries(fields)) {
    assert.equal(signupValidationError({ ...account, [field]: "" }), `${label} is required.`);
    if (field !== "role") assert.equal(signupValidationError({ ...account, [field]: " \t " }), `${label} is required.`);
  }
  assert.equal(signupValidationError({ ...account, role: "student", studentNumber: "  " }), "Student Number is required for student accounts.");
  assert.equal(signupValidationError(account), "");
  assert.equal(signupValidationError({ ...account, role: "student", studentNumber: "S-123" }), "");
});

test("frontend signup password validation uses the same minimum without trimming the password", async () => {
  const { signupValidationError } = await import("../../client/src/services/signupValidation.js");
  assert.equal(signupValidationError({ ...account, password: "1234567" }), "Password must be at least 8 characters.");
  for (const password of ["abcdefgh", "12345678", " abcdef "]) {
    assert.equal(signupValidationError({ ...account, password, confirmPassword: password }), "");
  }
});

test("backend signup rejects password mismatches before database access, preserving case and whitespace", async () => {
  const find = mock.method(User, "findOne", async () => null);
  const create = mock.method(User, "create", async () => { throw new Error("Unexpected account creation"); });
  for (const confirmPassword of ["Password123", "password124", " password123", "password123 "]) {
    const res = response();
    await register({ body: { ...account, confirmPassword } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.message, "Passwords do not match.");
  }
  assert.equal(find.mock.callCount(), 0);
  assert.equal(create.mock.callCount(), 0);
});

test("frontend signup requires confirmation and rejects nonidentical passwords", async () => {
  const { signupValidationError } = await import("../../client/src/services/signupValidation.js");
  for (const confirmPassword of [undefined, null, "", " \t ", {}]) {
    assert.equal(signupValidationError({ ...account, confirmPassword }), "Confirm Password is required.");
  }
  for (const confirmPassword of ["Password123", "password124", " password123", "password123 "]) {
    assert.equal(signupValidationError({ ...account, confirmPassword }), "Passwords do not match.");
  }
  assert.equal(signupValidationError(account), "");
});
