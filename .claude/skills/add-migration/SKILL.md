---
name: add-migration
description: Add or change a database schema using Drizzle, generate and review the migration. Use for any change to tables, columns, indexes, or PostGIS types.
---

1. Read `.claude/rules/database.md` and `docs/domain-model.md`.
2. Edit the Drizzle schema in `src/db/`.
3. Run `pnpm db:generate`. Open the generated SQL and review it: PostGIS types, GiST indexes, `timestamptz`, destructive statements, data backfills for existing rows.
4. Apply to a scratch/local database with `pnpm db:migrate` and run `pnpm test`.
5. If the change affects the domain model, update `docs/domain-model.md`.
6. Never edit a previously applied migration; fix forward with a new one.
