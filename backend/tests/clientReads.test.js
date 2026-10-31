const { test, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
let sequence = 0;
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

async function clientApi(getToken = () => "test-token") {
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: getToken } });
  const source = fs.readFileSync(path.join(__dirname, "../../client/src/services/api.js"), "utf8")
    .replaceAll("import.meta.env", JSON.stringify({ VITE_API_URL: "https://example.invalid/api" }));
  return (await import(`data:text/javascript;base64,${Buffer.from(source + `\n// test ${++sequence}`).toString("base64")}`)).api;
}
afterEach(() => {
  mock.restoreAll();
  if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
  else delete globalThis.localStorage;
});

test("identical active GET requests share transport and a later read fetches fresh data", async () => {
  let release;
  const fetch = mock.method(globalThis, "fetch", () => new Promise((resolve) => { release = resolve; }));
  const api = await clientApi();
  const first = api.assessment("draft-1");
  const second = api.assessment("draft-1");
  assert.equal(fetch.mock.callCount(), 1);
  release(new Response(JSON.stringify({ _id: "draft-1", status: "draft" }), { headers: { "content-type": "application/json" } }));
  assert.deepEqual(await first, await second);
  fetch.mock.mockImplementation(async () => new Response(JSON.stringify({ _id: "draft-1", title: "fresh" }), { headers: { "content-type": "application/json" } }));
  assert.equal((await api.assessment("draft-1")).title, "fresh");
  assert.equal(fetch.mock.callCount(), 2);
});

test("mutation requests are never merged", async () => {
  const fetch = mock.method(globalThis, "fetch", async () => new Response("{}", { headers: { "content-type": "application/json" } }));
  const api = await clientApi();
  await Promise.all([api.updateAssessment("draft-1", { title: "one" }), api.updateAssessment("draft-1", { title: "two" })]);
  assert.equal(fetch.mock.callCount(), 2);
});

test("PDF and Excel requests include only the selected assessment and browser time zone", async () => {
  const fetch = mock.method(globalThis, "fetch", async () => new Response("report", { headers: { "content-type": "application/octet-stream" } }));
  const api = await clientApi();
  for (const type of ["pdf", "excel"]) {
    await api[`${type}Report`]("selected-assessment");
    const [url, options] = fetch.mock.calls.at(-1).arguments;
    const target = new URL(url);
    assert.equal(target.pathname, `/api/reports/${type}`);
    assert.equal(target.searchParams.get("assessmentId"), "selected-assessment");
    assert.equal(target.searchParams.get("timeZone"), Intl.DateTimeFormat().resolvedOptions().timeZone);
    assert.equal(options.headers.Authorization, "Bearer test-token");
  }
});

test("failed reads are cleared and can be retried", async () => {
  const fetch = mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ message: "Unavailable" }), { status: 503, headers: { "content-type": "application/json" } }));
  const api = await clientApi();
  await assert.rejects(api.assessment("draft-1"), /Unavailable/);
  fetch.mock.mockImplementation(async () => new Response("{}", { headers: { "content-type": "application/json" } }));
  await api.assessment("draft-1");
  assert.equal(fetch.mock.callCount(), 2);
});

test("requests from different signed-in sessions are never shared", async () => {
  const fetch = mock.method(globalThis, "fetch", async () => new Response("{}", { headers: { "content-type": "application/json" } }));
  let token = "session-one";
  const api = await clientApi(() => token);
  const first = api.assessment("draft-1");
  token = "session-two";
  const second = api.assessment("draft-1");
  await Promise.all([first, second]);
  assert.equal(fetch.mock.callCount(), 2);
});
