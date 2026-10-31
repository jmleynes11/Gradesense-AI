from pathlib import Path
from zipfile import ZipFile
from copy import deepcopy
from hashlib import sha256
from lxml import etree as E
import json

BASE=Path(__file__).parent
SRC=Path(r'C:\Users\jmley\AppData\Local\Temp\codex-file-preview-sAiyFM\SYSTEM TESTING.docx')
OUT=BASE.parent/'GradeSense-AI Completed System Testing Report.docx'
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
NS={'w':W}
def tag(n): return '{'+W+'}'+n
z=ZipFile(SRC)
root=E.fromstring(z.read('word/document.xml'))
body=root.find('w:body',NS)
P=body.findall('w:p',NS)
T=body.findall('w:tbl',NS)
contract=(BASE/'artifact.md').read_text(encoding='utf-8')
assert sha256(SRC.read_bytes()).hexdigest() in contract

def text(p,s):
    ts=p.findall('.//w:t',NS)
    if ts:
        ts[0].text=s
        ts[0].set('{http://www.w3.org/XML/1998/namespace}space','preserve')
        for t in ts[1:]: t.text=''
    else:
        r=E.SubElement(p,tag('r'))
        t=E.SubElement(r,tag('t'));t.text=s
    return p

def prop(p,name,val='1'):
    pr=p.find('w:pPr',NS)
    if pr is None: pr=E.Element(tag('pPr'));p.insert(0,pr)
    el=pr.find('w:'+name,NS)
    if el is None: el=E.SubElement(pr,tag(name))
    el.set(tag('val'),val)

def paragraph(s,heading=False):
    p=deepcopy(P[70] if heading else P[15])
    for b in p.findall('w:bookmarkStart',NS)+p.findall('w:bookmarkEnd',NS):p.remove(b)
    for a in list(p.attrib):
        if a.endswith('paraId'):del p.attrib[a]
    text(p,s)
    if heading:prop(p,'keepNext')
    return p

def before(anchor,items):
    for s in items:anchor.addprevious(paragraph(s))

def fill_table(i,rows,headers=None):
    t=T[i]; rr=t.findall('w:tr',NS)
    proto=deepcopy(rr[1])
    for r in rr[1:]:t.remove(r)
    if headers:
        for c,s in zip(rr[0].findall('w:tc',NS),headers):text(c.find('w:p',NS),s)
    for values in rows:
        r=deepcopy(proto)
        for p in r.findall('.//w:p',NS):
            for a in list(p.attrib):
                if a.endswith('paraId'):del p.attrib[a]
        for c,s in zip(r.findall('w:tc',NS),values):
            ps=c.findall('w:p',NS);text(ps[0],str(s))
            for p in ps[1:]:c.remove(p)
        t.append(r)
    return t

