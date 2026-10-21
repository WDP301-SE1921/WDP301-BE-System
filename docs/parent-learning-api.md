# Parent learning API changes — 19 October 2026

All paths below are relative to `/api/v1`. Responses retain the existing `{ success, data }` envelope. Parent scope always comes from the authenticated account.

## Compatibility and pagination

Existing array responses remain arrays. Opt into pagination metadata with `paginated=true` on:

- `GET /academic/scheduled-sessions`
- `GET /academic/assignments`
- `GET /academic/assignments/:id/submissions`
- `GET /academic/leaves`
- `GET /academic/makeups`

The result inside `data` becomes `{ items, page, limit, total }`. Defaults are page 1, limit 20; maximum limit is 100. Total is counted after ownership and business filters, including when the requested page is empty. Parent calendar eligibility and paging now run in the database.

## Calendar and session details

Parent lists include center-cancelled sessions with `status: CANCELLED` and `cancelReason`. Cancelled student participation cannot grant list/detail access or be reintroduced by placement fallback. Active makeups in another class remain visible. Term end and placement end are exclusive; `ENDED` enrollment history before `endedAt` remains available. Lists and details use the same eligibility predicate.

Both lists and details include `room { id, name } | null` and `teacher { id, displayName }`. Parent detail is an explicit projection: it excludes `lesson.content`, class pricing/capacity, internal teacher assignment fields and full program records. The lesson outline remains available. Other roles retain their previous content access.

## Assignments by child

`GET /academic/assignments?studentId=...` accepts an owned child ID. A foreign child returns 403. Omitting the filter keeps the existing scope across all children of that parent.

List items retain existing fields and add:

- `kind`: `HOMEWORK` or `TEST`; `testType`: `FIFTEEN_MINUTES`, `ONE_PERIOD`, `MIDTERM`, `FINAL` or null.
- `session { id, startsAt, endsAt } | null` and `class { id, name, program { subject, grade } }`.
- `questionCounts { multipleChoice, essay, total }` and `maxScore`.
- `recipients[] { id, enrollmentId, studentId, latestSubmission }`, restricted to the requested/owned children. `latestSubmission` is null or `{ id, attemptNo, submittedAt, publishedGrade }`; grade is null until a PUBLISHED revision exists for that attempt. Only its newest published revision is returned.

List responses never contain prompts, answer keys, grading rubrics or unpublished grades. Assignment details add `kind`, `testType`, `sessionId` and `session` while keeping the existing answer-publication rules.

Creation/draft-update accepts optional `kind`, `testType`, `sessionId`. Old requests default to HOMEWORK on creation. Only TEST can specify testType; a session must belong to the same class. Explicitly changing a draft to HOMEWORK clears its stored testType.

## Published grades

`GET /academic/me/students/:id/grades?page=1&limit=20` is parent-only and returns:

```text
{ studentId, subjects, history, page, limit, total }
subjects[] = { subject, count, averageOutOf10 }
history[] = {
  recipientId, assignment: { id, title, kind, testType, class },
  submissionId, attemptNo, totalScore, feedback, publishedAt, maxScore, scoreOutOf10
}
```

For each assignment recipient, use the latest attempt with a PUBLISHED grade and the newest published revision of that attempt. A newer ungraded attempt does not erase the older published result. Normalize each result as `totalScore / maxScore * 10`; the subject average is an unweighted mean, rounded to two decimals. This is a descriptive learning summary, not a weighted official transcript. Summary covers the full supported history; paging only affects `history`, ordered by publication date descending. No results means empty subjects/history, not a zero score. The supported range is up to 20,000 recipients; exceeding it returns `GRADE_HISTORY_TOO_LARGE` rather than a truncated average.

## Curriculum outline

`GET /academic/me/students/:id/curriculum?page=1&limit=20` is parent-only and returns `{ studentId, items, page, limit, total }`.

Items contain approved units overlapping the child's active term for the program of their current placement (or original class when no placements exist): `id, title, programId, fromDate, toDate, version, program { subject, grade }, classes[] { id, name }, lessons[] { id, title, sequence, kind, monthKey }`. Approved unscheduled lessons are included. No current enrollment gives an empty page. Lesson content and answer keys are never selected. `sequence` remains local to the unit; it is not a course-wide lesson number. Privileged curriculum authoring routes keep their existing permissions.

## Attendance, leave and makeups

Parent attendance `history` retains `enrollmentId`, `attendance`, `effectiveStatus`, `session` and completed `sourceBookings`. It adds:

- `class { name, program { subject } }` (also inside session).
- `approvedLeave { id, kind, reason } | null`, matched by session or inclusive local study-day range.
- `latestMakeup { id, status, replacement { sessionId, session { id, startsAt, endsAt } } } | null`, the newest non-cancelled booking.

History keeps the legacy participant ID and enrollment/student fields so existing clients remain compatible. Only COMPLETED makeup contributes to attended/madeUp; BOOKED and MISSED do not. The existing attendance formula is unchanged. EXCUSED is excluded from the denominator.

`GET /academic/makeups` additionally accepts `studentId`; ownership remains enforced even when filtering.

## Account and enrollment

`GET/PATCH /auth/me` and authentication responses include the stored parent `phone` (string or null). Omitting phone during update preserves it; explicit empty string clears it. Other roles do not gain a phone property.

`GET /me/students/:id/enrollments` adds `class.teacher { id, displayName }`, also under placements, and `term { startDate, endDate, status, label }`. Term states use the existing receipt rules: ENDED takes precedence, then EXPIRED at the exclusive local end date, UPCOMING before start, otherwise ACTIVE. This does not mutate stored `Enrollment.status`.

## Deployment

Apply migration `20261019000000_assignment_metadata` before deploying this code (`pnpm prisma:migrate:deploy`), then generate the Prisma client for the build. The migration adds nullable test type/session fields, an assignment kind defaulting to HOMEWORK, an index and foreign key; existing assignments remain HOMEWORK. Existing records cannot be retroactively classified as tests without source data.

The new migration has been exercised only in isolated test databases. No application/shared database is migrated as part of this change. Configure reachable `WEB_ORIGIN`, SMTP and seed accounts separately for mobile environment acceptance. Existing teacher replacement/substitution workflows are reused unchanged.
