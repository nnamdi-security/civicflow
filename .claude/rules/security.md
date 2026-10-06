---
paths:
  - "src/**"
---

- No secrets, tokens, or keys in code, tests, or docs. Do not read or print `.env*` files.
- No PII (names, phones, emails, precise locations) in logs or error messages.
- Validate uploads (type, size) and sanitize free text before storing or rendering.
- Rate-limit public submission and auth endpoints.
- Enforce agency scoping in queries, not only in the UI.
- See `docs/security-privacy.md` for the full policy.
