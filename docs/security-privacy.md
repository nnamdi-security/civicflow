# Security and privacy

## Access control
Roles: resident, agency_officer, agency_admin, platform_admin. Agency staff see only their agency's reports. Enforce in the entry-point layer and in repository queries; never rely on the UI.

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
