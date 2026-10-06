---
paths:
  - "**/*.ts"
  - "**/*.tsx"
---

- Strict mode on. No `any`; use `unknown` and narrow. No non-null assertions without a comment.
- Validate all external input (requests, env, vendor responses) with Zod at the boundary; trust types inside.
- Domain code (`src/domain/`) is pure: no I/O, no `Date.now()`/`new Date()`; take a `Clock` parameter.
- Return typed results or throw typed domain errors; never swallow errors.
- Prefer named exports. Files are kebab-case, types PascalCase.
- Money, time, and IDs use dedicated types/helpers, not bare primitives, where mixing them is a risk.
