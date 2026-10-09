import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { createDb } from "../src/db/client";
import { fixedClock, systemClock } from "../src/domain/clock";
import { FakeEmailSender } from "../src/server/adapters/email";
import { FakeSmsSender } from "../src/server/adapters/sms";
import { FakeMediaStorage } from "../src/server/adapters/media";
import { exportMyData } from "../src/server/account/export";
import { runAutoConfirm } from "../src/server/reports/auto-confirm";
import { runDispatch } from "../src/server/notifications/dispatch";
import { getSystemHealth } from "../src/server/operations/health";
import { listStaff, listAgencies } from "../src/server/repositories/admin";
import { listRecentAudit } from "../src/server/repositories/audit";
import { findAgencyPerformance } from "../src/server/repositories/performance";
import { findPublicReportByReference, listPubliclyOverdue } from "../src/server/repositories/public-reports";
import { listReportsForScope, listTriageReports } from "../src/server/repositories/report-workflow";
import { listReportsForReporter } from "../src/server/repositories/reports";
import { findRoutingInput } from "../src/server/repositories/routing";
import { runRetention } from "../src/server/retention/run";
import { runSlaScan } from "../src/server/sla/scan";

/**
 * Volume check: how does CivicFlow behave with a LOT of data?
 *
 *   VOLUME_DATABASE_URL=postgres://user:pass@host:port/civicflow_volume pnpm volume:check [reports]
 *
 * It (1) migrates a scratch database, (2) fills it with about 50,000 invented reports and the
 * records that go with them (history, photos, messages, performance outcomes, abuse counters),
 * and (3) times the real functions the application uses, several times each, printing a table.
 * Anything slow is flagged so it can be investigated with EXPLAIN (see docs/performance.md).
 *
 * SAFETY: it refuses to run unless the database NAME ends in "_volume", because it deletes and
 * rewrites data. Never point it at a real database. All data is invented.
 */

const url = process.env.VOLUME_DATABASE_URL;
const reportCount = Number(process.argv[2] ?? 50_000);
const SLOW_MS = 300;

if (!url) throw new Error("Set VOLUME_DATABASE_URL to a scratch database whose name ends in _volume");
const databaseName = new URL(url.replace(/^postgres(ql)?:/, "http:")).pathname.slice(1);
if (!databaseName.endsWith("_volume")) {
  throw new Error(`Refusing to run: database "${databaseName}" does not end in _volume. This tool rewrites data.`);
}

const pool = new Pool({ connectionString: url });
const { db, pool: appPool } = createDb(url);

/** Runs a SQL statement and prints how long it took, so slow data generation is visible. */
async function step(label: string, sql: string, params: unknown[] = []) {
  const started = Date.now();
  await pool.query(sql, params);
  console.log(`  ${label.padEnd(44)} ${String(Date.now() - started).padStart(6)} ms`);
}

