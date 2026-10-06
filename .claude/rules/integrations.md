---
paths:
  - "src/server/adapters/**"
---

- Each vendor has an interface, a real implementation, and an in-memory fake. Callers depend on the interface.
- Set timeouts on every call; retry only idempotent operations with backoff.
- Map vendor errors to our own error types; do not leak vendor payloads upward.
- Never log message bodies, phone numbers, or emails.
- Read config from validated env; no secrets in code. Keep `.env.example` current.
- Termii: E.164 (+234) numbers. Resend: templates live in code.
