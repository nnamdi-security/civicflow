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
- A report that stays `resolved` for more than 14 days is confirmed automatically by the system (PROVISIONAL period, ADR 0013). The period counts from the latest time it entered `resolved` and is exactly 14 days: at 14 days it is not yet confirmed, one second later it is.
- Pause/resume (for example awaiting resident information): not supported. Timers never pause.
- A deadline is overdue strictly after it: at exactly the deadline the report is not yet overdue.
- All SLA math is UTC. Deadlines are `timestamptz` columns on `reports`, indexed. Domain code takes an injected clock.

## Measuring performance (Phase 8)
- When the acknowledgement or resolution timer stops because of `acknowledged` or `resolved`, an `sla_outcomes` row records the agency, SLA cycle, start, deadline, stop time and whether it was met. **Met** means stopped at or before the deadline: exactly on the deadline is met, one second later is not.
- Timers ended by a rejection, a reassignment or a dispute produce no outcome.
- The agency dashboards (30 or 90 days, by stop date) report on-time percentages, median times, open and overdue counts and the dispute rate. History starts when the outcomes table was introduced. See ADR 0014.

## Changing SLA policy (Phase 8)
- Platform admins edit durations per category in the admin screen. A short note is required and the change is written to the audit log.
- A change applies only to timers that start afterwards. Timers already running keep their deadline. There is no backfill of running timers.
- The values currently in use are still the provisional placeholders until real targets are agreed.

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