async function generate(n: number) {
  console.log(`Generating ${n.toLocaleString()} reports and related data...`);

  // Start from nothing so runs are comparable. TRUNCATE is allowed on the append-only tables.
  await step("empty tables", `truncate table sla_outcomes, escalations, notifications, assignments, status_events, report_media,
    reports, agency_jurisdictions, agencies, jurisdictions, users, rate_limits, audit_log, job_heartbeats, media_deletions cascade`);

  // One state covering a 2x2 degree box, split into 20 LGAs (5 columns x 4 rows) inside Nigeria.
  await step("jurisdictions (1 state, 20 LGAs)", `
    insert into jurisdictions (id, name, level, geom)
    values ('00000000-0000-0000-0000-00000000aaaa', 'Volume State', 'state',
            ST_Multi(ST_MakeEnvelope(8, 8, 10, 10, 4326)));
    insert into jurisdictions (name, level, parent_id, geom)
    select 'Volume LGA ' || c, 'lga', '00000000-0000-0000-0000-00000000aaaa',
           ST_Multi(ST_MakeEnvelope(8 + (c % 5) * 0.4, 8 + (c / 5) * 0.5, 8 + (c % 5) * 0.4 + 0.4, 8 + (c / 5) * 0.5 + 0.5, 4326))
    from generate_series(0, 19) as c`);

  // 30 agencies: 6 types x 5 groups. Each covers the 4 LGAs of its group; group 0 also covers the whole state.
  await step("agencies (30) and coverage", `
    insert into agencies (name, type)
    select 'Volume ' || t || ' agency ' || g, t::agency_type
    from unnest(array['roads','drainage','water','power','waste','streetlights']) as t, generate_series(0, 4) as g;
    insert into agency_jurisdictions (agency_id, jurisdiction_id, priority)
    select a.id, j.id, 0
    from agencies a
    join jurisdictions j on j.level = 'lga'
      and (substring(j.name from 'LGA (\\d+)')::int / 4) = (substring(a.name from 'agency (\\d+)')::int)`);

  await step("users (5000 residents, 60 staff)", `
    insert into users (email, role)
    select 'resident' || i || '@volume.example', 'resident' from generate_series(1, 5000) as i;
    insert into users (email, role, agency_id)
    select 'officer' || i || '@volume.example', 'agency_officer', a.id
    from (select id, row_number() over () as i from agencies) a;
    insert into users (email, role, agency_id)
    select 'admin' || i || '@volume.example', 'agency_admin', a.id
    from (select id, row_number() over () as i from agencies) a;
    insert into users (email, role) values ('platform@volume.example', 'platform_admin')`);

  // The reports. Each report i gets: a cell (LGA), a category, an agency of the right type and group, a status,
  // and timers that satisfy the database rules (routed reports need an agency; running timers need a start time).
  await step(`reports (${n})`, `
    insert into reports (reference, category_id, reporter_id, description, location, status, idempotency_key,
                         agency_id, jurisdiction_id, created_at, routed_at, sla_cycle, sla_started_at,
                         ack_due_at, resolve_due_at, resolved_at)
    select
      'CF-' || upper(substr(md5(i::text), 1, 8)),
      cat.id,
      (select id from users where role = 'resident' order by id offset (i * 7919) % 5000 limit 1),
      'Invented description number ' || i || ' for the volume check',
      ST_SetSRID(ST_MakePoint(8 + ((i % 20) % 5) * 0.4 + random() * 0.4, 8 + ((i % 20) / 5) * 0.5 + random() * 0.5), 4326)::geography,
      st.status::report_status,
      gen_random_uuid(),
      case when st.status = 'submitted' then null else ag.id end,
      lga.id,
      now() - (i % 180) * interval '1 day' - (i % 24) * interval '1 hour',
      case when st.status = 'submitted' then null else now() - (i % 180) * interval '1 day' end,
      case when st.status = 'submitted' then 0 else 1 end,
      case when st.status in ('routed','acknowledged','in_progress','disputed') then now() - (i % 180) * interval '1 day' end,
      case when st.status = 'routed' then now() - (i % 10 - 3) * interval '1 day' end,
      case when st.status in ('routed','acknowledged','in_progress','disputed') then now() - (i % 12 - 4) * interval '1 day' end,
      case when st.status = 'resolved' then now() - (i % 30) * interval '1 day' end
    from generate_series(1, ${n}) as i
    join lateral (select (array['roads','drainage','water','power','waste','streetlights'])[1 + i % 6] as slug) s on true
    join categories cat on cat.slug = s.slug
    join lateral (select (array['submitted','routed','routed','acknowledged','in_progress','in_progress','resolved','confirmed','confirmed','confirmed','confirmed','disputed','rejected'])[1 + i % 13] as status) st on true
    join jurisdictions lga on lga.name = 'Volume LGA ' || (i % 20)
    join lateral (
      select a.id from agencies a
      where a.type = cat.default_agency_type and substring(a.name from 'agency (\\d+)')::int = (i % 20) / 4
    ) ag on true`);

  await step("status events (about 4 per report)", `
    insert into status_events (report_id, from_status, to_status, created_at)
    select r.id, null, 'submitted', r.created_at from reports r;
    insert into status_events (report_id, from_status, to_status, created_at)
    select r.id, 'submitted', 'routed', r.created_at + interval '1 second' from reports r where r.status <> 'submitted';
    insert into status_events (report_id, from_status, to_status, created_at)
    select r.id, 'routed', 'acknowledged', r.created_at + interval '2 hours' from reports r
    where r.status in ('acknowledged','in_progress','resolved','confirmed','disputed');
    insert into status_events (report_id, from_status, to_status, created_at)
    select r.id, 'acknowledged', 'in_progress', r.created_at + interval '1 day' from reports r
    where r.status in ('in_progress','resolved','confirmed','disputed')`);

  await step("photos (2 per report)", `
    insert into report_media (report_id, public_id, format, width, height, bytes, position)
    select r.id, 'volume/' || r.id || '/' || p, 'jpg', 800, 600, 100000, p from reports r, generate_series(0, 1) as p`);

  await step("performance outcomes", `
    insert into sla_outcomes (report_id, agency_id, timer, sla_cycle, started_at, due_at, stopped_at, met)
    select r.id, r.agency_id, 'acknowledge', 1, r.created_at, r.created_at + interval '24 hours',
           r.created_at + interval '2 hours' + (abs(hashtext(r.id::text)) % 40) * interval '1 hour', (abs(hashtext(r.id::text)) % 10) < 8
    from reports r where r.status in ('acknowledged','in_progress','resolved','confirmed','disputed');
    insert into sla_outcomes (report_id, agency_id, timer, sla_cycle, started_at, due_at, stopped_at, met)
    select r.id, r.agency_id, 'resolve', 1, r.created_at, r.created_at + interval '14 days',
           r.created_at + interval '3 days', true
    from reports r where r.status in ('resolved','confirmed')`);

  await step("messages (2 per report, a few pending)", `
    insert into notifications (report_id, event, channel, recipient_user_id, sla_cycle, status, created_at, sent_at, next_attempt_at)
    select r.id, 'report_received', 'email', r.reporter_id, 0,
           case when (abs(hashtext(r.id::text)) % 400) = 0 then 'pending' else 'sent' end::notification_status,
           r.created_at, r.created_at, r.created_at from reports r;
    insert into notifications (report_id, event, channel, recipient_user_id, sla_cycle, status, created_at, sent_at, next_attempt_at)
    select r.id, 'report_routed', 'email', r.reporter_id, 1, 'sent', r.created_at, r.created_at, r.created_at
    from reports r where r.status <> 'submitted'`);

  await step("old abuse counters (50000)", `
    insert into rate_limits (key, window_start, count)
    select 'volume-' || i, now() - interval '30 days' - (i % 100) * interval '1 hour', 1 from generate_series(1, 50000) as i`);

  await step("audit log and statistics", `
    insert into audit_log (actor_id, actor_role, action, target_type, summary)
    select (select id from users where role = 'platform_admin'), 'platform_admin', 'agency.updated', 'agency', 'volume entry ' || i
    from generate_series(1, 300) as i;
    analyze`);
}

