---
name: sla-change-review
description: Required checklist when changing SLA deadlines, timers, escalation, or the report state machine. Use before and after any such change.
---

1. Read `docs/sla-and-escalation.md` and `docs/domain-model.md`. State which rule is changing and why.
2. Update the docs first (or in the same change); code must match them.
3. Keep SLA math pure with an injected clock; no `Date.now()`.
4. Tests must cover: exactly at deadline and one second either side, UTC handling, pause/resume, dispute/reopen restarting timers, and every affected state transition.
5. Jobs: confirm handlers are idempotent; re-running must not duplicate escalations or notifications.
6. Consider existing in-flight reports: does the change need a backfill migration (`add-migration`)?
7. Run `pnpm typecheck` and `pnpm test`; report results.
8. If this changes a policy decision, add an ADR (`write-adr`).
