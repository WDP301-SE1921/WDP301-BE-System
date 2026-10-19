# Realtime notifications

## Deployment and boundaries

This release supports one Node/Nest backend instance, MySQL and Socket.IO. There is no Redis or operating-system push. Notification records survive app/server restarts and remain available when a client was offline. No historical events are backfilled and no automatic retention cleanup runs.

Apply migration `20261019001000_notifications` with `pnpm prisma:migrate:deploy` before deploying the new application; generate the Prisma client when building. This is additive: `notifications`, `notification_dispatches`, indexes and user foreign keys. Earlier required migrations must also be applied. Existing email outbox rows and email retries remain separate, including account verification/reset tokens.

Runtime uses the existing `CORS_ORIGINS`, JWT issuer/audience/access secret and `THROTTLE_LIMIT_PER_MINUTE`. Browser socket origins must be listed exactly. Missing Origin is allowed for native clients, but token/session validation is always required. Connect only over HTTPS/WSS outside local development. WebSocket transport is required; long-polling is not enabled. Up to 10 sockets per user and the configured handshake attempts per IP/minute are allowed. Reverse proxies must forward WebSocket upgrades; see `notifications-nginx.example.conf`.

Do not run multiple application replicas with this in-memory gateway. A future multi-instance deployment needs cross-instance delivery, e.g. Redis; MySQL dispatch claiming alone cannot route events to another instance's sockets.

## REST contract

Every endpoint requires the normal Bearer access token and returns `{ success: true, data: ... }`.

| Method/path (under `/api/v1`) | Data |
| --- | --- |
| `GET /notifications?page=1&limit=20&unreadOnly=true&type=GRADE_PUBLISHED&studentId=...` | `{ items, page, limit, total }`; maximum limit 100, createdAt/id descending |
| `GET /notifications/unread-count` | `{ unreadCount }` across the user's entire inbox, independent of list filters |
| `PATCH /notifications/:id/read` | Updated notification; an already-read record keeps its original readAt |
| `POST /notifications/read-all` | HTTP 200; `{ updatedCount, unreadCount }` |

An item contains:

```json
{
  "id": "notification-id",
  "type": "GRADE_PUBLISHED",
  "title": "Cập nhật học tập",
  "body": "Giáo viên đã công bố kết quả bài làm.",
  "target": { "kind": "ASSIGNMENT", "id": "assignment-id" },
  "context": { "classId": "class-id", "studentIds": ["student-id"] },
  "createdAt": "2026-10-19T09:00:00.000Z",
  "readAt": null
}
```

The API always returns a page object; it does not use the legacy array contract of older academic endpoints. Filters never expand ownership. Supplying recipientUserId is rejected. Reading a foreign or nonexistent notification returns 404 `NOTIFICATION_NOT_FOUND`. read-all freezes the unread IDs at the start of its transaction; a later inserted notification remains unread. The returned count is refreshed after commit.

Targets are typed references, not arbitrary URLs: ASSIGNMENT, SUBMISSION, SESSION, CLASS, LEAVE, MAKEUP, ENROLLMENT, REGISTRATION, CURRICULUM_UNIT, FEEDBACK. Clients map these kinds to their screens and must still handle a missing/inaccessible resource. Notification history records the audience at event time; a later transfer or permission change can make the linked resource inaccessible without removing its historical notification.

## Socket.IO contract

Connect to `io(BASE_URL + '/notifications', { path: '/socket.io', transports: ['websocket'], auth: { token: ACCESS_TOKEN } })`. A Socket.IO client is required; this is not a bare WebSocket protocol endpoint. Never put tokens in URL query parameters.

The gateway validates signature, HS256, expiry, issuer, audience, token type (access token or realtime ticket), active account and unrevoked session. Refresh tokens are rejected. User rooms are server-controlled; there is no public join-room or send-notification event.

| Server event | Payload | Client action |
| --- | --- | --- |
| `notification.created` | `{ notificationId }` | Debounce a refresh of inbox + unread count |
| `notifications.read-changed` | `{}` | Refresh read state + unread count on all connected devices |

Register listeners before connecting/loading the inbox. Resync via REST on every connection/reconnect and when returning to foreground. A dispatch may be repeated after a worker crash, and an offline socket can miss events; invalidate/refetch rather than incrementing counters or appending duplicate items. Fetch requests should cancel/supersede older refreshes so an old response cannot overwrite newer read state.

Connection errors use AUTH_UNAUTHORIZED, ORIGIN_NOT_ALLOWED, REALTIME_RATE_LIMITED, REALTIME_CONNECTION_LIMIT or REALTIME_UNAVAILABLE. Refresh credentials only for AUTH_UNAUTHORIZED; fix configuration or back off for the other errors.

### Web clients: realtime ticket

A browser whose access token stays in an httpOnly cookie must not read it. Its server (BFF) calls `POST /api/v1/auth/realtime-ticket` with the session's Bearer token and passes the returned `{ token, expiresIn: 60 }` to the browser, which sends it as `auth.token` in the handshake. The ticket:

