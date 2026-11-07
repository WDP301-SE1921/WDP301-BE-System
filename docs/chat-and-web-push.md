# Internal chat and Web Push

## Internal chat

Direct chat is available only to active `MANAGER`, `STAFF`, `TEACHER` and
`CURRICULUM_DESIGNER` accounts. `PARENT` is rejected by the API. There is no student account role.

REST endpoints under `/api/v1`:

- `GET /chat/users?search=&limit=50`
- `GET /chat/conversations`
- `POST /chat/conversations` with `{ "participantUserId": "..." }`
- `GET /chat/conversations/:id/messages?limit=50&cursor=...`
- `POST /chat/conversations/:id/messages` with JSON `{ "body": "..." }`, or multipart fields
  `body` (optional) and `file` (one attachment)
- `POST /chat/conversations/:id/read`
- `GET /chat/unread-count`

Only conversation participants can read or send messages. Direct conversations use a stable sorted
participant key, so concurrent attempts to start the same chat resolve to one conversation. Message,
in-app notification and Socket.IO dispatch records commit in one database transaction.

The existing authenticated `/notifications` Socket.IO namespace emits:

- `chat.message.created` with `{ conversationId, messageId }`
- `chat.conversation.read` with `{ conversationId, userId, readAt }`

Clients treat these events as invalidations and refetch REST state. Offline history remains in MySQL.

Messages support Unicode emoji directly. An attachment may be an image (`JPEG`, `PNG`, `GIF`,
`WEBP`) or a common private download (`PDF`, `DOCX`, `XLSX`, `PPTX`, `CSV`, `TXT`, `ZIP`) up to
10 MB. Objects are stored privately under `chat/<conversationId>/...`; the response contains a
one-hour signed URL. Executable, HTML and SVG uploads are rejected, and file signatures are checked
for images, PDF and ZIP-based formats.

Apply migrations `20261105000000_chat_and_web_push` and
`20261106000000_chat_attachments` before starting the updated application.

## Web Push

Generate one VAPID key pair and keep it stable across deploys:

```bash
pnpm push:generate-keys
```

Set these backend-only deployment variables:

```dotenv
VAPID_PUBLIC_KEY=<generated public key>
VAPID_PRIVATE_KEY=<generated private key>
VAPID_SUBJECT=mailto:admin@example.com
```

`VAPID_PRIVATE_KEY` must never be exposed to the frontend. The browser fetches only the public key
from `GET /api/v1/push/public-key`. Both keys are optional, but must be configured together. Without
them, chat and in-app Socket.IO notifications still work and the Web Push enable button is hidden.

The user must click **Bật thông báo ngoài ứng dụng** before the browser permission prompt appears.
The service worker at `/sw.js` receives pushes and focuses/opens the linked screen when clicked.
Subscriptions are stored by a SHA-256 endpoint hash. Expired endpoints (HTTP 404/410 from the push
provider) are removed automatically.

Render remains compatible with the free single-instance plan. Web Push providers are contacted
directly from the existing notification worker and do not require another paid service.
