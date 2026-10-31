# GradeSense AI

## Assessment loading and draft workflow

Assessment creation, including AI generation, always saves `status=draft` and `isPublished=false`. Only the dedicated publish action publishes an assessment. The Drafts filter includes AI-generated drafts. Students can load only published/closed assessments in subjects they are enrolled in.

The teacher list uses `/api/assessments?view=summary&page=1&limit=20`, with optional `status` and `subjectRef` filters. It returns `{ items, page, limit, hasMore }`; page sizes are validated and capped at 100. The legacy request without `view=summary` remains an array. Lists contain metadata/question IDs only; opening an assessment loads its questions separately. Student lists use `view=summary`; `/api/student/assessments/:id` loads one authorized assessment without answer keys or suggested answers.

Assessment reads exclude lesson content and redundant AI/version snapshots. New edit snapshots exclude previous version history, previous snapshots, and source lesson text, preventing recursive growth. Existing stored history is preserved. Subject metrics, report feedback, and quiz-game participant counts use batched queries. Submission queries filter teacher ownership before loading results. Independent dashboard counts run together, and common read filters/sorts have supporting indexes. Normal Mongoose startup creates declared indexes unless the deployment disables `autoIndex`; such deployments must create the declared indexes using their normal database maintenance process.

Loading/error screens cover assessment lists/details, subjects, dashboards, grades, admin records, and submission details; reports and publishing show pending states. Quiz Arena and AI generation retain their existing loading screens. Identical active GET requests are shared, but completed responses are not cached and mutations are never merged.

Run `npm test` in `backend` and `npm run build` in `client`. `node utils/diagnoseAssessmentQueries.js` performs an opt-in read-only MongoDB audit with index creation disabled; it reports timing, response size, documents examined, and index presence without logging record content. Network timings vary by deployment. Restart/redeploy the backend and deploy the updated client bundle together.

GradeSense AI is a basic MERN capstone MVP for automated grading, AI feedback, analytics, and report generation.

## Stack

- MongoDB
- Express.js
- React.js
- Node.js
- JWT authentication
- GroqCloud API for quiz generation, with OpenAI fallback
- Tailwind CSS
- PDF export
- Excel export

## Folder Structure

```text
backend/
  config/
  controllers/
  middleware/
  models/
  routes/
  services/
  uploads/
  utils/
client/
  src/
    components/
    context/
    hooks/
    layouts/
    pages/
      auth/
      admin/
      teacher/
      student/
    services/
```

## Setup

1. Install backend dependencies.

```bash
cd backend
npm install
cp .env.example .env
npm run dev
```

2. Install client dependencies.

```bash
cd client
npm install
cp .env.example .env
npm run dev
```

3. Configure backend `.env`.

```env
PORT=5000
MONGO_URI=your_mongodb_connection
JWT_SECRET=your_jwt_secret
GROQ_API_KEY=your_groq_key
GROQ_MODEL=openai/gpt-oss-20b
OPENAI_API_KEY=your_openai_key
OPENAI_MODEL=gpt-4o-mini
```

4. Configure client `.env`.

```env
VITE_API_URL=http://localhost:5000/api
```

5. Seed sample users.

```bash
cd backend
npm run seed
```

## Demo Accounts

After seeding:

- Admin: `admin@gradesense.test` / `password123`
- Teacher: `teacher@gradesense.test` / `password123`
- Student: `student@gradesense.test` / `password123`

## API Routes

- Auth: `/api/auth`
- Subjects: `/api/subjects`
- Assessments: `/api/assessments`
- Questions: `/api/questions`
- Submissions: `/api/submissions`
- Student: `/api/student`
- AI: `/api/ai`
- Admin: `/api/admin`
- Reports: `/api/reports`

## MVP Coverage

