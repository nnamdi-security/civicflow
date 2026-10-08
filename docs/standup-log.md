# Standup log

High-level, newest first. One entry per working day: what was done, what is next, and anything blocking. Commit hashes point to detail. Roadmap status lives in `roadmap.md`, not here.

## 2026-10-09
**Done**
- Phase 6 (email and SMS notifications) completed and tested with fake and development senders; nothing has been sent through the real providers yet.
  - Residents are emailed when their report is received, sent to an agency, acknowledged, resolved or rejected; agency admins are told about disputes and overdue reports; platform admins about reports a day overdue; and residents when a report becomes publicly overdue.
  - SMS is reserved for two moments: a report being resolved and a report becoming publicly overdue.
  - Residents can add a phone number, confirm it with a texted code, switch email and SMS updates on or off, and remove their number, all from their account page.
  - Messages are queued in the same database step as the change that causes them, so none is lost or sent for a change that did not happen. A background sender delivers them every minute, retries temporary failures, and never sends the same message twice on a repeat run.
  - Messages carry only the report reference and a link, never the description or location.
  - Recorded the design as ADRs 0011 (message queue) and 0012 (SMS consent and verification).
- Tests: 419 unit and integration tests plus 5 end-to-end journeys, all passing.

**Next**
- Phase 7 (public tracking and resident confirmation).

**Blockers / risks**
- Need a Resend sending domain (SPF/DKIM) and a Termii account with an approved sender ID before any real message can go out.
- SMS delivery on Nigeria's Do-Not-Disturb numbers is untested until Termii is connected.
- Real SLA values, worker hosting, real state/LGA boundaries and a live Cloudinary check are still outstanding.

Commits: `10c95dd`..latest (Phase 6).

## 2026-10-08 (Phase 5)
**Done**
- Phase 5 (deadlines and escalation) completed, using provisional placeholder values until real SLA targets are decided.
  - Every routed report now has an acknowledgement deadline and a resolution deadline, taken from per-category policy (for example roads: 24 hours to acknowledge, 14 days to resolve).
  - Deadlines start, stop and restart correctly as a report moves: acknowledging stops the first clock, resolving stops both, a resident dispute restarts the resolution clock, a reassignment restarts both.
  - A background worker checks every minute and records escalations: agency admin at the deadline, platform admin after 24 hours, publicly overdue after 72 hours. Re-running never creates duplicates, and it catches up after downtime.
  - Staff and residents now see an "Overdue" notice in words (not just colour) on report pages and the staff inbox.
  - Recorded the design as ADR 0010 and updated the SLA documentation.
- Tests: 312 unit and integration tests plus 4 end-to-end journeys, all passing.

**Next**
- Phase 6 (notifications by email and SMS) will turn recorded escalations and status changes into messages.

**Blockers / risks**
- Real SLA values and escalation ladder still needed; the numbers in use are placeholders.
- Worker needs a long-running host; deployment target not yet chosen.
- Real state/LGA boundaries and a live Cloudinary check are still outstanding.

Commits: `eef5efa`..latest (Phase 5).

## 2026-10-08 (Phase 4)
**Done**
- Phase 4 (routing and status workflow) completed.
  - Report status state machine with role rules, tested for every status pair.
  - Automatic routing of new reports to the right agency by location and category, with a fallback to the parent jurisdiction and a triage queue for unmatched reports.
  - Staff can acknowledge, progress, resolve or reject reports; admins can reassign. Agencies only see their own reports.
  - New staff inbox, report page and triage page; residents now see which agency handles their report and its progress.
  - Recorded the routing decisions as ADR 0009.
- Test suite grew to 268 unit and integration tests plus a new end-to-end journey.
- Phase 3 (report submission with map and photo upload) and Phase 2 (sign-in, roles, agency data) also landed earlier this session; see `git log`.

**Next**
- Phase 5 (SLA timers and escalation), once the decisions below are made.

**Blockers / risks**
- Need decisions: SLA deadlines per category and the escalation ladder.
- Need a source for real state and LGA boundaries; routing is only tested on sample polygons.
- Photo upload is not yet tested against a live Cloudinary account.

Commits: `0c120e1`..`51cf07c` (Phase 4).

## 2026-10-07 and earlier
- Project scaffold: Next.js, TypeScript, PostgreSQL with PostGIS, tooling and CI (`6ebd52d`).
- Development harness: project rules, docs and skills (`7ca90e4`, 2026-10-06).