- only opens the socket: every REST endpoint rejects it (JwtStrategy accepts `access` tokens only);
- must be used within 60 seconds; request a new one for every connection or reconnection (the Socket.IO `auth` callback runs on each attempt);
- gives the socket one access-token lifetime (`JWT_ACCESS_TTL_SECONDS`) from the handshake, after which the server disconnects it and the client reconnects with a new ticket.

The web origin must be listed in `CORS_ORIGINS`, and the browser connects to the API origin (or a reverse proxy that forwards WebSocket upgrades on `/socket.io`).

Sockets opened with an access token close at access-token expiry. Sessions are also checked before each delivery and every 15 seconds, so logout/disabled accounts cannot keep receiving events. On expiry, refresh via the existing auth endpoint, update the token provider and reconnect. If refresh fails, return to login. Disconnect and cancel pending requests when logging out. `notifications-client.example.js` provides a UI-independent client wrapper with debounced fetches and read actions.

## Events and audience

| Types | Audience and trigger |
| --- | --- |
| ANNOUNCEMENT | Class announcement creation: current teacher + parents currently enrolled/placed in the class; one parent record includes all affected children |
| ASSIGNMENT_PUBLISHED, ASSIGNMENT_REOPENED, ANSWERS_PUBLISHED | Parents of assigned recipients, one record per child; draft changes do not notify |
| SUBMISSION_RECEIVED | Current class teacher, after a successful submission; no submitted answers in the notification |
| GRADE_PUBLISHED | Parent of the graded recipient, only after publication; grade drafts, rubric and unpublished feedback are not copied |
| ATTENDANCE_FINALIZED | Parent of every noncancelled participant, including present/absent/excused; existing finalization rules remain unchanged |
| SESSIONS_GENERATED | One summary per recipient/class for the generation batch |
| SESSION_RESCHEDULED, SESSION_CANCELLED | Teachers and eligible parents before/after the change, including active cross-class makeups |
| TEACHER_CHANGED | Old/current/pending/new teachers and affected parents; future assignment gives its effective date; automatic activation does not duplicate the event |
| SUBSTITUTE_ASSIGNED | Old/new session teachers + eligible parents |
| LEAVE_REQUESTED | Active STAFF work item; excludes the parent who submitted it |
| LEAVE_APPROVED, LEAVE_REJECTED, LEAVE_CANCELLED, LEAVE_ENDED_EARLY | Parent and involved class/session teachers |
| MAKEUP_BOOKED, MAKEUP_RESCHEDULED, MAKEUP_CANCELLED, MAKEUP_COMPLETED, MAKEUP_MISSED | Parent and target-session teacher; a reschedule also notifies a different previous target teacher |
| ENROLLMENT_TRANSFERRED, ENROLLMENT_ENDED | Parent and affected teachers; ending a transferred enrollment uses its last placement |
| BILL_CREATED | Authorized target-student parent and active MANAGER work item |
| BILL_CANCELLED, PAYMENT_CONFIRMED | Authorized target-student parent |
| TUITION_REMINDER | Parent, when the existing manual reminder command executes; no new automatic reminder scheduler |
| CURRICULUM_SUBMITTED | Active MANAGER review work item |
| CURRICULUM_CHANGES_REQUESTED, CURRICULUM_APPROVED | Unit owner/designer |
| FEEDBACK_CREATED | Lesson designer and active MANAGER |
| FEEDBACK_RESOLVED | Feedback submitter and designer |

All events exclude the actor and inactive users. Recipients are resolved from domain relationships, never client-supplied user IDs. Per-student events include only that child's context. No email-token payload is transformed into an in-app notification.

`SessionRescheduleDto` additionally accepts optional roomId. Omission retains the room. A changed room must be active, accommodate the class and have no overlapping session. The room/time change, mutation replay record and notification commit together. Replayed idempotent commands do not create another notification; a no-op room/time request emits none.

## Reliability and operations

Business mutations, inbox rows and dispatch rows share a transaction; a notification write failure rolls back the business change. External socket delivery runs only after commit and cannot roll back the business operation. Unique hashed event/recipient/context keys prevent duplicate inbox records, including concurrent replay. Individual repeated valid operations use operation IDs or persisted business revisions/mutations.

Worker polls every second, claims up to 100 rows with a 30-second lease, and increments attempts atomically. It retries after 1, 2, 4, 8 seconds (up to five attempts total); an expired lease is recoverable after restart. SENT means the live dispatch was processed, not that the user read it or that an offline device received it. Zero connected sockets is a successful dispatch because the inbox remains durable. A crash after emit can repeat the invalidation; clients must resync idempotently.

Shutdown stops the polling/session timers and drains in-flight notification work before the shared database connection closes.

Every minute, `notification.metrics` logs connections, pending, failed and oldestPendingMs. Retry logs include dispatch ID, attempt and failure state, without JWTs/content. Alert on sustained pending age, FAILED rows or repeated worker failures. FAILED deliveries keep their inbox records; inspect the underlying error before resetting a dispatch to PENDING for operational replay. No public dispatch management endpoint is added in this version.

The acceptance target is a live invalidation within two seconds after commit under ordinary single-instance test load; this is not a throughput guarantee for bulk fanout. Changes should pass Prisma validation, lint, typecheck, unit/E2E tests and build. The notification E2E suite uses its own disposable MySQL database and real Socket.IO clients.