- Teacher and student registration
- Login, logout, JWT protected routes
- Role-based access for admin, teacher, and student
- Subject-based student management
- Assessment management
- Question bank schema and API
- Student submission and automatic grading
- Essay grading with OpenAI and local fallback
- AI quiz generation from text or uploaded documents
- Feedback and learning recommendations
- Teacher analytics
- Student dashboard, assigned assessments, history, and progress display
- Admin dashboard, user management, monitoring, mock backup/restore, audit logs
- PDF and Excel report services

## Notes

Quiz generation requires a configured Groq key. OpenAI is called only after an eligible Groq failure and requires its own key. Missing keys and authentication/configuration errors are reported rather than concealed by fallback. Essay grading retains the existing OpenAI/local grading behavior.

## Quiz AI providers

The Express/CommonJS backend uses dotenv and the existing OpenAI JavaScript SDK. `/api/ai/generate-quiz` extracts and cleans PDF, DOCX, PPTX, TXT, or submitted lesson text once, then analyzes it locally. `/api/questions/:id/regenerate` uses the saved lesson context. Both paths retain question normalization, lesson relevance checks, exact per-type counts, answer keys, and Mongoose question models. The complete cleaned lesson is sent once in the readable JSON `lessonText` field; local summaries/concepts are retained for saved quiz review, not substituted for the source. No ZIP, binary, or base64 document data is sent to the model.

`groqService.js` owns a separate client pointing to `https://api.groq.com/openai/v1`. `openaiService.js` retains the OpenAI implementation and explicitly uses `https://api.openai.com/v1`; `OPENAI_BASE_URL` cannot redirect either client's quiz calls. `quizProviderService.js` coordinates bounded attempts and invokes the shared validation in `aiService.js` before accepting either provider's response. It never extracts documents, persists records, or recursively falls back.

### Backend environment variables

Set these in the cloud host's backend secret/environment settings or local `backend/.env`. Do not put them in client variables or commit actual keys. Restart the backend after changing keys because SDK clients are initialized once.

| Variable | Default / example | Purpose |
| --- | --- | --- |
| `GROQ_API_KEY` | `your_groq_key` | Required primary provider credential |
| `GROQ_MODEL` | `openai/gpt-oss-20b` | Primary chat model |
| `OPENAI_API_KEY` | `your_openai_key` | Required for automatic fallback and existing OpenAI grading |
| `OPENAI_MODEL` | `gpt-4o-mini` | Existing fallback/grading model |
| `AI_QUIZ_TOTAL_TIMEOUT_MS` | `65000` | Total AI operation budget, including queues, waits, validation, and both providers |
| `AI_QUIZ_REQUEST_TIMEOUT_MS` | `20000` | Maximum queue/network duration per provider attempt |
| `AI_QUIZ_RETRY_DELAY_MS` | `500` | Groq retry delay when Retry-After is absent |
| `AI_QUIZ_MAX_RETRY_DELAY_MS` | `1500` | Maximum acceptable Retry-After before skipping retry |
| `AI_QUIZ_MAX_OUTPUT_TOKENS` | `8000` | Output ceiling; actual limit scales with question/essay counts |
| `AI_QUIZ_RECOVERY_EXTRA_MC` | `2` | Reserve MC candidates during partial recovery; only the requested valid count is returned |

Timeouts and the output ceiling must be positive integers. Retry delays and reserve MC candidates may be zero. Configure the total budget to leave enough time for OpenAI after Groq; a retry requires room for two more full provider attempts. The default primary GPT-OSS model uses low reasoning effort to reduce output overhead. The completion-token limit includes model reasoning where applicable.

### Fallback and validation policy