interface Timing {
  name: string;
  runs: number[];
}

/** Runs `work` several times and records how long each took, in milliseconds. */
async function time(name: string, work: () => Promise<unknown>, runs = 5): Promise<Timing> {
  const results: number[] = [];
  for (let i = 0; i < runs; i++) {
    const started = process.hrtime.bigint();
    await work();
    results.push(Number(process.hrtime.bigint() - started) / 1e6);
  }
  return { name, runs: results };
}

async function measure() {
  console.log("\nTiming the real application functions (5 runs each; first run is cold)...");
  const one = async <T>(text: string, params: unknown[] = []) => (await pool.query(text, params)).rows[0] as T;

  const busyAgency = (await one<{ id: string }>(`select agency_id as id from reports group by agency_id order by count(*) desc limit 1`)).id;
  const heavyUser = (await one<{ id: string }>(`select reporter_id as id from reports group by reporter_id order by count(*) desc limit 1`)).id;
  const sampleReport = await one<{ id: string; reference: string }>(`select id, reference from reports where agency_id is not null limit 1 offset 1000`);
  const clock = fixedClock(new Date());

  const timings: Timing[] = [
    await time("staff inbox (one agency, 100 newest)", () => listReportsForScope(db, { kind: "agency", agencyId: busyAgency }, { limit: 100 })),
    await time("staff inbox (platform admin, all)", () => listReportsForScope(db, { kind: "all" }, { limit: 100 })),
    await time("triage queue", () => listTriageReports(db)),
    await time("my reports (resident)", () => listReportsForReporter(db, heavyUser)),
    await time("public tracking by reference", () => findPublicReportByReference(db, sampleReport.reference)),
    await time("public overdue board", () => listPubliclyOverdue(db)),
    await time("performance, all agencies, 30 days", () => findAgencyPerformance(db, { kind: "all" }, 30, clock)),
    await time("performance, all agencies, 90 days", () => findAgencyPerformance(db, { kind: "all" }, 90, clock)),
    await time("performance, one agency, 30 days", () => findAgencyPerformance(db, { kind: "agency", agencyId: busyAgency }, 30, clock)),
    await time("routing lookup for one report", () => findRoutingInput(db, sampleReport.id)),
    await time("system health", () => getSystemHealth(db, clock)),
    await time("staff list (platform admin)", () => listStaff(db, { kind: "all" })),
    await time("agency list", () => listAgencies(db)),
    await time("audit log (100 newest)", () => listRecentAudit(db, 100)),
    await time("data export (busiest resident)", () =>
      exportMyData({ db, clock, media: new FakeMediaStorage(), limiter: { consume: async () => ({ allowed: true, remaining: 99 }) }, secret: "s".repeat(32) }, { userId: heavyUser, role: "resident", agencyId: null }),
    ),
    await time("notification dispatch (one batch of 50)", () =>
      runDispatch({ db, clock, email: new FakeEmailSender(), sms: new FakeSmsSender(), baseUrl: "https://civicflow.example", batchSize: 50 }), 3),
  ];

  // Jobs that change data: time the FIRST run (the heavy one) and then a second, nothing-to-do run.
  const first = (name: string, work: () => Promise<unknown>) => time(name, work, 1);
  timings.push(await first("SLA scan, first run (records escalations)", () => runSlaScan(db, systemClock)));
  timings.push(await first("SLA scan, second run (nothing new)", () => runSlaScan(db, systemClock)));
  timings.push(await first("auto-confirm, first run", () => runAutoConfirm({ db, clock: systemClock })));
  timings.push(await first("retention, first run (50,000 old rows)", () => runRetention(db, systemClock)));
  timings.push(await first("retention, second run (nothing to delete)", () => runRetention(db, systemClock)));

  console.log(`\n${"query".padEnd(48)} ${"min".padStart(8)} ${"median".padStart(8)} ${"max".padStart(8)}  (ms)`);
  let slow = 0;
  for (const t of timings) {
    const sorted = [...t.runs].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    const flag = median > SLOW_MS ? "  <-- SLOW" : "";
    if (flag) slow += 1;
    console.log(`${t.name.padEnd(48)} ${sorted[0]?.toFixed(1).padStart(8)} ${median.toFixed(1).padStart(8)} ${sorted.at(-1)?.toFixed(1).padStart(8)}${flag}`);
  }
  console.log(`\n${slow === 0 ? "Nothing slower than" : `${slow} item(s) slower than`} ${SLOW_MS} ms (median).`);
}

async function main() {
  console.log(`Volume database: ${databaseName}`);
  await migrate(db, { migrationsFolder: "drizzle" });
  await generate(reportCount);
  await measure();
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Volume check failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
    await appPool.end();
  });
