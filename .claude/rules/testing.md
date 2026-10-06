---
paths:
  - "**/*.test.ts"
  - "**/*.test.tsx"
  - "tests/**"
---

- Test files sit next to the code as `*.test.ts`; E2E lives in `tests/e2e/`.
- Domain tests use a fake clock; test boundaries (exactly at deadline, one second either side).
- Integration tests use a real PostgreSQL + PostGIS database, not mocks.
- Never call real vendors; use adapter fakes.
- Test behaviour, not implementation. One reason to fail per test.
- A bug fix starts with a failing test.
