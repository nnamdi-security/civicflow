# Security review (end of Phase 8)

A structured review of the whole application, done by reading the code, searching it mechanically, and probing it with tests. It is **not** an independent penetration test: a launch handling real residents' personal data should still have one done by someone else (see the end).

## Method
1. **Entry points.** Listed every place data can be changed or read from outside: 8 files of server actions and 5 route handlers. Confirmed each state-changing one authenticates first; the only ones that do not are deliberately public (sign-in, sign-out, a lookup form that only redirects).
2. **Mechanical searches.** Raw SQL (`sql.raw` appears only for fixed table names in the retention job), raw HTML rendering (none), `eval` (none), secret-shaped strings in tracked files (none), tracked environment files (only `.env.example`).
3. **Authorization.** Every use case checks who is asking before touching data; agency scope is applied inside the database queries; things a person may not see answer 404 exactly like things that do not exist (tested, including the HTTP status).
4. **Abuse and cost.** Looked for every place that can be called repeatedly, sends a message, or does expensive work, and for how it is limited.
5. **Data exposure.** Public pages and the data download are built from allow-lists with tests that try to sneak private data through; logs are redacted automatically.
6. **Dependencies.** `pnpm audit` (production dependencies): no known vulnerabilities. It also runs in CI.
7. **Browser protections.** Content Security Policy, other security headers, and accessibility, each verified in a real browser by automated tests.

## Findings fixed during this review
| # | Finding | Why it mattered | Fix |
|---|---|---|---|
| 1 | The visitor's network address was read from the **left** of `X-Forwarded-For`, which the visitor writes. | Anyone could send a different fake address on every request and escape every per-address limit (sign-in, public lookup). | Take the entry the trusted proxy wrote (counting `TRUSTED_PROXY_HOPS` places in from the right); ignore anything else; refuse non-address text. Tested against forged headers. |
| 2 | Phone verification was limited per **account**, and accounts are free. | One person could make many accounts and flood a victim's phone with texts, or run up the SMS bill. | A second limit per **phone number** (3 per day across all accounts), keyed by a hash so the number is not stored. Tested. |
| 3 | The public `/api/health` opened a **new database connection pool on every call**, with no limit. | A flood of health checks could exhaust database connections. | It now uses the shared pool. |
| 4 | Dispute and rejection notes, and reassignment reasons, were trimmed but not **sanitized** like other free text. | Invisible or direction-flipping characters could make a staff screen or email display misleading text. | Cleaned the same way as descriptions. Tested. |
| 5 | A deactivated account got a different sign-in response from an unknown one (found by a test while building deactivation). | It would reveal which addresses are deactivated staff. | Fixed earlier in Part A; regression-tested. |
| 6 | A root `loading.tsx` turned "page you may not see" 404s into HTTP 200 (found by tests). | It made hidden pages distinguishable from missing ones. | Removed; documented in `not-found.tsx` so it is not reintroduced. |

## Residual risks and recommendations (decide before launch)
1. **Trusted proxy setting must match the real deployment** (high importance, easy to get wrong). If `TRUSTED_PROXY_HOPS` is too small or the app is reachable directly, forged headers can still bypass the rate limits; if it is too large, visitors share a bucket. `pnpm check:config` warns when it is unset. Verify on staging with two different clients.
2. **Use two database roles.** Migrations need owner rights; the running app and worker do not. The append-only guarantees (history, audit log, outcomes, escalations) are enforced by database triggers, and a role that owns the tables could drop them or `TRUNCATE`. Run the application with a role that cannot alter tables, triggers or truncate, and keep the owner role for deployments only. Currently one connection string is used for everything.
3. **Sign-in by emailed link is the only login.** Whoever controls a person's mailbox controls their account, sessions last 30 days, and erasing an account needs only the typed word (a notification goes to the old address afterwards). Consider requiring a fresh sign-in link, or a short re-confirmation, before erasure and before staff actions with big effects.
4. **No bot protection** on sign-in or account creation (such as a CAPTCHA). Email sending is rate limited per address and per network address, but a determined attacker with many addresses could still create many accounts. Watch the message volumes after launch.
5. **Reference codes act like passwords for the public tracking page.** They have about 6.5 x 10^11 possibilities and lookups are limited to 30 per 10 minutes per address, so guessing is impractical, but anyone given a code can see that report's public summary (by design).
6. **Inline styles are allowed** by the Content Security Policy (scripts are strict). Documented trade-off.
7. **Framework logs.** Next.js logs uncaught server errors itself, and database error text can include row values. Restrict and expire production logs (runbook section 11).
8. **Public endpoints with no login**: the health check, the tracking pages, sign-in. They are cheap and bounded, but a platform-level firewall or rate limit in front of the app is advisable.
9. **Third-party behaviour is untested against live accounts** (Resend, Termii, Cloudinary including photo deletion and metadata stripping). See the launch checklist.
10. **Dev-only code paths** (the local photo store and dev outbox) refuse to run in production; confirm `NODE_ENV=production` in deployment (`pnpm check:config` fails otherwise).

## Not covered by this review
Hosting and network configuration, the third-party services themselves, operating-system and database hardening, physical and organisational security (who has access to production), and any testing by an independent party. **Recommendation:** commission an independent penetration test and a data-protection impact assessment before opening to the general public, even if the pilot goes ahead first.
