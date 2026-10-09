# Runbook

How to run CivicFlow, and what to do when something goes wrong. Written for the person on call, who may not have built the system. Where something has not been tested against the real service (the hosting platform, Resend, Termii, Cloudinary), it says so. The matching pre-launch list is `docs/launch-checklist.md`.

## 1. What is running

| Part | What it is | If it stops |
|---|---|---|
| **Web app** (`pnpm start`) | The website: pages, forms, the public tracking pages | Nobody can use the site |
| **Worker** (`pnpm worker`) | A separate process that runs scheduled jobs (see section 5) | The site still works, but **deadlines are not enforced, no emails or texts are sent, old data is not tidied, erased accounts' photos are not deleted** |
| **Database** (PostgreSQL with PostGIS) | Everything: reports, accounts, the job queue | Everything stops |
| Resend | Sends email | No sign-in links or updates by email |
| Termii | Sends text messages | No texts; phone verification unavailable (email still works) |
| Cloudinary | Stores photos | New photos cannot be uploaded or shown |
| OpenStreetMap | Map pictures for the report form | The map looks blank (typed coordinates and "use my location" still work) |

The web app and the worker are **two separate programs** that both need the same settings and the same database. Running the website without the worker is the most common way to end up with a system that "works" but silently does nothing about overdue reports.

## 2. Settings

All settings are environment variables; `.env.example` lists them. **Before any launch or settings change, run:**

```
pnpm check:config
```

It prints PASS, WARN or FAIL for each setting and exits with an error if anything must be fixed. It never prints a secret's value.

## 3. First deployment

1. Create the PostgreSQL database with the PostGIS extension available. The first migration enables PostGIS, so the database user must be allowed to create extensions (or an administrator must enable it once).
2. Set the environment variables. Run `pnpm check:config` until it shows no FAIL.
3. Apply the database changes: `pnpm db:migrate`.
4. Create the first platform admin: `pnpm admin:create someone@yourdomain`.
5. Start the web app (`pnpm build` then `pnpm start`) and the worker (`pnpm worker`).
6. Check `GET /api/health` returns `{"status":"ok", ...}`. Sign in as the platform admin (a sign-in link is emailed to that address) and open **Administration > System health**. After a couple of minutes every job should say "Running normally". Until the worker has run, they say "NEVER RUN".
7. Load real boundaries (section 6), then create agencies and their coverage, then invite agency admins.

## 4. Deploying an update

1. `pnpm check:config` in the target environment.
2. Deploy the new code, then **run `pnpm db:migrate` before starting the new web app and worker**.
3. Restart the web app and the worker.
4. Check `/api/health` and the System health page.

Rules the migrations follow, which make updates safe:
- **Migrations only move forward.** An applied migration is never edited. A mistake is fixed by a new migration.
- There are **no automatic "undo" migrations**. To go back, see section 9 (restore).
- The worker is safe to restart at any moment: every job can be repeated without harm (it was designed that way and is tested). Running two workers at once is also safe.

## 5. The worker and its jobs

Open **Administration > System health** to see them. A job saying LATE, FAILING or NEVER RUN needs attention.

| Job | Runs | What it does | If it is down |
|---|---|---|---|
| `sla-scan` | every minute | Finds overdue reports and records escalations | Overdue reports are not escalated or flagged as publicly overdue |
| `notification-dispatch` | every minute | Sends queued emails and texts, with retries | Nobody is notified; messages queue up and go out when it returns |
| `auto-confirm` | hourly | Confirms resolved reports nobody answered for 14 days | Resolved reports stay unconfirmed |
| `retention` | daily, 03:00 UTC | Removes old technical records | Old records accumulate (harmless short term) |
| `media-cleanup` | every 5 minutes | Deletes photos of erased accounts from Cloudinary | Photos of erased accounts stay at Cloudinary longer than promised |

If the worker was down for a while, simply start it: it catches up (the scans find everything that is due; queued messages are sent). Nothing is lost.

## 6. Everyday administration

All of this is on the **Administration** page (platform admins only), except staff management, which agency admins also use for their own agency.

- **Add an agency:** Agencies > Create. Then open it and **add the areas it covers**, each with a priority (lower number is tried first). An agency with no coverage never receives reports automatically.
- **Invite staff:** Staff > Invite. The person then signs in with a link emailed to that address. To remove someone's access, **Deactivate** them; this signs them out immediately and keeps their history.
- **Change a deadline:** SLA deadlines. A written reason is required. It affects only timers that start after the change; reports already waiting keep the deadline they were given.
- **Load real boundaries:** `pnpm boundaries:import <file.geojson> --level state --name-field <property> --dry-run` first, then without `--dry-run`, then the same for LGAs with `--level lga`. Nothing is saved if any feature has a problem, and it never deletes anything. See `docs/routing.md`. Afterwards, spot-check routing with a few known addresses.
- **Reports in "triage":** Administration > Unrouted reports. These are reports no agency covers for their category and place. Assign an agency by hand, or add coverage so future ones route automatically.
- **Who changed what:** Administration > Audit log.