- HTTP 429, provider timeouts, and a long Retry-After switch directly to OpenAI.
- HTTP 500/502/503/504 and connection failures permit at most one short Groq retry when the remaining budget allows it, then switch to OpenAI.
- Empty, malformed, truncated, or schema/relevance-invalid quiz output permits at most one Groq recovery using the original prepared lesson and a short correction instruction. Invalid output then switches to OpenAI. Transport retry and output recovery share the same two-attempt Groq limit.
- Groq HTTP 400 with the specific `json_validate_failed` code is a generated-output failure. It gets at most one recovery in JSON object mode using the same prepared lesson and application validation. If it still fails, OpenAI is called once. Authentication and policy checks take precedence over output recovery.
- Other HTTP 400 responses, HTTP 401/403/404/422, missing credentials, unsupported parameters/models, programming errors, and explicit content-policy refusals do not activate fallback.
- OpenAI receives one attempt with the original prepared messages and the same validation. Both-provider failure returns HTTP 503 with the existing `{ message, code }` error shape. Total budget exhaustion returns HTTP 504.
- OpenAI credit exhaustion is classified as `quota`, not transient rate limiting. Exhausted fallback credit/quota returns HTTP 503 with `AI_FALLBACK_QUOTA_EXHAUSTED` and an explicit message.
- HTTP disconnects abort active/queued AI work and prevent fallback. Identical concurrent draft requests share one generation; each caller may cancel independently, and the operation aborts when all callers disconnect. Persistence starts only after validated generation and a cancellation check.

