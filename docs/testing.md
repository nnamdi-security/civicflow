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
A small Playwright suite for the core journeys (report → track → confirm). Phase 3 covers sign in → report with pin and photo → see it in "My reports" → another resident gets a 404. Run with `pnpm test:e2e` (needs `TEST_DATABASE_URL` and a one-off `pnpm exec playwright install chromium`). It starts `next dev` on port 3201 against the test database, reads sign-in links from the dev outbox, uses the dev media store, and stubs map tiles so it does not touch the network. It runs in CI after the unit and integration tests.

## Tooling
Vitest for unit and integration; Playwright for E2E. Run with `pnpm test`.