PASS='ILL-PASS';FAIL='ILL-FAIL'
# Each case: module, procedure summary, acceptance criterion, hypothetical outcome,
# fixture/precondition, input, reproducible steps.
cases=[
('Authentication','Sign in as each of three roles; sign out.','Correct role dashboard; protected routes require a token.','Example: all three dashboards opened; logout returned to login.',
 'Active synthetic admin, teacher T1 and student S1; clean browser session.','Role accounts from the synthetic fixture; [valid test passwords].','1. Sign in as each role in a separate session. 2. Open the dashboard and a protected URL. 3. Sign out and use Back, then refresh.'),
('Authentication','Submit wrong password and an unknown account.','Reject both attempts without creating a session or revealing account existence.','Example: generic credential errors; neither attempt created a session.',
 'T1 exists; unknown@example.test does not.','T1 with a wrong password; unknown@example.test with the same password.','1. Submit each credential pair. 2. Inspect returned message and session storage. 3. Request a protected endpoint without a token.'),
('Registration','Register a valid student; repeat the same email.','Create one student account; reject duplicate email; never grant admin role.','Example: one student created; duplicate refused; role remained student.',
 'Disposable database; registration permitted; no account with new.student@example.test.','Synthetic name; unique .test email; valid password; required agreements.','1. Complete student registration. 2. Sign in. 3. Repeat the same email. 4. Inspect role and account count.'),
('Subjects','T1 creates subject A and enrolls S1.','Persist ownership and membership; subject B owned by T2 stays inaccessible.','Example: S1 saw A; T1 could not edit B.',
 'T1 and T2 exist; S1 is not enrolled; subjects A and B have separate owners.','Subject A; S1 synthetic user identifier.','1. Create A as T1. 2. Add S1. 3. Reload as S1. 4. Attempt to edit B as T1.'),
('Drafts','Save a manually authored assessment and reopen it.','Save as draft with unpublished flag; retain questions and instructions.','Example: draft persisted; student lists omitted it.',
 'T1 owns A; S1 is enrolled in A.','A-draft; two MC questions at 2 points each; instructions.','1. Create assessment. 2. Add questions and save. 3. Reopen as T1. 4. Check student list and direct access as S1.'),
('Publishing','Publish a reviewed draft using the publish action.','Only explicit publication exposes the assessment to enrolled students.','Example: S1 could load the published quiz; unenrolled S2 could not.',
 'A-draft is valid and reviewed; S1 enrolled, S2 unenrolled; window is open.','A-draft identifier; valid start/end and duration.','1. Confirm draft is hidden. 2. Publish as T1. 3. Reload as S1 and S2. 4. Inspect publication state.'),
('AI generation','Generate exact requested question counts from lesson text.','Return validated 5 MC, 2 true/false, 1 identification and 2 essays; save one draft.','Example: 10 valid questions; correct type counts; draft stayed unpublished.',
 'T1 owns A; provider transport is stubbed or isolated test credentials are configured.','Synthetic electricity lesson; counts 5/2/1/2; MC/TF/ID worth 2, essays 10.','1. Supply lesson and counts. 2. Generate once. 3. Inspect type counts, keys, options and source grounding. 4. Check saved draft and student visibility.'),
('Lesson upload','Generate from equivalent PDF, DOCX, PPTX and TXT lessons.','Extract readable text in order; reject unreadable source before provider use.','Example: four readable fixtures processed; scanned-only PDF required OCR.',
 'Four synthetic lessons contain the same concepts; no real student data.','Four files below 10 MiB and 25,000 extracted characters; scanned PDF control.','1. Upload each readable file separately. 2. Compare extracted concepts. 3. Generate and review. 4. Upload scanned-only control and inspect error and provider call count.'),
('AI validation','Return duplicate choices, missing keys or unsupported answers.','Reject invalid candidates; accept only grounded, unique, schema-valid questions.','Example: invalid candidates rejected; bounded recovery returned a valid draft.',
 'Provider stub can return malformed candidates followed by valid recovery output.','Candidate with duplicate MC options; candidate missing answerKey; off-topic key.','1. Inject each invalid response. 2. Run generation. 3. Inspect validation and recovery limits. 4. Confirm invalid questions were never persisted.'),
('Submission','S1 completes an open published assessment.','Persist one submission with answers, time and student/assessment references.','Example: one submitted record; teacher list displayed the same answers.',
 'S1 enrolled in A; A-grade published and open; no existing S1 submission.','Complete A-grade answers; agreed synthetic start/end times.','1. Start assessment. 2. Answer each item. 3. Submit once. 4. Reload student history and teacher submissions.'),
('Objective grading','Grade correct, incorrect and accepted-alias answers.','Award full item points only for normalized accepted answers; incorrect is zero.','Example: 9 of 10 two-point items correct; objective subtotal 18/20.',
 'Separate objective fixture with 10 items, each worth 2; fixed reviewed answer keys.','Nine correct answers, including one allowed alias, and one wrong answer.','1. Submit fixture. 2. Compare each answer to teacher keys. 3. Sum item scores. 4. Confirm subtotal and rounding.'),
('Essay grading','Grade two essays and reconcile the mixed assessment total.','Whole-number rubric scores within maxima; totals equal 32/40 and 80%.','Example: essays 8/10 and 6/10; objective 18/20; total 32/40, 80%.',
 'A-grade: 10 objective items at 2 and two essays at 10; reviewed rubric and lesson.','Objective subtotal 18; essay responses E1/E2; valid stub scores 8 and 6.','1. Submit mixed assessment. 2. Wait for processing to finish. 3. Review criterion sums and bounds. 4. Check teacher, student and stored totals.'),
('Teacher review','Override the second essay from 6 to 8 with a reason.','Store reviewer/reason; total becomes 34/40, 85%; preserve teacher decision.','Example: review UI showed 34/40 and 85%; reason retained after refresh.',
 'A-grade has the TC-F-012 result; T1 owns A; pending AI task can be delayed.','Second essay final score 8; reason: credit for correct supporting explanation.','1. Open answer review as T1. 2. Set score 8 and reason. 3. Save and reload. 4. Release delayed AI result and confirm it cannot overwrite review.'),
('Reports','Export PDF and Excel after the teacher override.','Both exports match the final reviewed 34/40, 85%, owner and subject filter.','Example: exports retained 32/40 and 80% while UI showed 34/40; BUG-001.',
 'Continue from TC-F-013; report generation is a hypothetical failing example.','PDF and Excel exports for A-grade and S1.','1. Save override. 2. Generate fresh PDF and Excel files. 3. Compare per-item score, final total, percentage and student identity with UI and database.'),
('Privacy','Try cross-student, cross-teacher and draft detail access.','Deny unauthorized records; authorized student payload omits keys and source text.','Example: unauthorized requests denied; student detail contained no answer keys.',
 'T1/T2 own separate subjects; S1/S2 have separate submissions.','Another user submission ID; draft ID; published authorized ID.','1. Exchange IDs in direct requests under each role. 2. Inspect status and payload. 3. Load a permitted student assessment and search for keys, rubric answers and lessonContent.'),
('Notifications','Publish, submit and grade; open the notification panel.','Correct recipient and destination; read state persists; duplicate events do not multiply.','Example: S1 received assessment/grade notices; T2 received none.',
 'S1 enrolled in A; T2 has no connection to A; fresh notification fixture.','Publication, submission and grading events; repeated same event identifier.','1. Trigger each event. 2. Open S1 panel. 3. Follow destination and mark read. 4. Reload and replay the same event.'),
('Quiz Arena','Join an active game, answer and view results.','Valid participation; scores and rank agree with stored attempts; no cross-subject leak.','Example: S1 joined once; leaderboard score matched the saved attempt.',
 'T1 hosts a synthetic game for A; S1 eligible; S2 unauthorized.','Valid game code; one correct and one incorrect response; invalid-code control.','1. Join as S1. 2. Submit responses. 3. Finish and compare results. 4. Retry invalid code and unauthorized S2 access.'),
('Lists and filters','Page through assessment summaries; filter by subject/status.','Correct 20-item page and hasMore; draft filter includes AI drafts; no lesson bulk.','Example: pages returned 20 then 5 unique summaries; filters matched.',
 'A list fixture has exactly 25 teacher-owned assessments and controlled statuses.','view=summary; page 1 then 2; limit 20; subject A; draft status.','1. Load page 1 and 2. 2. Compare IDs for omissions/duplicates. 3. Apply filters. 4. Inspect summary payload for unnecessary lesson/version content.'),
('Duplicate handling','Double-click generation and retry submission.','Avoid duplicate persisted drafts and submissions for the same logical operation.','Example: one shared in-process generation; one submission record after retry.',
 'Single backend instance; identical teacher/content requests; submission unique index present.','Two concurrent identical generation requests; same S1 assessment submitted twice.','1. Send both generation requests concurrently. 2. Count provider calls and saved drafts. 3. Retry submission. 4. Inspect database count. Cross-instance behavior requires separate validation.'),
('Assessment window','Open before start, after close and after time expires.','Enforce server-authoritative availability and duration; preserve permitted answer state.','Example: early/closed starts denied; expired attempt marked timeExpired.',
 'Disposable assessment sessions; agreed timezone; controlled clock offsets.','Start minus 1 second; end plus 1 second; duration limit plus 1 second.','1. Attempt start at each boundary. 2. Run one open attempt past duration. 3. Refresh timer and submit. 4. Inspect availability response and persisted expiry flag.'),
]

