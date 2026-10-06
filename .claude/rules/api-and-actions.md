---
paths:
  - "src/server/**"
  - "src/app/**/actions.ts"
  - "src/app/api/**"
---

- Order in every mutation: authenticate, authorize, validate (Zod), call domain, persist, enqueue side effects.
- Authorization is by role and ownership/agency scope; never trust client-supplied agency or user IDs.
- Mutations must be idempotent or guarded against double submit.
- Status changes call the domain state machine; never write `status` directly.
- Enqueue pg-boss jobs in the same transaction as the domain write where possible.
- Job handlers are idempotent and safe to retry.
