# 0002: pg-boss for background jobs

Status: Accepted

## Decision
Use pg-boss, backed by the existing PostgreSQL database, for SLA checks, escalation, and notification delivery.

## Rationale
SLA timers and escalation need reliable, retryable, scheduled work. pg-boss avoids adding Redis and gives transactional enqueue alongside domain writes.

## Consequences
Requires a long-running worker process (not purely serverless). All handlers must be idempotent. Deployment must support a worker; record the target in a later ADR.