for i,s in {
1:'Title : GradeSense AI System Testing',
2:'Group Name : [Group name]',
3:'Technical Evaluators (IT Experts): [IT evaluator names and credentials - unverified]',
15:'This is an illustrative, unverified system testing report for GradeSense AI. It provides executable scenarios, proposed acceptance criteria and hypothetical outcomes. No system tests, benchmarks, expert evaluations or defect retests were performed for this report. Actual executions recorded: 0. The example set contains 72 cases, 68 illustrative passes and 4 illustrative failures across 3 hypothetical defects; it does not establish deployment readiness.',
17:'The planned testing objectives are to:',
25:'Confirm corrections through actual retesting before closing any verified defect.',
26:'Establish readiness only after real execution evidence and authorized review.',
30:'System Name: GradeSense AI',
31:'Description:',
32:'GradeSense AI is a MERN grade-management and assessment application with administrator, teacher and student roles. It supports subjects and enrollment, manual/AI assessment drafts, publication, timed student submissions, objective and rubric-based essay grading, teacher review, analytics, notifications, Quiz Arena, and PDF/Excel reports. The available project files establish feature context only; deployed behavior remains unverified.',
38:'The following components are covered by the illustrative scenarios:',
42:'Subjects, assessments, submission, grading, teacher overrides and Quiz Arena',
48:'Role, ownership, enrollment, answer-key confidentiality and token checks',
52:'Teacher/student grade views, analytics, PDF/Excel reports and notifications',
54:'The following are excluded from the example execution totals:',
55:'Live cloud/provider verification; production migration; destructive production changes; real student records; institution-specific grading policies; legal/compliance certification; full penetration testing; expert/user acceptance ratings; statistical AI fairness or accuracy claims.',
56:'Real backup/restore and disaster recovery are unverified: admin backup/restore handlers are mocks. Scanned-PDF OCR, cross-instance generation idempotency, long-duration availability and infrastructure failover need separate evidence. Programming content may be assessed as text; secure execution of arbitrary student code is not assumed.',
58:'Proposed approach: requirements-based scenarios, synthetic fixtures, boundary and negative cases, controlled provider fault injection, database reconciliation and evidence capture. All expected behaviors are proposed acceptance criteria, not proof of implementation.',
59:'Requirements → Planning → Case Development → Actual Execution → Defect Verification → Correction → Retesting → Evaluation',
61:'Status legend throughout: ILL-PASS and ILL-FAIL mean illustrative, unverified outcomes only. Example means a fabricated execution narrative. Assumed means an environment or data proposal, not an observed configuration. Actual status for every scenario is NOT EXECUTED. The template requirement for 10 IT experts remains pending; no expert participation is claimed.',
65:'All entries in 6.1 and 6.2 are illustrative environment assumptions. Freeze exact runtime, browser, database, dependency and model versions against [build/commit] before actual execution. Do not use production credentials or records.',
67:'Assumed synthetic fixture only. No fixture was loaded or test record created for this report. Use reserved .test email addresses, artificial names and reviewed lesson text; reset the isolated database between mutation scenarios.',
68:'Fixture arithmetic: A-grade has ten two-point objective items and two ten-point essays, maximum 40. A proposed run yields 18 + 8 + 6 = 32 (80%); changing the second essay to 8 yields 34 (85%). Separate A-AI fixture requests 5 MC, 2 true/false, 1 identification and 2 essays, maximum 36. These fixtures must not be conflated.',
72:'All functional summary outcomes are illustrative/unverified. Detailed prerequisites, inputs, steps and evidence requirements are in Appendix A. The full-format example above repeats TC-F-014 and is counted once.',
74:'Input cases IV-001 through IV-008 are independent illustrative checks. Inspect both client messaging and server rejection; bypass client validation when testing server controls. Example outcomes do not establish that validation is enforced.',
78:'Planned integrity checks; none verified:',
79:'[Not executed] MongoDB _id uniqueness and correct record identity.',
80:'[Not executed] Mongoose reference checks; MongoDB does not supply relational foreign keys.',
81:'[Not executed] No orphaned subject, assessment, question, submission or feedback references.',
82:'[Not executed] Required title, role, student and assessment references.',
83:'[Not executed] Valid types, integer essay scores and bounded maxima.',
84:'[Not executed] Unique email and assessment/student submission combination.',
85:'[Not executed] Inject partial write failures and reconcile records; do not assume multi-document transactions.',
86:'[Not executed] Admin mock response is not recovery evidence; actual restore excluded.',
89:'The API scenarios use synthetic payloads and controlled stubs. A future live run must capture provider/model, correlation ID, status, latency and redacted errors; never record keys, lesson text or student answers in shared logs.',
91:'[Not executed] Valid authorized requests and response schema.',
92:'[Not executed] Invalid identifiers, missing fields and invalid page limits.',
93:'[Not executed] Missing/expired tokens and ownership checks.',
94:'[Not executed] Attempt timeouts and total quiz budget exhaustion.',
95:'[Not executed] Stable error shape and actionable UI state.',
96:'[Not executed] Schema, exact counts, uniqueness and lesson grounding.',
97:'[Not executed] 429, Retry-After and bounded fallback.',
98:'[Not executed] Both-provider failure, cancellation and pending teacher review.',
99:'Configured quiz defaults in project documentation are a 65,000 ms total AI budget and 20,000 ms attempt cap; actual deployment values are [verify]. An AI budget does not bound document extraction/database time. Essay grading uses a separate provider workflow; both-provider essay failure must remain pending teacher review rather than a fabricated zero.',
102:'Illustrative average response time: 0.62 s for PT-002 only; unverified.',
103:'Illustrative minimum response time: 0.21 s for the same PT-002 sample; unverified.',
104:'Illustrative maximum response time: 1.84 s for the same PT-002 sample; unverified.',
105:'Assumed concurrent users: 1 for PT-002; 50 for PT-004; 100 for PT-005.',
106:'Illustrative error rate: PT-002 0/200 = 0%; PT-004 4/2,000 = 0.20%; PT-005 64/2,000 = 3.20%. No measurements taken.',
107:'Actual system availability: [Not measured]. A short synthetic load example cannot establish uptime or an SLA.',
108:'Proposed protocol: record [build], [UTC/Asia-Manila timestamps], test runner, host resources and network conditions. Warm up 2 minutes, then run a 10-minute sample per workload. Capture client timings and server/query telemetry separately. Use 20% login/session, 40% list/detail, 20% dashboard and 20% submission requests; stub AI for load isolation, then assess live AI separately. Numerical values below are invented examples.',
114:'Compatibility IDs: BR-001..004 and DEV-001..004; 8 separate illustrative cases. Browser versions and exact OS releases are placeholders. Repeat login, quiz completion, review and export on each listed combination; record version and device evidence during actual execution.',
118:'Use ISO/IEC 25010:2023 as an organizing framework for the nine quality characteristics already listed in this template. This is an illustrative coverage mapping, not a conformance assessment, certification or expert rating.',
119:'Edition reference: ISO/IEC 25010:2023, second edition, product quality model; https://www.iso.org/standard/78176.html. No numerical quality score is assigned without defined measures and actual observations. ISO mapping rows are excluded from test-case totals.',
123:'Every BUG entry below is hypothetical and unverified; none is a confirmed issue in the current build. Severity describes the example impact only. No actual ticket, fix, developer identity or closure is claimed. Appendix E contains reproducible hypothetical records.',
125:'Corrective actions are proposals only. Date-fixed fields remain placeholders; retest state is NOT EXECUTED. A defect may be closed only after the referenced case passes with retained evidence on a named build.',
127:'REG-001..005 show illustrative baseline regression outcomes only. They are not post-fix evidence and do not close BUG-001..003. After any actual correction, rerun these checks plus the affected failing cases, using the same fixture and recorded build.',
130:'Pass Rate Formula',
131:'Illustrative pass rate = (68 illustrative passes / 72 example cases) × 100 = 94.44%. Actual executions = 0; actual pass rate = not available.',
132:'The table counts one example outcome per unique ID: F 20, IV 8, DB 6, API 8, PT 5, SEC 6, BR/DEV 8, UI 6 and REG 5. Four failing cases map to three hypothetical defects: F-014 → BUG-001; PT-005 → BUG-002; DEV-004 and UI-006 → BUG-003. Repeated details in Appendices A/E and the full-format case are not additional tests.',
135:'☐ Passed – Ready for Deployment [not assessed]',
136:'☐ Passed with Minor Issues [not assessed]',
137:'☐ For Further Improvement [actual evaluation pending]',
138:'☐ Failed – Major Corrections Required [not assessed]',
140:'Based on the illustrative scenario set, the proposed verification covers:',
141:'The assessment lifecycle, score arithmetic, AI validation/fallback, teacher review, ownership, reporting and interface behavior. Hypothetical results show why report reconciliation, capacity and mobile access require explicit checks. No actual functionality, security, AI accuracy or readiness conclusion can be drawn from this report.',
142:'The hypothetical defects and issues are:',
143:'One high-severity grade-export discrepancy and two medium-severity capacity/mobile issues. All remain unverified example records with retesting pending. The sample 94.44% pass rate is a document example only.',
144:'Actual technical assessment:',
145:'☐ Technically Acceptable   ☐ Acceptable with Minor Revisions   ☐ Requires Further Testing   ☐ Not Acceptable',
146:'No assessment option is selected. Actual testing, independent review and signed approval are pending. Deployment authorization is not granted by this report.',
148:'The following actions are proposed for a future verified testing cycle:',
149:'Freeze [build/commit] and obtain the institution-approved scoring, publication, retention and access requirements before executing the 72 scenarios.',
150:'Reproduce any suspected report discrepancy; reconcile final reviewed scores across UI, database, PDF and Excel; retain the teacher review reason and audit evidence.',
151:'Measure realistic concurrency with controlled workloads, payload sizes and AI latency; use actual percentiles and error counts before setting capacity claims.',
152:'Verify mobile access, keyboard navigation and clear pending/error states; use human review for consequential AI scoring and treat integrity indicators as review cues.',
153:'Implement and rehearse real database backup/restore separately from admin mocks; verify privacy controls and provider configuration in the intended deployment.',
154:'Obtain actual programmer/analyst and 10-IT-expert participation required by the template; attach identities, execution records, corrections, retests and approval signatures only when verified.',
156:'Approval is pending. All names, signatures and dates below are unknown placeholders; no tester or evaluator identity has been supplied or verified. This illustrative draft must not be represented as an executed or signed report.',
159:'Detailed functional scenarios follow. Each case uses the same hypothetical outcome and ILL status as Section 8. Tester: [Tester name - unverified]; execution date/time: [Not executed]; build: [Build/commit]. Planned evidence is a capture requirement, not an existing attachment.',
161:'Actual screenshots: [Not captured - no tests executed]. Evidence register for a future run:',
162:'[Screenshot F-006] Teacher publish state and enrolled student view; redact personal data.',
163:'[Screenshot F-014] Compare final reviewed grade with both exports if a discrepancy is reproduced.',
164:'[Screenshot API-008] Provider-failure message and pending-review state; omit keys and answers.',
165:'[Screenshot BUG-001..003] Before/after capture on named builds after a verified correction.',
166:'[Screenshot retest] Repeated failing case, actual status, tester and timestamp after correction.',
168:'Actual logs: [Not collected]. Required future evidence, stored with restricted access:',
169:'[Application log] Correlation ID, route, role and result; no raw student responses.',
170:'[API log] Provider/model, failure class, retry/fallback, elapsed time and request ID; no API secrets or lesson text.',
171:'[Error log] Reproduced failure, stack and sanitized context linked to a verified defect ID.',
172:'[Database evidence] Record IDs/counts, score reconciliation and index presence; no production dump.',
173:'[Performance evidence] Raw timestamps, request/error counts, percentile method, resources and workload settings.',
175:'Assumed topology only: one React browser client → Express/Node API → isolated MongoDB; outbound Groq and OpenAI connections where enabled. One backend instance for process-local deduplication. Frontend URL [Test URL]; API URL [Test API URL]; database [Isolated test DB]; commit [Build/commit]; run window [Date/time Asia/Manila]; network trace [Evidence path]. No deployment was inspected.',
177:'All records below are hypothetical/unverified defect documentation. Owners, dates, evidence and fixes remain placeholders. They are examples of reporting practice, not findings from executed tests.',
}.items():text(P[i],s)

