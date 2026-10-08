# Integrations

All vendors are accessed through adapter interfaces in `src/server/adapters/`, with retries, timeouts, and in-memory fakes for tests.

## Cloudinary (media)
Signed uploads from the client. Limit file size and type (images only); store the public ID (not the URL) on Media. Strip EXIF location data unless used deliberately.

Adapter: `src/server/adapters/media/` (`MediaStorage` interface, `CloudinaryMediaStorage`, `FakeMediaStorage`, and `DevMediaStorage`). Flow and rules: ADR 0008. Signing is hand-rolled and checked against the example in Cloudinary's signature documentation. Config: `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` (all three or none). Without them, development and tests use the local `DevMediaStorage` (files in the gitignored `.dev-media/`, served by `/api/dev-media/*`), which refuses to run when `NODE_ENV=production`; production refuses to start without Cloudinary. Allowed formats: jpg, png, webp, heic; at most 10 MB; the browser resizes to 1600 px first.

Not yet exercised against a live Cloudinary account: real uploads, the metadata-stripping transformation, and the Admin API lookup. Do this before launch.

## Resend (email)
Transactional only: sign-in link, report received, acknowledged, resolved, escalated. Templates versioned in code.

Adapter: `src/server/adapters/email/` (`EmailSender` interface, `ResendEmailSender`, `FakeEmailSender`). Sign-in links are sent synchronously and not retried; report notifications go through the notification outbox and the worker's dispatcher (ADR 0011). In local dev without `RESEND_API_KEY`, messages are written to the gitignored `.dev-outbox/` (never logged); read the latest with `pnpm dev:last-email`. Production refuses to start without Resend configured (ADR 0005).

## Termii (SMS)
Nigerian numbers in E.164 (+234). Sender ID registration required. Respect DND routes and opt-out. SMS is more expensive than email: reserve for key events.

Consent, verification and which events send SMS: ADR 0012. Delivery path: ADR 0011. Adapter: `src/server/adapters/sms/` (`SmsSender` interface, `TermiiSmsSender`, `DevOutboxSmsSender`, `FakeSmsSender`). Config: `TERMII_API_KEY` and `TERMII_SENDER_ID` (both or neither; sender IDs are at most 11 characters), optional `TERMII_BASE_URL` (default `https://api.ng.termii.com`; the base URL can differ per account) and `TERMII_CHANNEL` (`dnd` by default, which reaches numbers on the Do-Not-Disturb list; `generic` does not). Without them, development writes SMS to the gitignored `.dev-outbox/sms.jsonl` (read the newest with `pnpm dev:last-sms`), and production sends no SMS at all (SMS rows are skipped and phone verification says SMS is unavailable) instead of refusing to start. Not yet exercised against a live Termii account or a live Resend domain: sender ID approval, DND routing, delivery reports and SPF/DKIM must be checked before launch.

## Notifications (Phase 6)
A report change writes outbox rows in its own transaction; the worker's `notification-dispatch` job (every minute) sends them through the adapters, retrying transient failures after 1, 5, 30 and 120 minutes (ADR 0011). Residents can switch off report emails and SMS in `/account`; staff escalation emails cannot be switched off. The worker needs `RESEND_API_KEY`/`EMAIL_FROM` (required in production) and `AUTH_URL` (the public base URL used in message links; required in production, defaults to `http://localhost:3000` in development).

Templates live in code and are versioned; messages carry the reference code and a link, never the description or location. Events and recipients:

| Event | Email | SMS |
|---|---|---|
| Report received | resident | none |
| Sent to agency | resident | none |
| Acknowledged | resident | none |
| Resolved | resident | resident |
| Rejected | resident | none |
| Disputed | agency admins | none |
| Escalation level 1 | agency admins | none |
| Escalation level 2 | platform admins | none |
| Escalation level 3 (publicly overdue) | resident | resident |

## Leaflet / OpenStreetMap
Client-only component (`src/components/map-picker.tsx`, loaded with `ssr: false`). Follow the OSM tile usage policy (attribution is shown); plan to move to a tile provider before significant traffic. Default map view: Nigeria. The pin uses a custom icon because Leaflet's default marker images are not resolved by bundlers. The report form also offers "use my location" and typed latitude/longitude as accessible alternatives to the map.

## Secrets
Environment variables only; documented in `.env.example` (no real values).
