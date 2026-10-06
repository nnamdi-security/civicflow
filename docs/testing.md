# Testing

## Must be unit tested
- Status state machine: every allowed and disallowed transition.
- SLA calculation: boundaries, timezone/UTC, pause/resume, reopen.
- Routing: matching, tiebreaks, fallback.

## Integration tests
Run against a real PostgreSQL + PostGIS instance (docker), not mocks. Cover repositories, spatial queries, and pg-boss job handlers (idempotency).

## Adapters
Tests use the in-memory fakes; no test calls a real vendor.

## E2E
A small Playwright suite for the core journeys once the UI exists (report → track → confirm).

## Tooling
Vitest for unit and integration; Playwright for E2E. Run with `pnpm test`.
