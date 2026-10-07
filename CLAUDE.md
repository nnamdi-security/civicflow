# CivicFlow

Nigerian civic issue reporting and accountability platform. Residents report infrastructure problems, reports are routed to responsible agencies, SLA timers track acknowledgement and resolution deadlines, overdue issues escalate, and residents track and confirm resolution.

Stack: Next.js, TypeScript (strict), PostgreSQL + PostGIS, Drizzle, Auth.js, pg-boss (jobs), Tailwind, Cloudinary, Resend, Termii, Leaflet/OpenStreetMap. Package manager: **pnpm**.

## Status
Phase 1 scaffold done; no domain code yet. See `docs/roadmap.md`.

## Commands
- `pnpm dev` / `pnpm build`
- `pnpm lint` / `pnpm typecheck` / `pnpm test`
- `pnpm db:up` / `pnpm db:down` (local Postgres+PostGIS via Docker, ADR 0004)
- `pnpm db:generate` / `pnpm db:migrate` (Drizzle)
- Integration tests need `DATABASE_URL` and `TEST_DATABASE_URL` set (see README).

## Non-negotiables
- Never edit an applied migration; add a new one.
- Report status changes go through the state machine only (`docs/domain-model.md`).
- SLA math is UTC; domain code takes an injected clock, never `Date.now()` directly.
- All vendor calls (Cloudinary, Resend, Termii) sit behind adapters with test fakes.
- No PII in logs; no secrets in code. Authorization check comes first in every mutation.
- Record significant technical choices as ADRs in `docs/decisions/`; don't re-litigate accepted ones.

## Workflow
- Plan before changes that span multiple files or layers.
- Run `pnpm typecheck` and `pnpm test` before declaring work done.
- Change SLA/escalation logic only via the `sla-change-review` skill.

## Where things live
- `docs/` — product, architecture, domain, SLA, routing, integrations, security, testing, roadmap, ADRs. Read the relevant file before working in that area.
- `.claude/rules/` — path-scoped coding rules, loaded automatically.
- `.claude/skills/` — repeatable workflows (`add-migration`, `new-feature-slice`, `add-notification-channel`, `sla-change-review`, `write-adr`).
