# SLA and escalation

## Deadlines
**TBD — values not yet decided.** Define per category and priority:

| Category | Priority | Acknowledge within | Resolve within |
|---|---|---|---|
| TBD | TBD | TBD | TBD |

## Rules (draft)
- Timers start at routing time (`routed`), not submission.
- Acknowledgement timer stops on `acknowledged`; resolution timer stops on `resolved`.
- A `disputed` report restarts the resolution timer.
- Pause/resume conditions (e.g. awaiting resident info): TBD.
- Calendar vs business hours: TBD.
- Deadlines are stored on the report as `timestamptz` and indexed; pg-boss jobs act on them.

## Escalation ladder
TBD. Suggested shape: officer → agency admin → platform admin → public overdue flag. Each step has a delay and a notification.

## Implementation notes
- SLA calculation is a pure function with an injected clock.
- Jobs are idempotent: re-running an escalation must not duplicate notifications.
- Any change here requires the `sla-change-review` skill.
