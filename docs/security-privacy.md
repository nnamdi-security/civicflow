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
- Retention period and deletion process: TBD.
- Treat photo EXIF and precise home-adjacent locations as sensitive.

## Notifications and phone numbers (Phase 6)
- A phone number is personal data. It is stored only after the user adds it, is used for SMS only after verification by a texted code (hashed, expiring, attempt-limited), and can be removed at any time (ADR 0012).
- Notification rows hold ids, channel, status and error codes only. Message bodies, addresses and phone numbers are never stored in them or written to logs (ADR 0011).
- Messages carry the reference code and a link, never the description or the location.
- Residents can switch off their report emails and SMS. Staff escalation emails are operational and cannot be switched off.

## Anonymous reporting
Not offered: reports require a signed-in user (ADR 0007). Revisit with a new ADR if sign-in proves a barrier; anonymous reporting would need a CAPTCHA-style control and token-based tracking.

## Report submission and uploads
- Submissions are rate limited per account (5 per hour, 20 per day); repeats of the same form do not count. Photo upload authorizations are limited to 30 per hour.
- Photos are uploaded straight to the media provider with a short-lived signed request scoped to the reporter's own folder. Before saving a report the server re-verifies every photo with the provider (owner folder, allowed format, size) and refuses a photo already attached elsewhere (ADR 0008).
- The browser re-encodes photos before upload, which drops embedded EXIF data. **Open item:** confirm that the provider also strips metadata from stored originals (the upload requests `fl_strip_profile`) with a real Cloudinary account before launch.
- Free text is normalized (control and invisible characters removed) on write and escaped on render; it is never rendered as HTML.
- A reporter can only read their own reports; another user's report returns 404, indistinguishable from a missing one.
- Reports store the exact point. How precisely the location appears in public views is a Phase 7 decision.

## Routing and staff access (Phase 4)
- Agency staff see only reports assigned to their agency; platform admins see all; residents have no staff view. The scope is applied inside the repository query (`agencyScopeFor`), not only in the UI.
- A report outside the caller's scope returns 404, indistinguishable from a missing one, on the staff pages and in the use cases (`not_found`).
- Status changes and reassignments go through the domain state machine; the database rejects a routed report with no agency, and `status_events` and `assignments` reject UPDATE and DELETE.
- Concurrent status changes use compare-and-set, so only one wins.
- Staff pages show the report, its location and photos, but not who reported it. The status history shows what happened and when, not who did it.

## Abuse and reliability
Rate-limit submissions per account/IP, validate uploads, and sanitize all free text.

## Logging
No PII, tokens, or phone numbers in logs.
