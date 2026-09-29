# Academic P1 backend

Branch: `feature/academic-workflows`. API prefix: `/api/v1/academic`.
Authentication: existing Bearer access token from `/api/v1/auth/login`.
Database: MySQL. Request examples and DTO fields are available at `/api/docs`.

## Scope

Implemented backend workflows:

- CUR-03: teacher feedback, designer response and new immutable lesson revision, manager approval, feedback-to-approved-revision link.
- EXC-01: single-session absence, period pause, manager decision/cancellation, makeup candidates, booking/cancellation, final attendance and made-up outcome.
- EXC-02: future transfer with placement history, ending one enrollment, ending all enrollments of one student. A period pause expires by date and does not extend tuition or release the long-term seat.
- ASM-01/02: draft assignment creation/editing, structured questions, rubric, publication to selected enrollments, closing/reopening the submission window, bounded attempts, parent-owned PDF/PNG/JPEG attachments.
- GRD-01/02: deterministic multiple-choice grading, manual grade revisions, approval and publication, durable AI jobs and proposal polling. AI output never writes official grades.
- RPT-01: snapshot reports containing normalized published grades, attendance and class teaching progress; optional AI commentary; Excel and Vietnamese-capable PDF downloads.
- NTF-02: class announcements and explicit SMTP sends for announcements/tuition reminders. Delivery results are returned to the manager.

Minimum dependencies added: program/class/lesson creation, class teacher reference, session creation, roster preparation, basic resource authorization. These are not a full P0 catalog, staffing, invitation or billing implementation.

Deferred per requested scope: generalized audit/outbox delivery history, automatic email retries, scheduled tuition reminder worker, full storage lifecycle cleanup, full curriculum-version approval UI and other P0 support modules. Existing JWT and resource ownership checks remain necessary for the new APIs.

## Local setup

```powershell
pnpm install
pnpm prisma:generate
pnpm prisma:migrate:deploy
pnpm dev
```

The September 29 academic migration is additive: it adds tables and a nullable class teacher column. `Enrollment.classId` remains the original class; current/future class is determined by placement intervals. Existing enrollments without placements fall back to that original class. No migration rewrites historical payments.

The API needs existing active staff accounts and linked enrollments with start/end dates. Parent self-registration is unchanged; the existing registration/payment/claim workflow is still a separate pending P0 implementation. Do not create an unpaid enrollment to simulate returning to study. After ending study, a new paid enrollment must reuse the existing student profile.

The integration tests create all prerequisite data in `edugrade_academic_test`, migrate it, verify the selected database name before inserting fixtures and delete that test database afterwards. They do not send external email or call a paid AI provider.

## Configuration

All new values are optional; missing configuration disables the corresponding operation with HTTP 503 rather than returning fabricated success.

| Environment | Purpose |
|---|---|
| `AI_CHAT_URL` | Full Chat Completions-compatible endpoint, e.g. a provider's `/v1/chat/completions` |
| `AI_API_KEY`, `AI_MODEL` | Provider key and explicitly selected JSON-capable model |
| `STORAGE_ENDPOINT` | Optional custom S3-compatible endpoint |
| `STORAGE_REGION`, `STORAGE_BUCKET` | S3 region and private bucket |
| `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY` | Storage credentials |
| `SMTP_URL`, `MAIL_FROM` | SMTP connection URL and sender address |

