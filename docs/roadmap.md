# Roadmap

Status lives only in this file.

- [x] Phase 0: Development harness (CLAUDE.md, docs, rules, skills, settings)
- [x] Phase 1: Scaffold (Next.js, TS strict, Tailwind, Drizzle, lint/test tooling, CI, local Postgres+PostGIS)
- [x] Phase 2: Auth + roles, agency and jurisdiction data (real state/LGA boundary import still to do; dev uses sample polygons)
- [x] Phase 3: Report submission (map, media upload). Not yet tested against a live Cloudinary account.
- [x] Phase 4: Routing + state machine (routing verified only against sample and test polygons; real state/LGA boundaries still to import; duplicate detection deferred)
- [x] Phase 5: SLA timers + escalation (pg-boss). SLA values and the escalation ladder are provisional placeholders (ADR 0010); escalations are recorded and displayed but not yet notified (Phase 6); worker hosting target undecided
- [x] Phase 6: Notifications (Resend, Termii). Tested on fakes and the dev outbox only: no live Resend domain (SPF/DKIM) or Termii account (sender ID, DND routing) yet; "reply STOP" and staff "new report assigned" emails deferred
- [x] Phase 7: Tracking + resident confirmation. Public pages show an allow-list only; the overdue board and public deadlines stay off until real SLA values are agreed; the 14-day auto-confirm period is provisional; rate limiting by client address depends on the undecided hosting setup
- [ ] Phase 8: Agency dashboards, hardening, launch

## Blocking decisions
- SLA values and escalation ladder, and the 14-day auto-confirm period (placeholders in use for Phase 5, see ADR 0010; real values still needed)
- Deployment target
- Real state/LGA boundary data source (needed for Phase 4 routing)
