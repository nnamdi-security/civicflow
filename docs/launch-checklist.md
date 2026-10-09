# Launch checklist

Everything that must be true, decided or verified before real residents use CivicFlow. Nothing here is hidden: if the software could not check something itself (because it needs a real account, a real server, or a person's judgement), it is listed. Tick items off in this file as they are done; status lives here, like `roadmap.md`.

The software is feature-complete for the first launch. What remains is mostly **decisions, accounts and real-world checks**, not code.

**Recommendation: start with a pilot** (one agency, one local government area) rather than a full launch, so problems show up while they are small. See the pilot plan at the end.

## 1. Decisions only you can make

- [ ] **Real SLA targets** per category (how long to acknowledge and to resolve). The values in use are placeholders (ADR 0010). Change them in Administration > SLA deadlines.
- [ ] **Escalation ladder** (who is told when, and after how long). Currently: agency admin at the deadline, platform admin after 24 hours, public after 72 hours. Changing it is a code change under the `sla-change-review` checklist.
- [ ] **Auto-confirm period.** Currently 14 days (ADR 0013). Provisional.
- [ ] **Public overdue board: go or no-go.** It names agencies publicly. Leave `PUBLIC_OVERDUE_BOARD` off until the SLA targets are real and the agencies have agreed to them.
- [ ] **Hosting** (ADR 0016 lists options). This also decides how the client network address reaches the app, which the rate limits depend on (see section 3).
- [ ] **Real boundary data source** and its licence (GRID3, OCHA or another). The importer exists; the data does not.
- [ ] **Data retention periods** (ADR 0015) confirmed by a data-protection adviser, including how long backups are kept.
- [ ] **Privacy notice and terms of use**: replace every `[PLACEHOLDER]` and the draft banner, after legal review. Both pages say plainly that they are drafts until then.
- [ ] **Who runs the service**: the organisation's legal name, address and a privacy contact (needed in the privacy notice).
- [ ] **Emergency-number wording** in the terms.
- [ ] **How administrators help people who cannot sign in** with privacy requests (see "known gaps").
- [ ] **Pilot scope** (which agency, which area, who is the contact there).

## 2. Accounts and services to set up

- [ ] **Domain name** and an HTTPS certificate.
- [ ] **Resend**: verify the sending domain (SPF, DKIM, and preferably DMARC); decide the `EMAIL_FROM` address. Until done, real email is untested.
- [ ] **Termii** (if using texts): account, an **approved sender ID** (this can take time), and the correct route for Nigeria's Do-Not-Disturb numbers (`TERMII_CHANNEL`). Until done, SMS is untested. The system works without it (email only).
- [ ] **Cloudinary**: account and the three settings. See section 3 for what to verify.
- [ ] **Map tiles**: the free OpenStreetMap tile server has a usage policy that does not allow heavy traffic. Plan a tile provider before more than pilot traffic.
- [ ] **Database**: managed PostgreSQL with PostGIS, backups, and (ideally) point-in-time recovery.
- [ ] **Monitoring** on `/api/health` (alert on 503 and on `"worker":"degraded"`).

## 3. Checks that need the real services (not testable on a laptop)

Do these on a staging copy first.

- [ ] `pnpm check:config` shows no FAIL.
- [ ] A fresh database migrates cleanly (`pnpm db:migrate`), and the first platform admin can sign in.
- [ ] **Worker**: runs, and System health shows every job "Running normally".
- [ ] **A full real journey**: sign up, file a report with a real phone photo, see it routed; the officer acknowledges and resolves; the resident confirms; every email arrives (check the spam folder too) and, if enabled, the text arrives.
- [ ] **Cloudinary**: a photo uploaded from a phone has its location metadata removed (open the stored original and inspect it); **a deleted photo stops being served** after erasure (including from cached copies). Neither has been tested against a live account.
- [ ] **Strict security policy in production mode**: browse every main page in a real production build with the browser developer tools open and confirm no "Content Security Policy" errors (the automated tests run in development mode). Confirm the `Strict-Transport-Security` header is present.
- [ ] **Rate limits see real client addresses**: behind the hosting platform's proxy, confirm different visitors have different addresses (otherwise everyone shares one sign-in limit). ADR 0006.
- [ ] **Backups**: take one, restore it into a fresh database, and open the app against it (runbook section 9).
- [ ] **Account erasure end to end** with real Cloudinary: erase a test account, wait for the worker, confirm the photos are gone.
- [ ] **Slow connection**: try the report flow on a throttled mobile connection.

## 4. Accessibility by a person

The automated check passes on every page, but it finds only part of the problems.

- [ ] Use the whole report flow with **keyboard only** (no mouse).
- [ ] Use it with a **screen reader** (TalkBack on Android, VoiceOver on iPhone, or NVDA on Windows).
- [ ] Zoom the text to **200%** and check nothing is cut off.
- [ ] Try the map's alternatives: typed coordinates and "use my location".

## 5. Data setup

- [ ] Real **state and LGA boundaries imported** (dry run first), then spot-check routing with several known addresses, including one near a border.
- [ ] **Agencies** created with the correct type, and **coverage** with sensible priorities.
- [ ] **Agency admins and officers** invited, and each signs in successfully.
- [ ] **SLA values** set per category (decision above).
- [ ] Only the categories you want are switched on.

## 6. Security

- [ ] The security review (run at the end of Part B) has no unresolved findings.
- [ ] `pnpm audit --prod` is clean (it runs in CI).
- [ ] Secrets are only in the hosting platform's secret store, nowhere in code or chat.
- [ ] Production log access is restricted and retention is short (runbook section 11).
- [ ] You know the process and deadline for reporting a data breach (runbook section 12), confirmed with your adviser.

## 7. Known gaps (not built)

Be explicit with the pilot partners about these.

- No **administrator tool to export or erase** a person's data on their behalf (a resident must do it themselves while signed in).
- No **"reply STOP"** handling for texts; the opt-out is in the account page only.
- No **"new report assigned"** emails to staff; agency staff must check their inbox page. (Escalation and dispute emails exist.)
- No **duplicate-report detection**; the same pothole can be reported many times.
- No **moderation of photos**; they are visible to the handling agency but never public.
- English only.
- Stuck upload cleanup: photos uploaded but never attached to a report are not cleaned up yet (ADR 0008).
- Photo and notification retention follow ADR 0015's provisional periods.

## 8. Pilot plan (recommended)

1. One agency and one LGA. A named contact at the agency who will actually acknowledge reports.
2. Agree in writing the real SLA targets with that agency before turning anything public on.
3. Keep the public overdue board **off** during the pilot.
4. Check the System health page and the agency performance page every day for the first two weeks.
5. Define what success looks like in advance (for example: reports routed correctly, acknowledgement within the target, residents confirming fixes) and what would make you pause.
6. Pausing is easy: switch off the report categories in Administration > Report categories; existing reports keep working.

## 8b. Housekeeping before launch

- [ ] `CLAUDE.md` still describes the project as finishing Phase 3 and lacks the newer commands (`pnpm worker`, `pnpm check:config`, `pnpm boundaries:import`, `pnpm dev:last-sms`). It is your file, so it has not been changed: update it.
- [ ] Review `docs/standup-log.md` and `docs/roadmap.md` for accuracy.
