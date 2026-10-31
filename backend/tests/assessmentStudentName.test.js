const { test } = require("node:test");
const assert = require("node:assert/strict");

test("submission table names use actual surname fields and preserve multiple given names", async () => {
  const { assessmentStudentName } = await import("../../client/src/services/assessmentStudentName.js");
  for (const [student, expected] of [
    [{ name: "Kobe Santos", firstName: "Kobe", lastName: "Santos" }, "Santos, Kobe"],
    [{ name: "Kobe M. Santos", firstName: "Kobe", lastName: "Santos" }, "Santos, Kobe M."],
    [{ name: "Santos, Kobe M.", firstName: "Kobe", lastName: "Santos" }, "Santos, Kobe M."],
    [{ name: "Kobe Miguel Santos", firstName: "Kobe Miguel", lastName: "Santos" }, "Santos, Kobe Miguel"],
    [{ name: "Mary Jane de la Cruz", firstName: "Mary Jane", lastName: "de la Cruz" }, "de la Cruz, Mary Jane"],
    [{ firstName: "Kobe M.", lastName: "Santos" }, "Santos, Kobe M."],
    [{ name: "Old Name", firstName: "Kobe", lastName: "Santos" }, "Santos, Kobe"],
  ]) {
    const original = { ...student };
    for (const status of ["submitted", "graded", "not_submitted"]) {
      const row = { student, status };
      assert.equal(assessmentStudentName(row.student), expected);
    }
    assert.deepEqual(student, original);
  }
});

test("legacy submission table names preserve middle initials and already formatted names", async () => {
  const { assessmentStudentName } = await import("../../client/src/services/assessmentStudentName.js");
  for (const [student, expected] of [
    [{ name: "Kobe Santos" }, "Santos, Kobe"],
    [{ name: "Kobe M. Santos" }, "Santos, Kobe M."],
    [{ name: "Santos, Kobe M." }, "Santos, Kobe M."],
    [{ name: " Chen " }, "Chen"],
    [{ name: "  " }, "Unknown"],
    [null, "Unknown"],
  ]) assert.equal(assessmentStudentName(student), expected);
});
