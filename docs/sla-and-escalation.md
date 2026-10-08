# SLA and escalation

Design and rationale: ADR 0010 (`docs/decisions/0010-sla-timers-and-escalation.md`).

## Deadlines
**PROVISIONAL placeholder values.** They exist so the machinery can be built and tested; they are not agreed targets. Replace them via a new migration once real values are decided. Per category only; report priority is not modelled yet.

| Category | Acknowledge within | Resolve within |
|---|---|---|
| Roads and potholes | 24 hours | 14 days |
| Drainage and flooding | 24 hours | 7 days |
| Water supply | 12 hours | 3 days |
| Power and electricity | 12 hours | 3 days |
| Waste and sanitation | 24 hours | 5 days |
| Streetlights | 48 hours | 14 days |

Durations are calendar time, not business hours. They are stored in the `sla_policies` table (platform admins manage SLA policy; the admin screen arrives in Phase 8).

## Rules
- Timers start when a report is routed (`routed`), not at submission.
- Acknowledgement timer stops on `acknowledged`; resolution timer stops on `resolved`.
- Both timers run from the start moment: the resolve deadline is measured from routing, not from acknowledgement.
- A `disputed` report restarts the resolution timer from the moment of the dispute (`disputed → in_progress` does not restart it again).
- A reassignment restarts both timers from the new assignment. Each restart increments the report's `sla_cycle`.
- `rejected` and `confirmed` stop all timers. A report that is `resolved` has no running timer until it is disputed.
- Pause/resume (for example awaiting resident information): not supported. Timers never pause.
- A deadline is overdue strictly after it: at exactly the deadline the report is not yet overdue.
- All SLA math is UTC. Deadlines are `timestamptz` columns on `reports`, indexed. Domain code takes an injected clock.

## Escalation ladder
**PROVISIONAL.** Measured from the missed deadline, separately for the acknowledgement and resolution timers:

| Level | When | Effect |
|---|---|---|
| 1 | at the deadline | agency admin flagged |
| 2 | 24 hours after | platform admin flagged |
| 3 | 72 hours after | report marked publicly overdue |

Each step is recorded once per report, timer and `sla_cycle` in the append-only `escalations` table. Phase 5 only records escalations and shows them in the UI; sending notifications is Phase 6. A "due soon" reminder is not included.

## Implementation notes
- SLA calculation is a pure function with an injected clock (`src/domain/sla.ts`).
- A pg-boss job scans every minute for due ladder steps rather than scheduling one job per report. The scan inserts with `ON CONFLICT DO NOTHING`, so re-running or running two workers never duplicates an escalation. It catches up after downtime.
- The worker is a separate long-running process (`pnpm worker`). The hosting target is undecided and is recorded in a later ADR.
- Any change here requires the `sla-change-review` skill.
