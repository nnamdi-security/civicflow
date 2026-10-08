# Standup log

High-level, newest first. One entry per working day: what was done, what is next, and anything blocking. Commit hashes point to detail. Roadmap status lives in `roadmap.md`, not here.

## 2026-10-08
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
