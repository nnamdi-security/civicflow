---
name: add-notification-channel
description: Add a notification channel or a new notification type (email, SMS, other). Use when introducing messages sent to residents or agency staff.
---

1. Read `docs/integrations.md` and `.claude/rules/integrations.md`.
2. Define or reuse the adapter interface in `src/server/adapters/`; add the real implementation and an in-memory fake.
3. Add the template (versioned in code) and the event that triggers it.
4. Deliver via a pg-boss job: idempotent (dedupe key per report + event + recipient), with retry and backoff.
5. Respect user preferences and opt-out; use SMS only for key events.
6. Tests with the fake: sent once, retried on failure, not duplicated on re-run.
7. Document the channel in `docs/integrations.md`.
