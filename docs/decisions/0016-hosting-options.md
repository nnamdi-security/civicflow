# 0016: Hosting

Status: **Proposed** (needs a decision from the project owner; nothing here is settled)

## The decision to make
Where to run CivicFlow in production. This blocks the deployment, how rate limiting sees visitors' network addresses (ADR 0006), the worker's home, and what the privacy notice says about where data is stored.

**Caution on the facts below.** The descriptions of providers come from general background knowledge, not from checking their current websites, prices, regions or terms. Treat every provider-specific statement as something to verify before relying on it.

## What CivicFlow needs from a host
1. **PostgreSQL with the PostGIS extension**, managed if possible (automatic backups, ideally point-in-time recovery). Without PostGIS nothing routes.
2. **A long-running process for the worker** (ADR 0002), not only request-by-request serverless functions. The worker is a separate always-on program.
3. **Node.js 22 or newer** for the web app, with HTTPS and a custom domain.
4. **Client address forwarding**: the platform must pass the real visitor address to the app (`x-forwarded-for` or `x-real-ip`) or all visitors share one sign-in rate limit.
5. **Latency for users in Nigeria**, which is bounded by the nearest region.
6. **Data location**: the Nigeria Data Protection Act restricts transfers of personal data abroad. Ask the data-protection adviser whether storing data outside Nigeria is acceptable, and under what safeguards.
7. **Cost, and how much operating work the team can take on** (patching, backups, monitoring).
8. **Secret storage**, deploy-from-CI, and a way to run one-off commands (`pnpm db:migrate`, `pnpm admin:create`, `pnpm check:config`).

## Options
**A. A managed application platform (examples to evaluate: Render, Railway, Fly.io).** Deploy the web app and the worker as two services, plus a managed Postgres.
- For: least operating work; deploys from git; built-in TLS and secrets; quick to start a pilot.
- Against / to verify: whether managed Postgres on that platform includes PostGIS; which regions are available (probably none in Nigeria); price at pilot and at scale; whether the platform passes the visitor address; backup and recovery features.

**B. A major cloud in the nearest African region (examples to evaluate: AWS in Cape Town, Azure in South Africa).** Managed Postgres with PostGIS, containers or a small VM for the app and worker.
- For: mature managed database with backups and recovery; data stays in Africa; scales; many compliance tools.
- Against / to verify: more setup and operating effort; typically higher cost for a small pilot; still outside Nigeria.

**C. One virtual server you manage (examples: Hetzner, DigitalOcean, a local VPS) running the database and both processes.** Docker Compose style.
- For: cheapest; simplest to understand; full control.
- Against: you own backups, security patches, monitoring and recovery; a single machine is a single point of failure; many such providers have no region in Africa.

**D. Nigerian data-centre or hosting provider.** 
- For: data stays in Nigeria; may simplify the data-transfer question.
- Against / to verify: whether a managed PostgreSQL with PostGIS is offered at all, reliability and support, and who manages backups.

## Suggested path (not a decision)
Run the **pilot on option A** to learn quickly, as long as it offers PostGIS and forwards the client address, **after** the data-protection adviser has said where the pilot's data may be stored. Keep the app host-neutral (it is: ordinary Node.js processes configured by environment variables, with a health endpoint at `/api/health`) so moving to B or D later is a redeploy plus a database restore, not a rewrite. If the adviser requires data in Nigeria, evaluate D first.

## Questions for the project owner
1. Is there a budget ceiling, and who will operate the system day to day?
2. Does the data-protection adviser require data to stay in Nigeria?
3. Any existing relationship, discount or mandate (for example a government cloud) that decides this?

## Consequences once decided
Record the choice here (supersede this ADR), then: set up CI deployment, write the platform-specific part of the runbook, set the proxy settings so the rate limits see real addresses, and update the privacy notice's hosting placeholder.
