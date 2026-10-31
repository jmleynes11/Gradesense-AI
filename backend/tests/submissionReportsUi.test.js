const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("report buttons download the assessment being viewed and never export the all-submissions view", async () => {
  const { transformWithOxc } = await import("../../client/node_modules/vite/dist/node/index.js");
  const source = fs.readFileSync(path.join(__dirname, "../../client/src/pages/teacher/Submissions.jsx"), "utf8")
    .replace(/^import .*;\r?\n/gm, "").replace("export default function", "function");
  const compiled = (await transformWithOxc(source, "Submissions.jsx", { jsx: { runtime: "classic", pragma: "h" } })).code;
  for (const assessmentId of ["assessment-one", "assessment-two", ""]) {
    const calls = [], downloads = [], states = [];
    const h = (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) });
    const dependencies = {
      h, Panel: "Panel", SimpleTable: "SimpleTable", LoadingState: "LoadingState",
      useState(value) { const index = states.length; states.push(value); return [value, (next) => { states[index] = next; }]; },
      useRef: () => ({ current: 0 }), useEffect() {}, useAsyncData: () => ({ data: [] }),
      api: {
        async pdfReport(id) { calls.push(["pdf", id]); return "PDF blob"; },
        async excelReport(id) { calls.push(["excel", id]); return "Excel blob"; },
      },
      saveBlob: (blob, name) => downloads.push([blob, name]),
      displayScore() {}, displayPercentage() {}, assessmentStudentName() {},
    };
    const Component = new Function(...Object.keys(dependencies), `${compiled}; return Submissions;`)(...Object.values(dependencies));
    const tree = Component({ assessmentId });
    function buttons(node) {
      if (!node || typeof node !== "object") return [];
      return [...(node.type === "button" ? [node] : []), ...node.children.flatMap(buttons)];
    }
    for (const label of ["PDF Report", "Excel Report"]) await buttons(tree).find((button) => button.children.includes(label)).props.onClick();
    if (assessmentId) {
      assert.deepEqual(calls, [["pdf", assessmentId], ["excel", assessmentId]]);
      assert.equal(downloads[0][1], `gradesense-assessment-${assessmentId}.pdf`);
      assert.equal(downloads[1][1], `gradesense-assessment-${assessmentId}.xlsx`);
    } else {
      assert.deepEqual(calls, []);
      assert.deepEqual(downloads, []);
      assert.ok(states.includes("Open an assessment's submissions before generating a report."));
    }
  }
});
