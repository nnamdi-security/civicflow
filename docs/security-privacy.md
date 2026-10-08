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

## Anonymous reporting
Undecided. If allowed, require rate limiting and a lightweight abuse control.

## Abuse and reliability
Rate-limit submissions per account/IP, validate uploads, and sanitize all free text.

## Logging
No PII, tokens, or phone numbers in logs.
