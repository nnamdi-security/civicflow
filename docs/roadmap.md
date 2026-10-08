# Roadmap

Status lives only in this file.

- [x] Phase 0: Development harness (CLAUDE.md, docs, rules, skills, settings)
- [x] Phase 1: Scaffold (Next.js, TS strict, Tailwind, Drizzle, lint/test tooling, CI, local Postgres+PostGIS)
- [x] Phase 2: Auth + roles, agency and jurisdiction data (real state/LGA boundary import still to do; dev uses sample polygons)
- [x] Phase 3: Report submission (map, media upload). Not yet tested against a live Cloudinary account.
- [ ] Phase 4: Routing + state machine
- [ ] Phase 5: SLA timers + escalation (pg-boss)
- [ ] Phase 6: Notifications (Resend, Termii)
- [ ] Phase 7: Tracking + resident confirmation
- [ ] Phase 8: Agency dashboards, hardening, launch

## Blocking decisions
- SLA values and escalation ladder
- Deployment target
- Real state/LGA boundary data source (needed for Phase 4 routing)