notice=paragraph('ILLUSTRATIVE AND UNVERIFIED — NO ACTUAL TEST EXECUTION. All example outcomes, timings, defects, tester references and environment assumptions are hypothetical. Unknown identities, dates and build information remain placeholders. Actual executions: 0.')
P[1].addprevious(notice)

fill_table(0,[
('Project/System Name','GradeSense AI'),('Project Title','GradeSense AI grade management and AI assessment system'),
('Version','[Tested application version / commit - unverified]'),('Testing Date','[Actual testing date - not executed]'),
('Testing Environment','Illustrative isolated environment; all Section 6 specifications assumed/unverified'),
('Tested By','[Tester names / roles - unverified]; [10 IT expert names - unverified]'),
('Developer/Development Team','[Development team / institution]'),('Test Report Version','1.0 illustrative draft'),
('Status','Draft - illustrative/unverified; actual execution and approval pending')])
fill_table(1,[('Administrator','Manage accounts, dashboards and audit/monitoring features.','Admin-authorized records; backup/restore is mock only.'),('Faculty/Staff (Teacher)','Manage owned subjects, assessments, submissions and reviewed scores.','Owned teacher records and enrolled learners.'),('Student/User','Take assigned assessments; review own grades and feedback.','Enrolled published/closed assessments and own records.')])
fill_table(2,[(str(i+1),a,b) for i,(a,b) in enumerate([
('User Authentication','Registration, login/logout, JWT and role guards.'),('Dashboard','Teacher, student and admin summary views.'),('User Management','Admin account management and role visibility.'),('Subjects and Enrollment','Teacher-owned subjects and assigned learners.'),('Assessment Lifecycle','Draft, edit, review, publish, close and timing.'),('AI Quiz Generation','Lesson upload/text, validation and bounded fallback.'),('Submission and Grading','Objective keys, rubric essays and pending review.'),('Teacher Review','Score overrides, reasons and final grade reconciliation.'),('Reports and Analytics','PDF/Excel exports, history and progress.'),('Notifications and Announcements','Role-appropriate messages and destinations.'),('Quiz Arena','Game participation, attempts and results.'),('Database and Audit','MongoDB persistence, indexes and audit records; admin recovery mocks.')])])
methodrows=[]
for name,purpose in [('Unit Testing','Existing test files provide design context; no suite run for this report.'),('Integration Testing','Verify score/report and provider/persistence boundaries.'),('System Testing','Exercise full teacher-to-student assessment workflow.'),('Functional Testing','Execute F-001..020 against approved requirements.'),('Usability Testing','Use UI-001..006 and documented user tasks.'),('Performance Testing','Use PT-001..005; all numbers are illustrative.'),('Security Testing','Use SEC-001..006 and privacy checks.'),('Compatibility Testing','Use BR/DEV matrices with exact versions recorded.'),('Database Testing','Use DB-001..006 and reconciliation checks.'),('API Testing','Use API-001..008 with controlled faults.'),('Regression Testing','Use REG-001..005 after verified changes.'),('User Acceptance Testing','Programmer/analyst and 10-IT-expert evaluation remains pending.')]:methodrows.append((name,purpose,'Not executed'))
fill_table(3,methodrows)
fill_table(4,[('Processor','Assumed: client four-core CPU; server 2 vCPU. Actual: [verify].'),('RAM','Assumed: client 8 GB; API server 4 GB; DB 4 GB. Actual: [verify].'),('Storage','Assumed: client SSD; server/DB 20 GB available. Actual: [verify].'),('Display Resolution','Assumed: desktop 1920×1080; laptop 1366×768; mobile 390×844 CSS px.'),('Network','Assumed: 20 Mbps client link; 30–80 ms RTT; stable test LAN/cloud route.'),('Other','Assumed: isolated test host, synthetic records, one API instance; no production changes.')])
fill_table(5,[('Operating System','Assumed: Windows 11 client; Linux server [exact release].'),('Web Browser','Assumed: Chrome/Edge/Firefox/Safari [exact versions pending].'),('Programming Language','Assumed: JavaScript; Node.js [exact supported version]; no runtime verified.'),('Framework','Assumed: React/Vite client; Express API; exact installed versions [verify lockfiles].'),('Database','Assumed: MongoDB [version]; Mongoose [version]; required indexes present [verify].'),('Web Server','Assumed: Node/Express [version], local API port 5000; proxy [verify].'),('API/LLM Service','Assumed: Groq primary, OpenAI fallback; models [record actual configured IDs]. Stub responses for deterministic faults.'),('Other Dependencies','Assumed: JWT, bcryptjs, Multer, Socket.IO, PDFKit, ExcelJS and document parsers [versions pending].')])
fill_table(6,[('User Accounts','Assumed: 1 admin, 2 teachers and 100 students; artificial names and .test emails.','103 proposed'),('Sample Transactions','Assumed: controlled assessment/submission fixtures; reset per case.','25 assessment summaries; 100 submissions proposed'),('Test Questions/Content','Assumed: A-grade 12 items/40 pts; A-AI 10 items/36 pts; no real lesson uploads.','22 primary fixture items'),('Database Records','Assumed: subject A/T1 and B/T2; enrollments and notifications generated only in test DB.','2 subjects; dependent records [fixture-specific]'),('Other','Assumed: 4 readable file types, scanned control, malformed/empty/oversize controls and provider stubs.','4 valid files; 5 invalid/boundary files proposed')])
f=cases[13]
fill_table(7,[('Test Case ID','TC-F-014 — illustrative/unverified'),('Module',f[0]),('Test Objective','Reconcile final teacher-reviewed grades across UI, PDF and Excel.'),('Precondition',f[4]),('Test Input',f[5]),('Test Steps',f[6]),('Expected Result',f[2]),('Actual Result',f[3]+' No actual execution.'),('Status','ILL-FAIL; actual status NOT EXECUTED'),('Remarks','Hypothetical BUG-001, High priority. Tester [name - unverified]; date [not executed]; build [commit]; evidence [not captured].')])
fill_table(8,[(f'TC-F-{i+1:03}',c[0],c[1],c[2],c[3],FAIL if i==13 else PASS) for i,c in enumerate(cases)],['Test Case ID','Module','Test Description','Expected Result','Illustrative Outcome','ILL Status'])
iv=[
('IV-001','Full name','Submit blank or whitespace-only name.','Reject; no account created.','Example: required-name message; no record.'),
('IV-002','Email','Submit student@ and then duplicate .test email.','Reject malformed and duplicate email.','Example: both rejected; count unchanged.'),
('IV-003','Password','Submit fewer than required characters; mismatch confirmation.','Enforce configured rule; show clear mismatch.','Example: rejected; no session. Exact minimum [verify].'),
('IV-004','Essay points','Submit -1, text, and 2.5 as essay maximum.','Accept only valid positive whole-number maxima.','Example: invalid maxima rejected before save.'),
('IV-005','Assessment title','Save blank title while bypassing client validation.','Server rejects required field; no empty assessment.','Example: validation response; no draft saved.'),
('IV-006','Lesson file','Upload .exe, corrupt DOCX and empty TXT.','Reject unsupported/unreadable/empty data before AI.','Example: clear error; provider call count 0.'),
('IV-007','Extracted lesson','Submit 25,001 cleaned characters.','Reject with DOCUMENT_TOO_LARGE; never truncate silently.','Example: rejected; no AI request or draft.'),
('IV-008','Upload size','Upload exactly 10 MiB and 10 MiB + 1 byte.','Apply file limit; oversized request cannot reach AI.','Example: readable boundary accepted; larger file rejected.')]
fill_table(9,[(*r,PASS) for r in iv],['Test ID','Input Field','Test Condition','Expected Behavior','Illustrative Behavior','ILL Status'])
db=[
('DB-001','INSERT','Save a reviewed valid draft; count linked question records.','One owned draft; correct points and references.','Example: draft and 12 linked questions reconciled.'),
('DB-002','READ','Load owned versus other teacher records; paginate 25 rows.','Only authorized records; stable distinct pages.','Example: 20 + 5 records; no foreign subject data.'),
('DB-003','UPDATE','Override E2 6→8; reload submission and feedback.','Persist final 34/40, reviewer and reason.','Example: values retained; no unrelated answer changed.'),
('DB-004','DELETE','Delete an unused teacher-owned draft; reload IDs.','Draft disappears from active views; no exposed orphan content.','Example: draft unavailable; related-data policy [verify].'),
('DB-005','Uniqueness','Insert duplicate email and assessment/student pair.','Indexes prevent duplicate records; controlled response.','Example: both duplicate writes rejected.'),
('DB-006','Mock recovery','Call admin backup/restore in an isolated DB; compare counts.','Explicit mock response; no claim of real backup or restore.','Example: mock message; counts unchanged; recovery unverified.')]
fill_table(10,[(*r,PASS) for r in db],['Test ID','Operation','Test','Expected Result','Illustrative Result','ILL Status'])
api=[
('API-001','Assessment list','GET summary page 1, limit 20, teacher token.','items/page/limit/hasMore; no lesson/version bulk.','Example: valid 20-item summary envelope.'),
('API-002','Student detail','GET permitted assessment, then another subject ID.','Authorized detail omits keys; unauthorized request denied.','Example: permitted data only; second request denied.'),
('API-003','AI primary','POST generate-quiz with valid lesson and counts.','Validated exact counts; save one unpublished draft.','Example: valid Groq-stub response saved once.'),
('API-004','AI fallback','Inject Groq 429, then valid OpenAI output.','Switch directly to fallback; validate once before persistence.','Example: one call per provider; one draft.'),
('API-005','AI hard failure','Inject Groq 401/configuration error.','Return actionable error; do not activate fallback.','Example: fallback calls 0; saved drafts 0.'),
('API-006','AI validation','Inject invalid JSON, then invalid recovery output.','At most two Groq attempts, one eligible fallback; never save invalid output.','Example: bounded calls; only validated fallback draft saved.'),
('API-007','AI timeout/cancel','Exhaust quiz budget; separately disconnect all callers.','Budget returns 504; cancellation aborts work, no later fallback/save.','Example: timeout 504; cancelled run saved 0 drafts.'),
('API-008','Essay provider outage','Fail Groq and OpenAI while grading a nonblank essay.','Keep score/final total pending review; never invent zero.','Example: pending_review; no published final score.')]
fill_table(11,[(*r,PASS) for r in api],['Test ID','API/Service','Request or Fault','Expected Response','Illustrative Response','ILL Status'])
pt=[
('PT-001','Dashboard load','1 user; 30 loads, after warm-up.','Proposed p95 ≤3.0 s.','Example: p95 1.90 s; not measured.',PASS),
('PT-002','Summary API','1 user; 200 completed requests, same 20-row payload.','Proposed p95 ≤1.5 s; errors ≤1%.','Example: mean .62 s; p95 1.20 s; 0/200 errors.',PASS),
('PT-003','Database read','200 indexed ownership-filtered reads; seeded 10,000 submissions.','Proposed p95 ≤200 ms; capture explain plan.','Example: p95 85 ms; not measured.',PASS),
('PT-004','Concurrent load','50 virtual users; 10 min; 2,000 requests; AI stubbed.','Proposed p95 ≤3.0 s; errors ≤1%; no lost grades.','Example: p95 2.40 s; 4/2,000 errors; no loss.',PASS),
('PT-005','Stress load','100 virtual users; 10 min; 2,000 requests; same mix.','Proposed p95 ≤5.0 s; errors ≤2%; no lost grades.','Example: p95 7.80 s; 64/2,000 errors; BUG-002.',FAIL)]
fill_table(12,pt,['Test ID','Performance Metric','Test Condition','Proposed Criterion','Illustrative Measurement','ILL Status'])
sec=[
('SEC-001','Authentication','Wrong password; missing and expired token.','Deny access; no token/session issued for failure.','Example: protected data withheld.'),
('SEC-002','Authorization','Use student token on admin API; use T1 token on T2 records.','Enforce role and ownership server-side.','Example: both requests denied.'),
('SEC-003','Passwords','Inspect synthetic user storage and API responses.','Hash with bcrypt; never expose password/hash to client.','Example: hash stored; credential fields omitted.'),
('SEC-004','Client session','Logout, Back, refresh; request API without stored token.','Clear local session; protected request denied.','Example: login required. Stolen-token revocation not established.'),
('SEC-005','Unsafe input','Submit script-like text and object/operator login fields.','No script execution or auth bypass; reject invalid types.','Example: text inert; malformed credentials rejected.'),
('SEC-006','Assessment privacy','Inspect student detail payload and another student submission URL.','No answer keys/source/rubric answers; no cross-student data.','Example: keys absent; foreign submission denied.')]
fill_table(13,[(*r,PASS) for r in sec],['Test ID','Security Area','Test Procedure','Expected Result','Illustrative Result','ILL Status'])
fill_table(14,[('BR-001 Chrome','[TBD]',PASS,'Assumed Windows 11. Example: login, quiz, review, exports usable.'),('BR-002 Edge','[TBD]',PASS,'Assumed Windows 11. Example: same workflow completed.'),('BR-003 Firefox','[TBD]',PASS,'Assumed Windows 11. Example: no blocking interaction failure.'),('BR-004 Safari','[TBD]',PASS,'Assumed macOS [release]. Example: quiz and download workflow usable.')],['Browser / ID','Version','ILL Result','Illustrative Remarks'])
fill_table(15,[('DEV-001 Desktop','Assumed Windows 11 / Chrome','Assumed 1920×1080',PASS+'; example: workflow usable.'),('DEV-002 Laptop','Assumed Windows 11 / Edge','Assumed 1366×768',PASS+'; example: controls reachable.'),('DEV-003 Tablet','Assumed iPadOS [release] / Safari','Assumed 820×1180 CSS px',PASS+'; example: touch workflow usable.'),('DEV-004 Smartphone','Assumed Android [release] / Chrome','Assumed 390×844 CSS px',FAIL+'; example: review Save clipped; BUG-003.')],['Device / ID','Assumed OS / Browser','Assumed Screen Size','Illustrative Result'])
ui=[
('UI-001','Navigation','Reach assigned assessment in ≤3 intentional selections.','Example: student reached quiz in 2 selections.',PASS),
('UI-002','Readability','Labels and grade statuses legible at 200% zoom.','Example: key labels legible; focus remained visible.',PASS),
('UI-003','Consistency','Same pending/reviewed grade meaning across list/detail.','Example: pending label consistent; no false zero.',PASS),
('UI-004','Feedback','Show generation/submission pending; prevent accidental duplicate action.','Example: progress indicator and disabled submit shown.',PASS),
('UI-005','Error messages','Provider/upload failure offers actionable cause and preserves input.','Example: file error clear; lesson input retained.',PASS),
('UI-006','Responsive review','Teacher reaches Save by touch/keyboard at 390 px width.','Example: Save clipped off-screen; BUG-003.',FAIL)]
fill_table(16,ui,['Test ID','Usability Criterion','Expected Result','Illustrative Result','ILL Status'])
iso=[('Functional Suitability','Assessment/grading correctness; F-001..020 and IV checks.','Illustrative gap: BUG-001; actual evaluation pending.'),('Performance Efficiency','PT-001..005; latency, errors and host-resource capture.','Illustrative gap: BUG-002; resources unmeasured.'),('Compatibility','BR/DEV matrices and interoperable PDF/Excel outputs.','Illustrative mobile gap: BUG-003; versions unverified.'),('Interaction Capability','UI-001..006; navigation, clarity and accessible controls.','Illustrative gap: UI-006; user evaluation pending.'),('Reliability','DB/API fault handling; pending review; recovery plan.','Unverified; real backup/restore excluded.'),('Security','SEC-001..006; ownership and answer confidentiality.','Unverified; examples are not penetration evidence.'),('Maintainability','Existing modular code/test structure; future repeatable fixtures.','Not rated; suite not run for this report.'),('Flexibility','Environment setup, model configuration and scaled deployment.','Not rated; install/scaling not demonstrated.'),('Safety','Prevent false grades; human review and correction trail.','Not rated; grade-impact risk requires verified review controls.')]
fill_table(17,[(a,b+' '+c,'N/E') for a,b,c in iso])
text(P[118],'Use ISO/IEC 25010:2023 as an organizing framework for the nine quality characteristics already listed in this template. This is an illustrative coverage mapping, not a conformance assessment, certification or expert rating. N/E means not evaluated; all nine actual quality evaluations are pending.')
bugs=[('BUG-001','Grade reports','Hypothetical: final UI 34/40 (85%); fresh PDF/Excel 32/40 (80%); F-014.','High (example)','High (example)','Hypothetical open; unverified'),('BUG-002','Capacity','Hypothetical: PT-005 p95 7.80 s; 3.20% errors exceeds proposed stress limits.','Medium (example)','Medium (example)','Hypothetical open; unverified'),('BUG-003','Mobile review','Hypothetical: Save unreachable at 390 px; DEV-004 and UI-006.','Medium (example)','Medium (example)','Hypothetical open; unverified')]
fill_table(18,bugs)
fill_table(20,[('BUG-001','Proposed: reconcile all exports to final reviewed scores; add discrepancy check.','[Not fixed / date unknown]','NOT EXECUTED; repeat F-013/014 and REG-005.','Unverified example; no closure'),('BUG-002','Proposed: profile slow requests/indexes and bound expensive work; rerun same load.','[Not fixed / date unknown]','NOT EXECUTED; repeat PT-002/004/005.','Unverified example; no closure'),('BUG-003','Proposed: correct responsive container/button reachability and keyboard focus.','[Not fixed / date unknown]','NOT EXECUTED; repeat DEV-004 and UI-006.','Unverified example; no closure')])
fill_table(21,[('REG-001','Login/logout and role routing','Example: three roles routed correctly; no post-fix run.',PASS),('REG-002','Registration and duplicate prevention','Example: valid account created once; no post-fix run.',PASS),('REG-003','Draft persistence and page filters','Example: save/reload/page IDs consistent; no post-fix run.',PASS),('REG-004','AI drafts and objective/essay totals','Example: unpublished draft and 32/40 totals; no post-fix run.',PASS),('REG-005','Baseline reports before override','Example: both exports show baseline 32/40; does not resolve F-014.',PASS)],['Test ID','Baseline Function','Illustrative Outcome','ILL Status'])
summary=[('Functional',20,19,1),('Input Validation',8,8,0),('Database',6,6,0),('API',8,8,0),('Performance',5,4,1),('Security',6,6,0),('Compatibility',8,7,1),('Usability',6,5,1),('Regression',5,5,0)]
assert sum(x[1] for x in summary)==72 and sum(x[2] for x in summary)==68
fill_table(22,[(a,str(b),str(c),str(d),f'{c/b*100:.2f}%') for a,b,c,d in summary]+[('TOTAL (illustrative)', '72','68','4','94.44%')],['Example Category','Example Cases','ILL Passed','ILL Failed','ILL Pass Rate'])
fill_table(23,[(role,'[Name - unverified]','[Unsigned]','[Approval date pending]') for role in ['Test Engineer/Tester','Developer','Project Leader','Technical Adviser','Project Adviser']])

