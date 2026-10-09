# Security and privacy

## Access control
Roles: resident, agency_officer, agency_admin, platform_admin. Agency staff see only their agency's reports. Enforce in the entry-point layer and in repository queries; never rely on the UI.

## Authentication
- Email magic link only for now; links expire after 15 minutes and work once (ADR 0005).
- Database sessions: roles are read from the user row on every request, so role changes and revocation apply immediately.
- Staff accounts are pre-provisioned by a platform admin (or an agency admin for officers in their own agency). Provisioning never modifies an existing account. The first platform admin is created from the command line (`pnpm admin:create`).
- Sign-in emails are rate limited per address (3 per 15 minutes) and per client address (20 per 15 minutes); counters use keyed hashes, never raw emails or IPs (ADR 0006). Client-address detection depends on the hosting setup, which is still undecided.
- Auth.js logging is restricted to error type names so addresses never reach logs.

## Personal data (NDPA)
- Collect only what's needed: contact for notifications, location of the issue.
- Public views never show reporter identity or contact details.
- Retention, erasure and export: see ADR 0015 and the "Retention, erasure and export" section below. All periods are provisional pending review by a data-protection adviser.
- Treat photo EXIF and precise home-adjacent locations as sensitive.

## Notifications and phone numbers (Phase 6)
- A phone number is personal data. It is stored only after the user adds it, is used for SMS only after verification by a texted code (hashed, expiring, attempt-limited), and can be removed at any time (ADR 0012).
- Notification rows hold ids, channel, status and error codes only. Message bodies, addresses and phone numbers are never stored in them or written to logs (ADR 0011).
- Messages carry the reference code and a link, never the description or the location.
- Residents can switch off their report emails and SMS. Staff escalation emails are operational and cannot be switched off.

## Public tracking (Phase 7)
- Public pages are built from an allow-list of named fields (`toPublicReport`), with a test fixing the exact keys. They never include the reporter, handling staff, description, photos, exact location or staff notes.
- Tracking is by reference code only, rate limited per client address using keyed hashes, `noindex`, and unknown references return 404. There is no public list or map of reports.
- The public overdue board is off unless `PUBLIC_OVERDUE_BOARD=true`.
- Auto-confirmation is recorded in the history as an automatic system action.

## Administration and audit (Phase 8)
- Dashboards show aggregate figures only, scoped to the viewer's agency inside the query (platform admins see all). They are never public.
- Every administrative change (agency, coverage, SLA policy, categories, staff invitations and deactivation) is written to an append-only audit log with the actor, action, target and a short summary. The log holds ids and role names, never emails or phone numbers.
- Deactivating a staff account blocks sign-in and ends the session at once; it keeps their history. Staff cannot change roles or be hard-deleted through the app.

