import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { REPORT_STATUSES } from "../../domain/reports/status";
import { SLA_TIMERS } from "../../domain/sla";
import { agencies, agencyTypeEnum, jurisdictions } from "./agencies";
import { users } from "./auth";
import { geographyPoint } from "./postgis";

export const reportStatusEnum = pgEnum("report_status", REPORT_STATUSES);
export const slaTimerEnum = pgEnum("sla_timer", SLA_TIMERS);

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const categories = pgTable("categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  defaultAgencyType: agencyTypeEnum("default_agency_type").notNull(),
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
});

/** Acknowledge and resolve durations per category. PROVISIONAL placeholder values (ADR 0010). */
export const slaPolicies = pgTable(
  "sla_policies",
  {
    categoryId: uuid("category_id")
      .primaryKey()
      .references(() => categories.id),
    ackMinutes: integer("ack_minutes").notNull(),
    resolveMinutes: integer("resolve_minutes").notNull(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (table) => [
    check("sla_policies_ack_positive", sql`${table.ackMinutes} > 0`),
    check("sla_policies_resolve_positive", sql`${table.resolveMinutes} > 0`),
  ],
);

export const reports = pgTable(
  "reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Short human-friendly code shown to the reporter, e.g. CF-7K3M9QXD. */
    reference: text("reference").notNull().unique(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id),
    reporterId: uuid("reporter_id")
      .notNull()
      .references(() => users.id),
    description: text("description").notNull(),
    location: geographyPoint("location").notNull(),
    status: reportStatusEnum("status").notNull().default("submitted"),
    /** Current agency; null while unrouted (the platform triage queue). History is in `assignments`. */
    agencyId: uuid("agency_id").references(() => agencies.id),
    /** When the report first reached `routed`; Phase 5 SLA timers start here. */
    routedAt: timestamptz("routed_at"),
    /** Finest jurisdiction covering the point, for public area names. Null if none covers it. */
    jurisdictionId: uuid("jurisdiction_id").references(() => jurisdictions.id),
    /** When the report last entered `resolved`; cleared on dispute. Drives auto-confirmation (ADR 0013). */
    resolvedAt: timestamptz("resolved_at"),
    /** Null while the acknowledgement timer is not running. */
    ackDueAt: timestamptz("ack_due_at"),
    /** Null while the resolution timer is not running. */
    resolveDueAt: timestamptz("resolve_due_at"),
    /** Increments whenever timers restart (routing, reassignment, dispute). */
    slaCycle: integer("sla_cycle").notNull().default(0),
    /** Client-generated per form; a resubmit returns the existing report. */
    idempotencyKey: uuid("idempotency_key").notNull(),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("reports_location_gist").using("gist", table.location),
    index("reports_status_idx").on(table.status),
    index("reports_reporter_created_idx").on(table.reporterId, table.createdAt),
    index("reports_category_idx").on(table.categoryId),
    index("reports_agency_status_idx").on(table.agencyId, table.status),
    index("reports_ack_due_idx").on(table.ackDueAt).where(sql`${table.ackDueAt} is not null`),
    index("reports_resolve_due_idx").on(table.resolveDueAt).where(sql`${table.resolveDueAt} is not null`),
    check("reports_sla_cycle_nonnegative", sql`${table.slaCycle} >= 0`),
    index("reports_jurisdiction_idx").on(table.jurisdictionId),
    index("reports_resolved_at_idx").on(table.resolvedAt).where(sql`${table.status} = 'resolved'`),
    check("reports_resolved_has_time", sql`${table.status} <> 'resolved' or ${table.resolvedAt} is not null`),
    unique("reports_reporter_idempotency_unique").on(table.reporterId, table.idempotencyKey),
    check(
      "reports_routed_has_agency",
      sql`${table.status} in ('submitted', 'rejected') or ${table.agencyId} is not null`,
    ),
    check(
      "reports_description_length",
      sql`char_length(${table.description}) between 10 and 1000`,
    ),
  ],
);

export const reportMedia = pgTable(
  "report_media",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reportId: uuid("report_id")
      .notNull()
      .references(() => reports.id, { onDelete: "cascade" }),
    /** Provider asset id. URLs are built server-side so transforms can change freely. */
    publicId: text("public_id").notNull().unique(),
    format: text("format").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    bytes: integer("bytes").notNull(),
    position: smallint("position").notNull(),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (table) => [
    unique("report_media_report_position_unique").on(table.reportId, table.position),
    check("report_media_position_range", sql`${table.position} between 0 and 2`),
  ],
);

/** Append-only: a database trigger rejects UPDATE and DELETE (see the migration). */
export const statusEvents = pgTable(
  "status_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reportId: uuid("report_id")
      .notNull()
      .references(() => reports.id),
    fromStatus: reportStatusEnum("from_status"),
    toStatus: reportStatusEnum("to_status").notNull(),
    /** Null for system actions. */
    actorId: uuid("actor_id").references(() => users.id),
    reason: text("reason"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (table) => [index("status_events_report_created_idx").on(table.reportId, table.createdAt)],
);

/** Append-only history of which agency a report was assigned to; a database trigger rejects UPDATE and DELETE. */
export const assignments = pgTable(
  "assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reportId: uuid("report_id")
      .notNull()
      .references(() => reports.id),
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id),
    /** Null for automatic routing. */
    assignedBy: uuid("assigned_by").references(() => users.id),
    reason: text("reason"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (table) => [index("assignments_report_created_idx").on(table.reportId, table.createdAt)],
);

/** Append-only: one row per report, timer, level and SLA cycle; a trigger rejects UPDATE and DELETE. */
export const escalations = pgTable(
  "escalations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reportId: uuid("report_id")
      .notNull()
      .references(() => reports.id),
    timer: slaTimerEnum("timer").notNull(),
    level: smallint("level").notNull(),
    slaCycle: integer("sla_cycle").notNull(),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (table) => [
    unique("escalations_report_timer_level_cycle_unique").on(table.reportId, table.timer, table.level, table.slaCycle),
    check("escalations_level_range", sql`${table.level} between 1 and 3`),
  ],
);
