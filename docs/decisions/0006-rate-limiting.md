# 0006: Postgres-backed rate limiting

Status: Accepted

## Decision
Rate limiting uses a small table in PostgreSQL (key, window start, count) behind a `RateLimiter` interface in the server layer. The sign-in endpoint is the first user. Keys are hashed identifiers (email hash, IP hash), never raw values.

## Rationale
Limits must hold across instances and restarts, and the project already avoids adding Redis (ADR 0002). A table keeps the stack small and is testable against the real database.

## Consequences
Each limited request costs one database write. Acceptable at current scale; revisit if traffic grows or the deployment target (still undecided) offers a better primitive. Stale rows need periodic cleanup, which can become a pg-boss job in Phase 5.