## 7. Common problems

**"The background worker has a problem" on the health page, or `worker: "degraded"` from `/api/health`.**
Check the worker process is actually running and can reach the database. Look at its logs for `worker.failed_to_start` or `worker.queue_error`. Restart it. If one job says FAILING, its last run raised an error; the error kind is in the logs (`errorName`), and the next run will retry.

**Emails are not arriving.**
On the health page, look at "Messages": if many are *stuck*, the worker is not sending (see above). If they are *failed for good*, the provider is rejecting them: check the Resend dashboard (is the sending domain verified: SPF/DKIM?), and that `EMAIL_FROM` uses that domain. Sign-in links are sent immediately by the web app, not by the worker, so if sign-in emails fail the problem is the Resend settings, not the worker.

**Text messages are not arriving.**
Check Termii is configured (`pnpm check:config` shows a warning if not), the sender ID is approved, and the message type matches the Do-Not-Disturb setting (`TERMII_CHANNEL`). *This has not been tested against a live account.*

**A person cannot sign in.**
Sign-in links expire after 15 minutes and work once. An address can request 3 links per 15 minutes; a network address 20 per 15 minutes (everyone on a shared connection counts together). A *deactivated* account is told nothing: it shows "check your email" but no link is sent. Check Administration > Staff.

**Reports are all going to triage.**
No agency covers that place. Either boundaries are not loaded (routing then works only on the sample rectangles), or the agency's coverage is missing. Check the agency's page.

**Photos fail to upload.**
Check the Cloudinary settings and that the browser can reach Cloudinary's upload address (the page's security policy only allows that address). *Not yet tested against a live account.*

**Erased accounts' photos still exist at Cloudinary.**
Health page > "Photo deletions". "Waiting" clears by itself once the worker runs. "Failed" means the provider refused: check the Cloudinary credentials and permissions, fix, and ask a developer to reset those rows to pending.

## 8. Privacy requests

- People can **download their data** and **erase their own account** themselves from their account page (ADR 0015). Erasure removes identity and contact details, blanks their description and notes, blurs locations and queues photo deletion; the report stays on record without their details.
- **Gap, not yet built:** if a person cannot sign in (they lost access to their email), there is no administrator tool to export or erase on their behalf. Until one exists, this needs a developer working directly on the database. Add this to the launch decisions.
- Staff accounts are deactivated, not erased, because the audit log refers to them.

## 9. Backups and restore

*Nothing here has been exercised yet; do a restore drill before launch.*

- Back up the whole database, including the job queue tables, **at least daily**, and keep copies for a **short, stated period** (the privacy notice must say how long): data a person erased still sits in older backups until they expire.
- Practise restoring into a fresh database and starting the app against it. Confirm sign-in, a report page, and the health page.
- **After restoring a backup, re-apply any account erasures that happened after the backup was taken.** The restored database does not know about them. Keep a separate record of erased account ids, taken *before* a restore, so this can be done.
- A restore is also the way to "roll back" a bad migration, because there are no undo migrations.

## 10. Secrets

- `AUTH_SECRET` signs and hashes: rotating it invalidates outstanding sign-in links and phone verification codes and resets the anti-abuse counters. People who are already signed in stay signed in (sessions live in the database). *Confirm this after any rotation.*
- Rotate any key you suspect has leaked (Resend, Termii, Cloudinary, database password) in the provider first, update the setting, then restart the web app and the worker.
- Never put secrets in code, tickets or chat. `pnpm check:config` shows only names.

## 11. Logs

The worker and the sign-in system write one JSON line per event, with personal data automatically removed. **Next.js itself also logs uncaught server errors**, and a database error can include values from the failing row. So: restrict who can read production logs, and keep their retention short.

Useful events: `worker.started`, `worker.stopping`, `worker.failed_to_start`, `worker.queue_error`, `sla_scan.recorded`, `notification_dispatch.finished`, `media_cleanup.finished`, `retention.removed`, `auth.error`.

## 12. Suspected data leak or account compromise

1. Contain: deactivate the affected staff accounts (Administration > Staff), and rotate the relevant secrets (section 10).
2. Preserve: keep the logs and a copy of the database before changing more.
3. Understand: the audit log shows administrative changes; reports and their history show what happened to each.
4. Notify: data-protection law may require telling the regulator and affected people within a short deadline (the Nigeria Data Protection Act sets one; **confirm the exact period and the process with your data-protection adviser before launch**).

## 13. What to monitor

- `GET /api/health`: alert on HTTP 503 (site or database down) and on `"worker":"degraded"`.
- Database disk space and backup success.
- The System health page's "stuck" and "failed" counts, if you can scrape or check it daily at first.
