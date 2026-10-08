# Product

## Purpose
Give Nigerian residents a reliable way to report infrastructure problems (roads, drainage, water, power, waste, streetlights) and hold responsible agencies to visible deadlines.

## Personas
- **Resident** — reports issues (with photo and map location), tracks progress, confirms or disputes resolution.
- **Agency officer** — receives routed reports, acknowledges, updates status, resolves.
- **Agency admin** — manages officers, sees SLA performance for their agency.
- **Platform admin** — manages agencies, categories, jurisdictions, SLA policy, manual reassignment.

## Core journeys
1. Report: pick category, drop pin, add photo and description, submit.
2. Route: system assigns the responsible agency (`routing.md`).
3. Acknowledge: agency acknowledges within the SLA window.
4. Resolve: agency marks resolved within the SLA window.
5. Confirm: resident confirms or disputes; disputed reports reopen.
6. Escalate: overdue acknowledgement or resolution escalates (`sla-and-escalation.md`).

## MVP scope
Reporting, routing, SLA timers, escalation, notifications (email + SMS), public tracking, resident confirmation, basic agency dashboard.

## Non-goals (for now)
Native mobile apps, payments, public analytics dashboards, AI triage.

## Decisions
- Public tracking shows category, status, agency, area name and timeline only: no description, photos, exact location or reporter (ADR 0013). The public overdue board is off until real SLA values are agreed.
- Reporting requires sign-in, with one to three photos per report (ADR 0007).

## Open questions
- Whether to offer a public map or photos later, which needs a moderation decision.
