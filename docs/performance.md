# Performance at volume

How CivicFlow behaves with a lot of data, measured rather than guessed (Phase 8 Part B).

## How it was measured
`pnpm volume:check` fills a **scratch** database with about **50,000 invented reports** and everything that goes with them (about 175,000 history entries, 100,000 photo records, 100,000 message records, 60,000 performance outcomes, 50,000 old anti-abuse counters, 5,000 residents, 30 agencies, 20 areas), then times the real application functions several times each. It refuses to run unless the database name ends in `_volume`, because it deletes data.

```
# once: create a scratch database
docker exec civicflow-db psql -U civicflow -d postgres -c "create database civicflow_volume"
# then
VOLUME_DATABASE_URL=postgres://civicflow:civicflow_dev_only@localhost:5433/civicflow_volume pnpm volume:check [number of reports]
```

The numbers below are from one developer laptop with a local database, so treat them as a guide to *shape* (what grows, what does not), not as promises about a production server.

## Results (50,000 reports, median of 5 runs)
| What | Time |
|---|---|
| Agency staff inbox (newest 100) | about 2 ms |
| Platform admin inbox, all reports (newest 100) | 34 ms before the index below, **4 ms** after |
| A resident's own reports | about 1 ms |
| Public tracking by reference code | about 5 ms |
| Public overdue board | about 33 ms |
| Performance dashboard, all agencies, 30 days / 90 days | about 50 ms / 64 ms |
| Performance dashboard, one agency | under 1 ms |
| Routing lookup for one report | about 3 ms |
| Triage queue | about 15 ms |
| System health page | about 19 ms |
| Resident data download (busiest resident) | about 13 ms |
| One batch of 50 notifications | about 195 ms |
| SLA scan **when nothing is due** | **about 120-145 ms** (with about 19,000 open reports) |
| SLA scan **catching up** | about 2 s per 1,000 escalations recorded |
| Daily retention, first run deleting 50,000 old rows | about 340 ms |
| Daily retention, nothing to delete | about 18 ms |

Everything a person waits for is well under a fifth of a second.

## What was found, and what was done
- **Platform admin inbox** scanned and sorted every report to show the newest 100. Fixed with an index on creation date (`reports_created_idx`, migration 0015): 34 ms to 4 ms, and now independent of how many reports exist.
- **SLA scan** first looked slow (about 4.9 s for a "second run"). The query itself takes 20 ms; the time was real work, because the scan deliberately records at most 1,000 missing escalations per timer per run and the invented data had thousands overdue at once, each also queueing a notification. After the backlog is drained an idle scan takes about 130 ms. So a long outage is caught up at roughly 1,000 escalations per minute, bounded per run. No change needed.
- **Auto-confirm** handled 200 reports per hourly run, so a backlog after an outage would take many hours. It now works through up to 10 batches (2,000 reports) per run. Tested.
- Retention, the notification sender and the dashboards needed nothing.

## Not measured
- Concurrent users: this times single calls, not many visitors at once. Before a large public launch, load-test the web app with a tool such as k6 against a staging copy.
- The production hosting environment's database (network distance, smaller instances, connection limits).
- Photo upload and delivery (handled by Cloudinary, not by us).
- Growth well beyond 50,000 reports. Re-run the tool with a larger count (`pnpm volume:check 500000`) when the project grows.
