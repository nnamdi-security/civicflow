# Standup log

High-level, newest first. One entry per working day: what was done, what is next, and anything blocking. Commit hashes point to detail. Roadmap status lives in `roadmap.md`, not here.

## 2026-10-09 (Phase 8, Part B)
**Done**
- Phase 8 Part B (hardening and launch readiness) completed.
  - Security: strict browser protections (content security policy and other headers), friendly error pages that reveal nothing about hidden reports, and automated accessibility checks on every page.
  - Privacy: residents can download their data and erase their own account (identity removed, locations blurred, photos queued for deletion); old technical records are tidied automatically (ADR 0015).
  - Operations: a background-job health page, a worker status on the public health check, and logging that automatically removes personal data. A configuration checker (`pnpm check:config`) catches unsafe production settings.
  - Data tools: a boundary importer for real state and LGA maps.
  - Launch documents: runbook, launch checklist, hosting options (ADR 0016), and DRAFT privacy notice and terms (need legal review).
  - Volume check: tested with 50,000 invented reports. Every screen responds in under 0.2 seconds. Found and fixed one slow list (platform admin inbox, 34 ms to 4 ms) and made the automatic confirmation job clear backlogs faster. See `docs/performance.md`.
  - Security review (`docs/security-review.md`): fixed four real weaknesses: rate limits could be bypassed by forging a network-address header; text messages to one phone number could be flooded through many accounts; the public health check could exhaust database connections; staff notes were not cleaned of misleading invisible characters.

**Next**
- Your decisions and real-world checks in `docs/launch-checklist.md` (real deadlines, hosting, boundary data, legal text, email/SMS/photo accounts). Recommend a one-agency pilot.

**Blockers / risks**
- Live email, SMS and photo services are untested; the legal pages are drafts; hosting is undecided.
- Before launch: set `TRUSTED_PROXY_HOPS` correctly for the host, and run the app with a database role that cannot alter tables (see security review, residual risks).

## 2026-10-09 (Phase 8, Part A)
**Done**
- Phase 8 Part A (agency dashboards and administration) completed. Part B (hardening and launch readiness) is next, after your review.
  - Every time an agency acknowledges or resolves a report, the system now records whether it met the deadline and how long it took. This is the basis for the performance figures; history starts from today, so numbers build up over time.
  - Agency admins can open a performance page for their own agency (on-time percentages, typical time taken, open and overdue reports, how often residents say "not fixed"). Platform admins see all agencies side by side. Nobody else can see it, and it is not public.
  - Platform admins now have admin screens to create and edit agencies, choose which areas each agency covers (and in what priority), change the SLA deadlines (a written reason is required, and it only affects reports that start after the change), switch report categories on or off, and read an audit log of every administrative change. The audit log cannot be edited and contains no personal data.
  - Agency admins can invite and deactivate officers in their own agency; platform admins can do this for any staff. Deactivating someone signs them out immediately, stops new sign-in links and stops notifications, while keeping their history. The system refuses to deactivate the last active platform admin, even if two admins try it at the same moment.
  - Recorded the decisions as ADR 0014.
- All new code is commented for beginners, as requested.
- Tests: 613 unit and integration tests plus 9 end-to-end journeys, all passing.

**Next**
- Your review of Part A, then Part B: boundary-data importer, web security headers and error pages, accessibility checks, data retention and deletion, operations health page, launch checklist and runbook.

**Blockers / risks**
- Performance percentages rest on provisional SLA values until real targets are agreed.
- Part B needs your input on: hosting, the real state/LGA boundary data source, and privacy notice wording.
- Resend domain and Termii sender ID (real messages), worker hosting, and a live Cloudinary check are still outstanding.

Commits: `33f39b8`..latest (Phase 8 Part A).

## 2026-10-09 (Phase 7)
**Done**
- Phase 7 (tracking and resident confirmation) completed.
  - Residents can now answer "has this been fixed?" from their report page. Saying "yes" closes the report; saying "no" requires a short note, reopens it for the agency, tells the agency admins, and restarts the resolution clock.
  - A report that stays resolved with no answer for 14 days is confirmed automatically by a background job (14 days is a provisional figure), and the history says plainly that it was automatic.
  - Anyone can look a report up by its reference code on a public tracking page. It shows only category, status, agency, area name and a status timeline: never who reported it, the description, photos, the exact spot or staff notes. A test pins the exact fields so nothing new can leak by accident. Lookups are rate limited and the pages are hidden from search engines.
  - A public "overdue reports" board is built but switched off by default until real SLA targets are agreed, so agencies are not named publicly on placeholder deadlines.
  - Residents now see the deadlines the agency is held to on their own report page.
  - Recorded the decisions as ADR 0013.
- Tests: 469 unit and integration tests plus 7 end-to-end journeys, all passing.

**Next**
- Phase 8 (agency dashboards, hardening, launch).

**Blockers / risks**
- Real SLA targets are still needed before the public overdue board can be switched on.
- Rate limiting of public lookups depends on how the app is hosted, which is not yet decided.
- Resend domain and Termii sender ID (for real messages), worker hosting, real state/LGA boundaries and a live Cloudinary check are still outstanding.

Commits: `1c91d87`..latest (Phase 7).

## 2026-10-09 (Phase 6)
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