# Extend source paragraph patterns in the existing Appendix A slot.
anchor=P[160]
for i,c in enumerate(cases):
    anchor.addprevious(paragraph(f'TC-F-{i+1:03} {c[0]}',True))
    before(anchor,[f'Precondition: {c[4]} Input: {c[5]}',f'Steps: {c[6]}',f'Expected: {c[2]} Illustrative/unverified outcome: {c[3]} Status: {FAIL if i==13 else PASS}. Actual: NOT EXECUTED. Evidence to capture: redacted UI/API response and relevant record/export comparison, linked to this ID.'])
    prop(anchor.getprevious().getprevious(),'keepNext')
    prop(anchor.getprevious().getprevious().getprevious(),'keepNext')

before(P[176],[
 'Environment verification record: CPU/RAM/storage [verify]; OS [version]; browser [version]; Node/React/Express/MongoDB [exact versions]; dependency lockfile [hash]; indexes [verified list]; TLS/proxy timeout [value]; provider/model IDs [values]; test runner [tool/version]. These are placeholders, not observations.',
 'Assumed fault setup: stub provider transport for 429, 401, malformed JSON, timeout and both-provider failure; use controlled clock values for availability checks. Production secrets must not be copied into the report. Record only sanitized configuration and request correlation IDs.',
 'Source context: local README.md and relevant routes/models/services reviewed as static project material, including Submission, grading, submission review, upload policy and admin mock recovery handlers. Existing test files or prior diagnostic files are not treated as current execution evidence. No application code or database was changed for this report.'
])
for title,details in [
('BUG-001 Hypothetical grade report discrepancy',[
 'Status: hypothetical open/unverified. Reporter [Tester name - unverified]; owner [Developer name]; found date [Not executed]; build [Build/commit]; evidence [Not captured]. Severity High and priority High are illustrative only.',
 'Reproduction proposal: use A-grade with objective subtotal 18 and essays 8/6. Confirm baseline 32/40 (80%). Change E2 to 8 with a reason; confirm UI 34/40 (85%). Generate new PDF and Excel exports. Expected: both 34/40 (85%). Hypothetical observed result: both still 32/40 (80%). Impact: a five-percentage-point reporting discrepancy.',
 'Root cause: unknown/unverified; a stale aggregate or use of an AI score rather than final reviewed score is only a hypothesis. Proposed correction: reconcile the report data path and cache invalidation if relevant. Retest F-013, F-014 and REG-005 on [fixed build], including a late AI completion. No fix or retest performed.'
]),
('BUG-002 Hypothetical stress capacity issue',[
 'Status: hypothetical open/unverified. Reporter [Tester name - unverified]; owner [Developer name]; date [Not executed]; build [Build/commit]; raw load evidence [Not collected]. Severity Medium and priority Medium are illustrative only.',
 'Reproduction proposal: single API instance, assumed 2 vCPU/4 GB RAM, isolated DB, seeded 10,000 submissions; use the Section 12 request mix and stub AI. Warm up 2 minutes; run 100 virtual users for 10 minutes. Proposed limits: p95 ≤5.0 s, errors ≤2%. Hypothetical result: p95 7.80 s, 64 errors in 2,000 requests (3.20%). No actual request or timing data exists.',
 'Root cause: unknown/unverified; inspect traces and indexes before assigning a cause. Proposed correction: optimize demonstrated bottlenecks and bound expensive work. Retest PT-002, PT-004 and PT-005 with the same data/mix and recorded resources. No optimization or retest performed.'
]),
('BUG-003 Hypothetical mobile review control issue',[
 'Status: hypothetical open/unverified. Reporter [Tester name - unverified]; owner [Developer name]; date [Not executed]; browser/OS [Exact versions]; build [Build/commit]; screenshot [Not captured]. Severity Medium and priority Medium are illustrative only.',
 'Reproduction proposal: sign in as T1 on an assumed 390×844 CSS-pixel Android/Chrome viewport; open A-grade answer review; scroll and navigate focus to Save. Expected: Save reachable and activatable by touch and keyboard. Hypothetical result: control clipped outside the visible review container. Same issue is counted in DEV-004 and UI-006.',
 'Root cause: unknown/unverified; overflow sizing is a hypothesis. Proposed correction: inspect container width/overflow and button/focus layout. Retest DEV-004/UI-006 at 390 px, then desktop/tablet regression; attach real screenshots and focus evidence. No UI change or retest performed.'
])]:
    body.insert(len(body)-1,paragraph(title,True))
    for j,s in enumerate(details):
        p=paragraph(s)
        if j<len(details)-1:prop(p,'keepNext')
        body.insert(len(body)-1,p)