The AI adapter follows the [Chat Completions JSON output contract](https://developers.openai.com/api/docs/guides/structured-outputs). The service separately validates returned question IDs, score ranges and feedback types. It rejects incomplete output, invalid JSON and out-of-range grades. Timeout: 45 seconds; interrupted jobs become FAILED and can be requested again. Configure these values before startup; changing configuration requires restarting the service.

AI currently grades structured text answers. Submissions with file attachments require manual review and return `AI_ATTACHMENTS_UNSUPPORTED` if submitted for AI grading. OCR/document extraction is not included. Manual grading, deterministic grading and non-AI reports work without AI credentials.

Object storage uses private objects and 60-second signed download links, with ownership checks before issuing links. Accepted upload types are PDF, PNG and JPEG, up to 10 MB per file; a submission can attach up to five files. Objects are immutable. Configure bucket access restrictions and lifecycle retention in the selected provider. Already-issued signed links remain valid until their short expiry.

SMTP sends are explicit manager commands with per-recipient success/failure in the response. They do not run automatically on startup, and no delivery-history/retry subsystem has been introduced. Repeating a send command sends again. Holidays can be announced here; changing or cancelling the class timetable remains part of scheduling.

## API inventory

List routes accept `page` (default 1) and `limit` (default 20, maximum 100).
JSON success envelope: `{ "success": true, "data": ... }`.
POST commands return 201; GET/PATCH return 200. Report downloads return binary data without the JSON envelope.

| Method/path after prefix | Actor | Purpose |
|---|---|---|
| `POST/GET programs` | Manager creates; staff read | Prerequisite program catalog |
| `POST/GET classes` | Manager creates; manager/assigned teacher read | Class with teacher, capacity and fee |
| `POST/GET lessons` | Manager/designer create; scoped staff read | Lesson content; new lessons start DRAFT |
| `POST lessons/:id/approve` | Manager | Approve a lesson |
| `POST lessons/:id/revisions` | Owning designer | Create a new DRAFT based on an existing lesson |
| `POST lessons/:id/feedback` | Teacher assigned to a session using the lesson | Submit feedback |
| `GET feedback` | Scoped staff | List relevant feedback |
| `POST feedback/:id/resolve` | Owning designer/manager | Respond, change state, optionally link an approved revision |
| `POST sessions` | Manager | Create one dated session, validate teacher/class overlap |
| `GET sessions` | Scoped manager/teacher/parent | List actual sessions; parent only sees linked participant sessions |
| `POST sessions/:id/roster` | Assigned teacher/manager | Materialize eligible regular participants, respecting approved pauses |
| `GET sessions/:id/roster` | Assigned teacher/manager | Read current or historical roster |
| `POST sessions/:id/finalize-attendance` | Assigned teacher/manager | Finalize an elapsed session exactly once |
| `GET enrollments` | Scoped manager/teacher/parent | Find enrollment IDs and placement history |
| `POST/GET leaves` | Manager/owning parent | Request/list leave |
| `POST leaves/:id/decide` | Manager | Approve/reject with a reason |
| `POST leaves/:id/cancel` | Manager | Cancel pending leave or approved leave without completed sessions |
| `GET participants/:id/makeup-candidates` | Manager | Page through same-lesson future sessions; booking checks final eligibility |
| `POST/GET makeups` | Manager books; scoped users list | Book/list makeup seats |
| `POST makeups/:id/cancel` | Manager | Cancel an uncompleted booking |
| `POST enrollments/:id/transfer` | Manager | Schedule a same-program/same-fee transfer |
| `POST enrollments/:id/end` | Manager | End one enrollment and cancel future obligations |
| `POST students/:id/end-study` | Manager | End this child's enrollments without disabling the parent |
| `POST/GET assignments` | Teacher creates; scoped teacher/parent read | Assignment draft/list |
| `PATCH assignments/:id` | Owning teacher | Replace the draft definition before publication |
| `GET assignments/:id` | Owning teacher/recipient's parent | Scoped detail; answer keys withheld until released |
| `POST assignments/:id/publish` | Owning teacher | Freeze questions and create recipients |
| `POST assignments/:id/close` | Owning teacher | Stop accepting submissions |
| `POST assignments/:id/reopen` | Owning teacher | Extend deadline/attempts before answer publication |
| `POST assignments/:id/publish-answers` | Owning teacher | Release answers only after closing submissions |
| `POST submissions` | Recipient's parent | Submit one immutable attempt |
| `GET assignments/:id/submissions` | Scoped teacher/parent | Attempts and allowed grade revisions |
| `POST submissions/:id/grade-objective` | Owning teacher | Create a DRAFT grade for all-multiple-choice assignments |
| `POST submissions/:id/grades` | Owning teacher | Create a new manual grade revision |
| `POST submissions/:id/grade-ai` | Owning teacher | Queue a persisted AI grading job |
| `GET grading-jobs/:id` | Owning teacher | Poll proposal/error; unavailable to parents |
| `POST grades/:id/approve` | Owning teacher | DRAFT to APPROVED |
| `POST grades/:id/publish` | Owning teacher | APPROVED to PUBLISHED; supersede the recipient's old official result |
| `POST/GET reports` | Assigned teacher | Create/list snapshot reports |
| `GET reports/:id/download?format=xlsx\|pdf` | Requesting teacher still assigned to class | Download a report |
| `POST files` | Parent | Multipart field `file` |
| `GET files/:id/download` | Uploading parent or assigned reviewing teacher | Obtain short-lived signed link |
| `POST/GET announcements` | Manager creates; scoped users read | Class announcement |
| `POST announcements/:id/send-email` | Manager | Send announcement through SMTP |
| `POST tuition-reminders/send-email` | Manager | Remind active enrollments ending by `through`, within 31 days |

## Example: leave and makeup

Prepare the original session's roster first. Use the returned participant ID for a makeup booking.

```json
{
  "enrollmentId": "existing-enrollment-id",
  "kind": "SINGLE_ABSENCE",
  "sessionId": "original-session-id",
  "fromDate": "2026-10-02",
  "toDate": "2026-10-02",
  "reason": "Family appointment"
}
```

Manager decides with `{ "approve": true, "reason": "Approved" }`, then books:

```json
{
  "originalParticipantId": "original-participant-id",
  "targetSessionId": "replacement-session-id"
}
```

After the target session ends, finalize it with all participants:

```json
{
  "items": [{ "participantId": "replacement-participant-id", "status": "PRESENT" }],
  "summary": "Completed the lesson"
}
```

The original attendance remains physically ABSENT, while MakeupBooking becomes COMPLETED. Reports count that original obligation as attended exactly once. EXCUSED and makeup sessions do not add to the denominator.

## Example: assignment and grades

```json
{
  "classId": "assigned-class-id",
  "title": "Fractions",
  "instructions": "Choose one answer",
  "dueAt": "2026-10-10T12:00:00Z",
  "maxAttempts": 1,
  "questions": [{
    "kind": "MULTIPLE_CHOICE",
    "prompt": "1/2 + 1/2 = ?",
    "choices": ["1", "2"],
    "correctAnswer": "1",
    "maxScore": 10
  }]
}
```

Publish with `{ "enrollmentIds": ["linked-active-enrollment-id"] }`. Parent reads the assignment to obtain its own recipient ID and question IDs, then submits:

```json
{
  "recipientId": "own-child-recipient-id",
  "answers": [{ "questionId": "question-id", "answer": "1" }],
  "fileIds": []
}
```

Teacher uses deterministic/manual/AI-assisted grading. AI proposals must be copied/reviewed into `POST submissions/:id/grades`; they are never automatically approved. Manual payload:

```json
{
  "scores": [{ "questionId": "question-id", "score": 10, "feedback": "Correct" }],
  "feedback": "Good work"
}
```

Call `grades/:id/approve`, then `grades/:id/publish`. Only the published revision is visible to the parent. Publishing a result from another attempt supersedes the previous official result for that recipient. Answer release is a separate action after closing submissions.

## Rules and limits chosen for this implementation

- Center calendar uses UTC+07. Timestamp APIs take ISO timestamps with offsets; leave date fields require YYYY-MM-DD.
- No implicit tuition extensions or refunds. Transfers require equal monthly fees and the same program; the target must cover the remaining source lesson IDs. Class timetable and private curriculum version management beyond these minimum fields are separate P0 work.
- Transfer/end operations preserve the original Enrollment.classId and past sessions. Transfer adds target participants and cancels future source participants. Positive-duration placement intervals are half-open: `[effectiveFrom, effectiveTo)`; ended future placements are empty intervals.
- A transfer with pending makeups must resolve/cancel them first. A previous makeup seat in the target timetable must also be resolved explicitly. Makeup candidates are suggestions; final capacity, term, conflicts and leave checks happen in the booking transaction.
- Makeup booking reserves space against regular enrollments, including PENDING_LINK. This deliberately conservatively retains regular seats during approved leave; it does not overbook freed seats speculatively.
- Only one active/completed makeup can satisfy an original obligation. Cancelled/missed history is retained. A previously used replacement session cannot be reused for the same enrollment; choose another session.
- Attendance finalization is one-way in this iteration. Historical correction with revision/audit is part of the deferred support workflow.
- A lesson revision has its own ID and is approved independently. Old sessions keep the old lesson ID. Full ProgramVersion-level publishing remains outside this P1 implementation.
- Parent report access is not allowed. Published scores are normalized to percentages for averages. Empty attendance denominator is null, not 0% or 100%.
- Reports use up to 366 days and 20,000 attendance/grade rows per snapshot; narrow the range if exceeded. Font is bundled under `assets/fonts` with its OFL license and copied into the container.
- No emails are automatically sent for every point/attendance change. The P0 event/outbox extension and retry infrastructure were explicitly deferred.

## Verification

Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm build`, and `pnpm prisma:validate`.

Academic e2e tests use real MySQL, HTTP auth, migrations and binary report downloads; AI is mocked. They cover role/ownership rejection, draft answer hiding, bounded attempts, mandatory approval, AI score validation, makeup completion without double counting, leave cancellation, placement transfer, isolated student withdrawal, feedback revisions, missing SMTP and concurrent contention for a makeup seat.

Live AI, SMTP and S3 calls require operator-supplied settings. No external-provider success is claimed by the mocked tests.
