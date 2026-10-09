# 0015: Data retention, erasure and export

Status: Accepted (all periods are PROVISIONAL and need review by someone qualified in Nigerian data protection law before launch)

## Decision
**Housekeeping is automatic.** A daily worker job deletes data that has no lasting purpose: rate-limit counters older than 7 days; expired phone verification codes; expired sessions and sign-in tokens; delivered or skipped notification records older than 90 days; failed notification records older than 180 days. Notification records never hold message text, addresses or phone numbers (ADR 0011), so this is tidying, not privacy-critical.

**Reports are kept.** A report is an accountability record, so it is not deleted with its author. It is kept with its category, status, handling agency, area and status timeline.

**A resident can erase their account** from their account page, after typing a confirmation word. In one transaction this: replaces the email with a placeholder address and removes name, picture, phone number and notification settings; ends their sessions and sign-in tokens; deletes their notification records and pending phone codes; marks the account deactivated and erased so nobody can sign in to it; replaces each of their reports' description with "removed at the reporter's request"; coarsens each report's exact location to the middle of its area (or, if it has no area, to a coarse grid square about 11 km wide); redacts the free-text notes they wrote on status events; and queues deletion of their photos from the media provider, which a worker job completes with retries. A confirmation email is sent to the old address just before it is erased, so a hijacked session is noticed. Erasure is recorded in the audit log without personal data. **Staff accounts are not erased this way**: they are deactivated (ADR 0014), because the audit log and report history refer to them.

**Status events stay append-only, with one narrow exception.** The database trigger still refuses to change or delete them, except that the erasure transaction may overwrite the `reason` text of events its user authored, with the word "removed". The exception only works when the transaction sets a special session value, and it can change nothing else.

**A resident can download their data** as a JSON file from their account page: profile and settings, their reports (description, location, photo ids, status history), and a list of the notifications sent to them (what and when, not the text). Requests are rate limited and the file is never cached.

## Rationale
Residents should be able to leave and take their personal data with them (a right under the Nigeria Data Protection Act), while the public record of what agencies did and when must survive, or accountability would depend on nobody ever deleting their account. Keeping the area but not the exact spot or the description removes what could identify a person or a home, and keeps the record useful. Deleting photos from the provider is part of erasure, not an afterthought. Narrowing the append-only exception to one column, one value and one code path keeps the guarantee meaningful.

## Consequences
The retention periods and the exact erasure behaviour must be confirmed with a data-protection adviser; they are starting points, not legal advice. Deleting photos from Cloudinary has not been tested against a live account. Backups made before an erasure will still contain the data until they expire, so the backup retention period must be short and documented in the runbook. Erasing the account of a person who has an open report does not stop the agency working on it; the agency simply can no longer contact the reporter.