Groq GPT-OSS 20B/120B use a compact strict JSON Schema with one array per requested question type, exact array lengths, and three required distractor slots per multiple-choice question. Each question definition is referenced once per type, reducing provider prompt overhead compared with one schema slot per question. The adapter converts groups/distractor objects to the existing arrays and uses the group as the authoritative question type. Exact counts, choices, answer keys, uniqueness, and lesson grounding remain application checks. Other Groq models and OpenAI retain JSON object mode. Sources: [Groq structured output](https://console.groq.com/docs/structured-outputs), [Groq OpenAI compatibility](https://console.groq.com/docs/openai), [Groq reasoning parameters](https://console.groq.com/docs/reasoning).

When `400/json_validate_failed` includes parsable `failed_generation`, its output is considered a candidate only: every item still passes shared structure and integrity validation. Refusals and malformed JSON are never salvaged. Valid questions are retained, and the single recovery request asks only for missing/rejected types using the same prepared lesson. A configurable small reserve of MC candidates helps replace repeated choice sets without a third provider call. Surplus items are discarded only when all requested types/counts can be satisfied by validated questions. Wrong distractors need not be true facts quoted from the lesson; the correct answer and source evidence must remain grounded, and four unique options and choice-set uniqueness are still enforced. No provider response is persisted before final validation. Errors that omit token usage are marked `usageIncomplete` in logs; reported totals include only available usage.

Server logs under `[Quiz AI provider]` record provider/model selection, failure category/status/code/type/cause and original stack frames, provider request IDs, retry/fallback activation, elapsed duration, available token usage, and final provider. Validation issue paths/rules also appear in the flat `validationIssues` string so the default Node console depth cannot collapse them into `[Object]`. Provider bodies and messages are omitted because they can echo lesson text. SDK debug logging is disabled for these clients. The response structure is retained, with `aiStatus` reporting `groq_generated` or the existing `openai_generated`; no frontend changes are required. The existing admin AI diagnostic continues to inspect OpenAI only; inspect backend logs for Groq diagnostics.

### Testing and cloud deployment

`quizResponseValidation.js` normalizes compatible representations before the existing integrity checks: nullable optional fields, MC `correctAnswer` used as the answer key, boolean true/false answers, numeric strings for points/weights, and essay answer text supplied as `answerKey`. It never fills in missing lesson evidence or fabricates answers. Invalid-response diagnostics identify the validation stage, question counts, and fixed field paths/rules without logging generated values. The bounded recovery instruction includes those diagnostics so the model can correct the failed fields.

Run `npm test` from `backend`. Tests use Node's built-in test runner and mock AI transport and database calls; no paid API calls or MongoDB connection are needed. They cover primary success, all eligible HTTP statuses, timeout/network errors, authentication/configuration/policy failures, recovery, total deadlines, cancellation, all existing generated question types, endpoint/credential isolation, and draft deduplication.

Document tests extract actual generated TXT, PDF, DOCX, and PPTX fixtures. Line boundaries are retained for bullet-style lessons; PPTX XML is decoded and slides sorted numerically. Empty, corrupt, binary-as-TXT, and unreadable documents are rejected before AI generation. The existing 25,000-character document ceiling now returns `DOCUMENT_TOO_LARGE` instead of silently dropping content. Scanned PDFs still require external OCR. PDF parser resources are released and file reads are asynchronous. Metadata/logs identify the actual document type, extracted/cleaned lengths, prepared payload size, and configured output limit without logging lesson content.

`node utils/diagnoseQuizAi.js` explicitly performs one live Groq request with a synthetic lesson and no database/OpenAI access. `--mixed` checks the default 28-question schema. `--application` exercises the actual quiz prompt and application validation with OpenAI disabled; it may use the normal bounded Groq recovery. `--file <absolute-path>` explicitly substitutes a supplied PDF/DOCX/PPTX/TXT lesson for the synthetic one. These diagnostics are opt-in, use the backend `.env`, and consume Groq quota; they are not part of automated tests. They log structure/counts only, not generated text or document content.

Use the existing backend install/start process (`npm ci`, then `npm start`) with the environment variables above. No new dependencies, database schemas, frontend build changes, or CI/hosting changes are required. The existing dependency stack should run on a supported Node version; verification was performed with Node 24.14.0. Set the host/reverse-proxy HTTP timeout above the configured AI budget plus document processing/database time. The AI budget does not bound the existing extraction or database pipeline.

Persistence remains outside provider retries, so a provider failure cannot create a draft and fallback cannot save twice. Existing in-flight deduplication is process-local, and the existing unique teacher/content hash handles matching persisted hashes. This change does not introduce cross-instance request idempotency or database transactions. Cancellation after database persistence has started and partial database write failures retain the existing persistence limitations. Live provider access, host timeouts, and MongoDB persistence must be verified in the deployment environment.

### Essay grading diagnostics

Essay grading uses Groq first and OpenAI as fallback, using the existing `GROQ_API_KEY`/`GROQ_MODEL` and `OPENAI_API_KEY`/`OPENAI_MODEL` configuration. Each provider gets a 20-second budget covering queue wait, network I/O, and at most one invalid-output repair or zero-credit audit. Quota, authentication, and connection errors proceed to fallback without retrying the same provider. GPT-OSS Groq models use a strict essay evaluation schema and medium reasoning effort; quiz generation retains its existing settings. A Groq repair/audit uses JSON mode and `GROQ_ESSAY_REVIEW_MODEL` (default `openai/gpt-oss-120b`) to improve partial-credit judgments; the ordinary first-attempt and quiz models remain unchanged. Both providers failing still produces pending teacher review, never a fabricated zero.

New essay scores, criterion scores, and question maxima use whole numbers only. Every integer from zero through the maximum is available. Rubric allocations use whole points and approximate the supplied relative weights. When there are more criteria than available points, their concepts are assessed together so no concepts are dropped just to avoid decimals. Decimal AI outputs are rejected and receive the existing bounded repair/fallback handling. The teacher essay score input and answer-override endpoint require whole points. Historical saved scores, including decimal scores, remain unchanged; no submission migration or automatic regrading occurs.

The prompt evaluates accuracy, relevance, essential coverage, understanding, and reasoning only when required by the question. It uses the 0–10 scale as proportional guidance, allowing scores between the anchors. Correct paraphrases and concise complete answers deserve comparable credit; verbosity earns no extra credit. Mixed answers retain credit for their correct concepts while losing points for relevant errors and omissions. A nonblank zero, or a zero-scored criterion with quoted student evidence, triggers a targeted zero-credit audit on the first attempt. This checks each zero-scored criterion for overlooked independently correct assertions, using the same one-retry and time budget. Blank answers still earn zero locally. The reference and lesson establish correctness but do not count as evidence of what the student wrote. Each credited criterion requires supporting quotes from the student's text; invented quotes are rejected. Evidence normalization permits whitespace, punctuation, capitalization, and surrounding quotation marks without performing keyword-based grading.

Every graded result returns score, maximum points, overall explanation, correct concepts in `strengths`, weaknesses, missing/incorrect concepts, specific suggestions, and criterion scores with explanations and supporting evidence in `rubricBreakdown`. Validation rejects nonnumeric, nonfinite, decimal, out-of-range, incomplete, or inconsistent evaluations. Zero scores cannot coexist with identified creditworthy content, partial credit requires deductions and improvement suggestions, and full marks cannot list missing required concepts. These checks enforce structural and explicit feedback consistency; semantic judgments still require teacher oversight.

Previously, essays used OpenAI alone. Any configuration, quota, transport, or invalid-output error returned a numeric zero, and the submission controller finalized that result as graded. Live verification on October 19, 2026 observed OpenAI returning HTTP 429 with `credit_balance_exhausted`. Failed evaluations now retain null scores and `pending_review`; submissions remain `submitted`, have no pass/fail result or grading timestamp, and display "Pending teacher review". Actual rubric-based zeros remain graded zeros. Teacher review can resolve individual pending essays; the submission becomes graded once every pending essay is resolved. Existing saved submissions are not automatically regraded or migrated.

Structured JSON logs prefixed `[Essay AI grading]` record a request ID, assessment/question IDs when available, maximum points, provider/model, attempts, repairs, fallback activation, timings, input lengths, compaction, provider request IDs, token usage, validation failure rules, criterion scores, totals, and pending-review outcomes. Answer, reference, and feedback descriptors use per-process HMAC fingerprints and redacted content by default. Provider error messages/bodies and credentials are omitted. Logs go to standard output for the existing collector or terminal.

For protected content diagnostics, `AI_ESSAY_LOG_ENCRYPTION_KEY` accepts a base64-encoded 32-byte secret supplied through the environment. With a valid key, the answer, reference answer, rubric, criteria, final feedback, correct/missing concepts, and suggestions are logged inside AES-256-GCM `protectedContent` envelopes. Each envelope has a fresh IV, authentication tag, and request/event associated data. Configured credentials and recognizable API-key strings are redacted before encryption. The encryption key is never logged. Missing or invalid keys leave content redacted and do not disrupt grading; retain keys separately from log storage and restrict access to both. Plaintext content logging is not enabled.

From `backend`, run `npm run diagnose:essay` for an explicit live test of all twelve requested answer-quality scenarios plus a wholly incorrect regression case, through the actual answer-grading and submission-total services. Requests are spaced 20 seconds apart by default to respect small provider token allowances; `ESSAY_DIAGNOSTIC_INTERVAL_MS` can adjust that interval from 0 through 60000. The test consumes API quota and performs no database writes or student-account operations. `npm run diagnose:essay -- --case=minor_omission` runs selected named cases and saves `essay-grading-subset.json` instead of overwriting the full report.

After a correction, `npm run diagnose:essay -- --failed` reruns failed cases and cases whose answer or expected ranges have changed, retains unchanged passing results, recomputes consistency comparisons, and preserves previous results under `previousRuns` plus the original logs. `verificationMode` distinguishes a fresh run from incremental verification; historical failures are retained for inspection.

The full report at `backend/diagnostics/essay-grading.json` contains the synthetic question, answers, predefined expected score ranges, actual scores, feedback, correct/missing concepts, suggestions, criterion breakdown, consistency checks, and structured logs. It compares complete, paraphrased, and concise correct answers within a one-point tolerance. The process exits nonzero for unavailable evaluations, out-of-range scores, missing/inconsistent feedback, or failed comparisons. Automated `npm test` separately verifies every integer score 0–10, decimal rejection and repair, scaled whole-point rubrics, preservation of historical scores, retry/fallback behavior, invalid outputs, evidence validation, privacy, and feedback checks using mock transport. The live diagnostic evaluates actual model semantics on the synthetic lesson. Blank-answer handling is tested directly by the service; assessment submission still requires all answers.