# Layout protection follows the existing table patterns; no geometry/font change.
for i in [32,55,56,141,143,149,150,151,152,153]:
    for pict in P[i].findall('.//w:pict',NS):pict.getparent().remove(pict)
for t in root.findall('.//w:tbl',NS):
    for i,r in enumerate(t.findall('w:tr',NS)):
        pr=r.find('w:trPr',NS)
        if pr is None:pr=E.Element(tag('trPr'));r.insert(0,pr)
        for name in ['cantSplit','tblHeader']:
            el=pr.find('w:'+name,NS)
            if el is None:el=E.SubElement(pr,tag(name))
            el.set(tag('val'),'1' if name=='cantSplit' or i==0 else '0')
        for p in r.findall('.//w:p',NS):prop(p,'keepNext','0')
for p in root.findall('w:body/w:p',NS):
    if p.find('w:pPr/w:pStyle',NS) is not None and p.find('w:pPr/w:pStyle',NS).get(tag('val'),'').startswith('Heading'):
        prop(p,'keepNext')

# Short labels fit the template's narrow columns without font or width changes.
text(T[14].findall('w:tr',NS)[0].findall('w:tc',NS)[1].find('w:p',NS),'Ver.')
text(T[15].findall('w:tr',NS)[4].findall('w:tc',NS)[0].find('w:p',NS),'DEV-004 Phone')
text(T[22].findall('w:tr',NS)[0].findall('w:tc',NS)[2].find('w:p',NS),'ILL Pass')
text(T[22].findall('w:tr',NS)[0].findall('w:tc',NS)[3].find('w:p',NS),'ILL Fail')
for row in T[18].findall('w:tr',NS)[1:]:
    text(row.findall('w:tc',NS)[5].find('w:p',NS),'Example open; unverified')
