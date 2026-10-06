---
name: new-feature-slice
description: Implement a new feature end to end across schema, domain, server action, UI, and tests. Use when adding a user-facing capability.
---

1. Confirm the feature matches `docs/product.md` and the current roadmap phase; read the relevant `docs/` files.
2. Write a short plan listing the layers touched; get agreement if scope is unclear.
3. Schema: use the `add-migration` skill if data changes.
4. Domain: pure logic first, with unit tests (fake clock).
5. Entry point: server action/route following `.claude/rules/api-and-actions.md` (authorize, validate, domain, persist, enqueue).
6. UI: follow `.claude/rules/ui.md`.
7. Tests: unit, integration for data/jobs; E2E only for core journeys.
8. Run `pnpm lint`, `pnpm typecheck`, `pnpm test`.
9. Update `docs/roadmap.md` and any doc whose facts changed.
