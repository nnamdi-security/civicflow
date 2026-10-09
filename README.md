# CivicFlow

Nigerian civic issue reporting and accountability platform. See `docs/` for product, architecture and decisions.

## Prerequisites
Node 22+, pnpm (via `corepack enable`), Docker.

## Setup
```bash
pnpm install
pnpm db:up          # Postgres + PostGIS on localhost:5433 (creates civicflow and civicflow_test)
cp .env.example .env                 # then set AUTH_SECRET (openssl rand -base64 32)
export DATABASE_URL=postgres://civicflow:civicflow_dev_only@localhost:5433/civicflow
export TEST_DATABASE_URL=postgres://civicflow:civicflow_dev_only@localhost:5433/civicflow_test
pnpm db:migrate
pnpm db:seed        # optional: sample jurisdictions and agency (not real boundaries)
pnpm boundaries:import <file> --level state|lga --name-field <prop> --dry-run   # load real boundaries; see docs/routing.md
pnpm dev            # http://localhost:3000, health check at /api/health
pnpm worker         # separate process: SLA scan and notification dispatch every minute, auto-confirm hourly, photo cleanup every 5 min, retention daily (needs DATABASE_URL and AUTH_SECRET, plus the email/media settings the web app uses)
```

## Signing in locally
Without `RESEND_API_KEY`, sign-in emails are written to `.dev-outbox/` (gitignored) instead of being sent. Request a link at `/sign-in`, then run `pnpm dev:last-email` and open the link. Without Termii settings, SMS (including phone verification codes) goes to `.dev-outbox/sms.jsonl` instead; read the newest with `pnpm dev:last-sms`. Report notification emails and SMS are sent by `pnpm worker`. Create the first platform admin with `pnpm admin:create you@example.com`, then sign in with that address.

## Reporting locally
Reports need a photo. Without Cloudinary credentials, photos go to a dev-only store in `.dev-media/` (gitignored; refuses to run in production), so the whole flow works with no accounts. Sign in, open `/report/new`, drop a pin, add a photo and submit.

## Checks
`pnpm lint && pnpm typecheck && pnpm test && pnpm build`

End-to-end (once, then as needed): `pnpm exec playwright install chromium` and `pnpm test:e2e` with `TEST_DATABASE_URL` set.

The `civicflow_test` database is created only when the Docker volume is first created. If it is missing, run `pnpm db:down` and remove the `civicflow_civicflow-pgdata` volume, then `pnpm db:up`.

Public pages: `/track` finds a report by its code and shows progress only (ADR 0013). The overdue board at `/overdue` is off unless `PUBLIC_OVERDUE_BOARD=true`; leave it off until real SLA values are agreed.

Administration (platform admins): `/admin` links to agencies and coverage, SLA deadlines, report categories, the audit log and staff accounts (`/agency/staff`, also used by agency admins for their own officers). Agency admins and platform admins can open `/agency/performance` for SLA performance figures. See ADR 0014. The first platform admin is created with `pnpm admin:create <email>`.
