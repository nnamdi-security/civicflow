# 0011: Notification outbox and dispatcher

Status: Accepted

## Decision
Notifications are rows in a `notifications` table, inserted in the same database transaction as the change that causes them (report created, status changed, escalation recorded). A recurring pg-boss job in the worker claims due rows with `FOR UPDATE SKIP LOCKED`, sends them through the email and SMS adapters, and records the outcome on the row. A failed send is retried with backoff (1, 5, 30 and 120 minutes), then marked `failed`.

Each row is unique on report, event, recipient, channel and SLA cycle, with `ON CONFLICT DO NOTHING`, so a repeated trigger never queues a second message. Rows hold ids, channel, status, attempt count and a short error code. They never hold message bodies, email addresses or phone numbers; recipients are resolved from the user row at send time.

Delivery is at-least-once. Resend is given the row's dedupe key as an idempotency key. Termii has no equivalent, so a crash between a successful send and recording it could send one SMS twice.

## Rationale
Inserting in the caller's transaction means a rolled-back change never leaves a message behind, and a committed one always has its message queued, without giving the web process its own pg-boss connection. A scanning dispatcher matches the approach of ADR 0010: idempotent, self-healing after downtime, no per-message scheduling to cancel. It trades up to about a minute of latency, which is fine for these messages. This deliberately differs from "one pg-boss job per notification" in the `add-notification-channel` skill, which assumed the web process could enqueue.

## Consequences
Notifications only go out while the worker runs. The residual double-send risk for SMS is accepted and documented. Retention of `notifications` rows is covered by the general retention decision, still TBD. Real delivery is unverified until a Resend domain and a Termii sender ID exist.
