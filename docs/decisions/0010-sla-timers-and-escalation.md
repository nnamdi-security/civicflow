# 0010: SLA timers and escalation

Status: Accepted

## Decision
Each routed report carries two stored deadlines, `ack_due_at` and `resolve_due_at`, set from the category's row in `sla_policies` when it is routed and cleared or reset as the timer rules in `docs/sla-and-escalation.md` require. A `sla_cycle` counter on the report increments whenever timers restart (reassignment, dispute).

Escalation is driven by a periodic pg-boss scan (every minute), not by one scheduled job per report. The scan asks a pure domain function which ladder steps are due and inserts them into the append-only `escalations` table, unique on report, timer, level and cycle, with `ON CONFLICT DO NOTHING`. Phase 5 records and displays escalations; Phase 6 will turn them into notifications.

The SLA values and the three-level ladder (agency admin at the deadline, platform admin after 24 hours, public overdue flag after 72 hours) are **provisional placeholders** chosen so the machinery can be built. They are not agreed targets. Timers use calendar time, never pause, and ignore priority.

## Rationale
A scan is idempotent by construction, survives worker downtime, and needs no cancellation when a report is acknowledged, reassigned or resolved, which is where per-report delayed jobs usually go wrong. Storing deadlines makes them indexable and visible without recomputation. Keeping policy in a table lets platform admins own it later without a code change.

## Consequences
The real SLA values and ladder must replace the placeholders through a new migration and a review under `sla-change-review`. Escalation latency is up to one scan interval. A worker process must run for escalations to appear; the hosting target is still undecided and needs its own ADR. Reports already routed when the migration is applied get deadlines from a backfill.
