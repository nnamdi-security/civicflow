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
pnpm dev            # http://localhost:3000, health check at /api/health
```

## Signing in locally
Without `RESEND_API_KEY`, sign-in emails are written to `.dev-outbox/` (gitignored) instead of being sent. Request a link at `/sign-in`, then run `pnpm dev:last-email` and open the link. Create the first platform admin with `pnpm admin:create you@example.com`, then sign in with that address.

## Checks
`pnpm lint && pnpm typecheck && pnpm test && pnpm build`

The `civicflow_test` database is created only when the Docker volume is first created. If it is missing, run `pnpm db:down` and remove the `civicflow_civicflow-pgdata` volume, then `pnpm db:up`.
