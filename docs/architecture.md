# Architecture

## Layers (dependencies point down only)
1. **UI** — Next.js App Router, server components by default, Tailwind, Leaflet (client only).
2. **Entry points** — server actions and route handlers. Authenticate, authorize, validate (Zod), call domain.
3. **Domain** — pure TypeScript: state machine, SLA calculation, routing rules. No I/O; clock injected.
4. **Data / adapters** — Drizzle repositories, and adapters for Cloudinary, Resend, Termii.

## Background jobs
pg-boss on the same PostgreSQL database (ADR 0002). Jobs: SLA deadline checks, escalation, notification delivery with retry. Jobs must be idempotent.

Phase 5 runs one recurring job, `sla-scan` (every minute), from a separate worker process (`pnpm worker`, `scripts/worker.ts`). Handlers live in `src/server/jobs/`; the scan itself is `src/server/sla/scan.ts` and records escalations idempotently (ADR 0010). The app does not need the worker to serve requests, but escalations only appear while it runs.

## Auth
Auth.js (ADR 0003). Roles: resident, agency_officer, agency_admin, platform_admin.

## Layout (confirmed at scaffold, Phase 1)
```
src/app/        routes and UI
src/domain/     pure domain logic
src/server/     actions, repositories, jobs, adapters
src/db/         Drizzle schema and migrations
```

## External services
See `integrations.md`.

## Deployment
TBD (needs managed Postgres with PostGIS). Record as an ADR when decided.