## Web hardening (Phase 8 Part B)
- **Content Security Policy** (`src/server/security/csp.ts`, applied per request by `src/proxy.ts`): scripts run only if they come from our own site or carry that request's random nonce (`'strict-dynamic'`); no inline or eval scripts in production. Images may also come from the OpenStreetMap tile server and, when configured, Cloudinary; network requests may also go to Cloudinary's upload address. Plugins, framing and changing form targets are blocked. Inline *styles* are allowed on purpose: injected CSS is far less dangerous than injected scripts, and it keeps Leaflet and Next.js styling working. Because the nonce needs a fresh render, the previously static pages (home, check-email) are now rendered per request.
- **Other headers** (`next.config.ts`): `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (camera, microphone, payment, USB off; geolocation for our own pages only), `X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy: same-origin`, and in production `Strict-Transport-Security` for 180 days (no `includeSubDomains` or preload, to avoid committing the whole domain before hosting is decided). The `X-Powered-By` header is removed.
- **Error pages**: `error.tsx`, `global-error.tsx` and `not-found.tsx` show a generic message and, for errors, only Next.js's opaque reference code (also written to the server log) so support can find the failure; the technical error text is never shown. A missing page and a page the visitor may not see look identical, including the HTTP status (404). For that reason there is deliberately **no root `loading.tsx`**: a loading boundary makes Next.js stream the response with status 200 before `notFound()` can run, which would make hidden pages distinguishable from missing ones.
- **Accessibility**: an automated axe-core check covers every page in the states people really see and passes. Automated checks find only part of the problems, so keyboard and screen-reader testing by a person is on the launch checklist. The map widget itself is excluded from the automated check; typed coordinates and "use my location" are the accessible alternatives.
- **Not verified**: the strict script policy has been exercised in development (the E2E server runs `next dev`). Production differs only in not allowing `eval`, adding `upgrade-insecure-requests`, and HSTS; it should be smoke-tested on the real deployment before launch.

## Retention, erasure and export (Phase 8 Part B)
| Data | Kept for |
|---|---|
| Rate-limit counters | 7 days |
| Expired phone codes, sessions and sign-in tokens | removed once expired |
| Delivered or skipped notification records | 90 days |
| Failed notification records | 180 days |
| Reports and their status history | kept (accountability record) |
| Audit log | kept |
| Account data (email, name, phone) | until the user erases the account |

Erasing a resident's account removes their identity and contact details, redacts their free text, coarsens their reports' locations and deletes their photos, while keeping each report's category, status, agency, area and timeline (ADR 0015). Residents can download their data as JSON. Backups taken before an erasure retain the data until they expire, so backup retention must be short (see the runbook).

## Operations visibility (Phase 8 Part B)
- Every background job records a heartbeat (when it last ran, and "ok" or "error" with a short code, never a message) in `job_heartbeats`. `/admin/health` (platform admins only) shows each job's status, the messages waiting or stuck, and photo deletions waiting or failed. All of it is counts, times and words: no personal data.
- `GET /api/health` is public and returns only `{status, worker}`: `status` is the website and its database (503 if the database is unreachable), `worker` is `ok`, `degraded` or `unknown`. The worker verdict never changes the HTTP status, because the website itself is fine without the worker; monitoring should alert on `degraded`.
- **Known limitation**: Next.js writes uncaught server errors to the server log itself, and a database error can include values from the failing row. Access to production logs must be restricted and log retention kept short (see the runbook).

## Anonymous reporting
Not offered: reports require a signed-in user (ADR 0007). Revisit with a new ADR if sign-in proves a barrier; anonymous reporting would need a CAPTCHA-style control and token-based tracking.

## Report submission and uploads
- Submissions are rate limited per account (5 per hour, 20 per day); repeats of the same form do not count. Photo upload authorizations are limited to 30 per hour.
- Photos are uploaded straight to the media provider with a short-lived signed request scoped to the reporter's own folder. Before saving a report the server re-verifies every photo with the provider (owner folder, allowed format, size) and refuses a photo already attached elsewhere (ADR 0008).
- The browser re-encodes photos before upload, which drops embedded EXIF data. **Open item:** confirm that the provider also strips metadata from stored originals (the upload requests `fl_strip_profile`) with a real Cloudinary account before launch.
- Free text is normalized (control and invisible characters removed) on write and escaped on render; it is never rendered as HTML.
- A reporter can only read their own reports; another user's report returns 404, indistinguishable from a missing one.
- Reports store the exact point. Public views show only the area name (LGA or state), never the point (ADR 0013).

## Routing and staff access (Phase 4)
- Agency staff see only reports assigned to their agency; platform admins see all; residents have no staff view. The scope is applied inside the repository query (`agencyScopeFor`), not only in the UI.
- A report outside the caller's scope returns 404, indistinguishable from a missing one, on the staff pages and in the use cases (`not_found`).
- Status changes and reassignments go through the domain state machine; the database rejects a routed report with no agency, and `status_events` and `assignments` reject UPDATE and DELETE.
- Concurrent status changes use compare-and-set, so only one wins.
- Staff pages show the report, its location and photos, but not who reported it. The status history shows what happened and when, not who did it.

## Abuse and reliability
Rate-limit submissions per account/IP, validate uploads, and sanitize all free text.

## Logging
No PII, tokens, or phone numbers in logs. This is enforced by code, not only by habit: the worker and the Auth.js hook use the structured logger in `src/server/logging/`, which writes one JSON line per event and passes every field through `redact` first. It hides any field named like personal data or a secret (email, phone, name, token, password, description, location, free-text notes...) and replaces anything that merely *looks* like an email address, a phone number or a long secret inside text. Errors are logged as their kind plus a scrubbed message, never the stack. Tests try to sneak personal data through in many shapes. The rule for developers is still: log ids, counts and kinds of events, not people. The small command-line helpers (`pnpm admin:create`, `pnpm boundaries:import`...) print to the operator's own terminal and are not part of the collected logs.
