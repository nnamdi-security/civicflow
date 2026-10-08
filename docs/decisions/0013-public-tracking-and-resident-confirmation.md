# 0013: Public tracking and resident confirmation

Status: Accepted

## Decision
**Public pages show a strict allow-list.** `/track/[reference]` (found by reference code, no sign-in) shows the category, status, handling agency, the area name (LGA or state), the status timeline with times, and overdue labels. It never shows who reported it, who handled it, the description, photos, the exact location, or staff notes. The area comes from `reports.jurisdiction_id`, set when the report is created. There is no public map and no public list of all reports. A pure `toPublicReport()` builds the public data from named fields only, and a test fixes its exact keys so a new column cannot leak by accident.

**Lookups are rate limited** per client address (keyed hash) and the tracking pages are `noindex`. Unknown references answer 404, the same as any other miss.

**The public overdue board (`/overdue`) is built but off by default.** It is enabled by `PUBLIC_OVERDUE_BOARD=true`. It lists reports at escalation level 3 with agency, category, area and days overdue. It stays off until real SLA values are agreed, because naming agencies publicly on placeholder deadlines (ADR 0010) is a reputational risk. Deadlines, overdue labels and the public overdue flag appear on the public tracking page only when the same switch is on, since they all rest on the placeholder SLA values; the resident's own page always shows them.

**Resident confirmation** uses the existing state machine: the reporter moves `resolved` to `confirmed` or `disputed`. A dispute requires a note, so the agency knows what is wrong. A report still `resolved` 14 days after it was resolved is confirmed automatically by the system, with the reason "auto-confirmed after 14 days". The 14 days is **provisional**, like the SLA values.

## Rationale
Descriptions and photos are free content that can carry names, phone numbers, faces and house numbers, and nobody moderates them, so they stay private. An area name tells the public where without pointing at a home. A reference code works as a hard-to-guess capability, but rate limiting and `noindex` stop it being enumerated or crawled. Without auto-confirmation, a resolved report whose reporter never answers would sit unresolved forever with no timer running.

## Consequences
The public page is deliberately sparse; if people want a map or photos, that needs a moderation decision and a new ADR. Client-address detection for rate limiting depends on the undecided hosting setup (ADR 0006). The auto-confirm period and the overdue board's go-live depend on real policy values. Auto-confirm may close reports the resident never saw, so the history says plainly that it was automatic.
