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
A small Playwright suite for the core journeys (report → track → confirm). Phase 3 covers sign in → report with pin and photo → see it in "My reports" → another resident gets a 404. Phase 4 adds report → routed to an agency → another agency's officer gets a 404 → the assigned officer acknowledges → the resident sees the new status and history (the spec creates and removes its own jurisdiction, agencies and officers). Phase 5 adds: an overdue report is escalated by the real scan (run twice, the second records nothing) and both the resident and staff see the overdue notice until the officer acknowledges it. Phase 6 adds: confirm a phone number with the texted code (including a wrong code and an invalid number), turn SMS on, then see the real dispatcher send the received, routed, acknowledged and resolved emails and the resolved SMS to the dev outbox, never containing the description or location, and nothing more on a second run. The triage and reassignment screens are covered by integration tests of the use cases, not by E2E. Run with `pnpm test:e2e` (needs `TEST_DATABASE_URL` and a one-off `pnpm exec playwright install chromium`). It starts `next dev` on port 3201 against the test database, reads sign-in links from the dev outbox, uses the dev media store, and stubs map tiles so it does not touch the network. It runs in CI after the unit and integration tests.

## Tooling
Vitest for unit and integration; Playwright for E2E. Run with `pnpm test`.
