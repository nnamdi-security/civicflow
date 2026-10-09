# 0014: Dashboards, administration and audit

Status: Accepted

## Decision
**Performance is measured from recorded outcomes, not recomputed.** Whenever an SLA timer stops because a report is acknowledged or resolved, the same transaction writes one row to an append-only `sla_outcomes` table: report, agency, timer, SLA cycle, when the timer started, its deadline, when it stopped, and whether it was met. A timer is **met** when it stops at or before its deadline (the exact deadline counts as met, matching "overdue is strictly after"). Rejections, reassignments and disputes end a timer without an outcome, so they neither help nor hurt an agency. `reports.sla_started_at` records when the current timers started. History begins at the migration date; older reports have no outcomes and the dashboards say so.

**Dashboard numbers**, for the last 30 or 90 days, counted by the date the timer stopped: percentage acknowledged on time, percentage resolved on time, median time to acknowledge and to resolve, reports still open, open reports currently overdue, and the dispute rate (disputes divided by resolutions in the window).

**Who sees what.** An agency admin sees their own agency. A platform admin sees every agency side by side. Officers and residents see no dashboard. The numbers are never public; the public overdue board (ADR 0013) is separate. Agency scope is applied inside the queries, never only in the page.

**Administration** is for platform admins: create and edit agencies, assign the jurisdictions an agency covers with a priority, edit the SLA policy per category, and switch categories on or off. Agency admins invite officers for their own agency; platform admins invite any staff. Staff can be deactivated and reactivated (`users.disabled_at`), which blocks sign-in and ends access immediately. There are no role changes and no hard deletes.

**SLA policy edits** require a short note, take effect only for timers that start afterwards (running timers keep the deadline they were given), and are written to the audit log.

**Every administrative change is written to an append-only `audit_log`**: who, what action, which record, and a short plain summary. It never stores emails, phone numbers or other personal data, only ids and role names.

## Rationale
Storing outcomes at the moment a timer stops is simple, cannot drift when policy values change later, and keeps the dashboard queries fast. Treating reassignment and rejection as neutral avoids blaming an agency for a report it never had long enough or should never have received. Keeping performance private to the agency and the platform lets them act on it without turning every figure into a public ranking before the SLA values are real. An audit log is the minimum needed to answer "who changed this?" for settings that affect accountability.

## Consequences
Dashboards are empty or thin until reports have moved through the system after the migration. Because the SLA values are still placeholders (ADR 0010), the percentages are only as meaningful as those values. Deactivating a user does not remove their history on reports. The audit log is not editable; correcting a mistake means making a new change.