for row in T[20].findall('w:tr',NS)[1:]:
    text(row.findall('w:tc',NS)[3].find('w:p',NS),'Pending; see Appendix E.')
text(T[11].findall('w:tr',NS)[1].findall('w:tc',NS)[3].find('w:p',NS),'20 summary rows; page data; no lesson or version bulk.')
text(T[9].findall('w:tr',NS)[6].findall('w:tc',NS)[3].find('w:p',NS),'Reject unreadable, empty or unsupported data before AI.')
prop(P[30],'keepNext');prop(P[31],'keepNext')
for i in [108,156]:
    s=''.join(P[i].xpath('.//w:t/text()',namespaces=NS))
    text(P[i],s.replace('Numerical values below are invented examples.','All numerical performance values are invented examples.').replace('dates below are unknown placeholders','dates here are unknown placeholders'))

xml=E.tostring(root,encoding='UTF-8',xml_declaration=True,standalone=True)
with ZipFile(OUT,'w') as dest:
    for info in z.infolist():dest.writestr(deepcopy(info),xml if info.filename=='word/document.xml' else z.read(info.filename))
with ZipFile(OUT) as result:
    unchanged=[n for n in z.namelist() if n!='word/document.xml' and result.read(n)==z.read(n)]
    assert len(unchanged)==len(z.namelist())-1
    assert E.tostring(root.find('.//w:sectPr',NS))==E.tostring(E.fromstring(z.read('word/document.xml')).find('.//w:sectPr',NS))
assert sha256(SRC.read_bytes()).hexdigest() in contract
plain=' '.join(root.xpath('//w:t/text()',namespaces=NS))
assert '____' not in plain
assert all(f'TC-F-{i:03}' in plain for i in range(1,21))
(BASE/'content-audit.json').write_text(json.dumps({'file':str(OUT),'source_sha256':sha256(SRC.read_bytes()).hexdigest(),'unchanged_package_parts':unchanged,'actual_test_executions':0,'illustrative_cases':72,'illustrative_passes':68,'illustrative_failures':4,'hypothetical_defects':3,'word_count':len(plain.split())},indent=2),encoding='utf-8')
print(OUT)
print(f'{len(plain.split())} words; {len(unchanged)} untouched package parts; 72 illustrative cases; 0 actual executions')
