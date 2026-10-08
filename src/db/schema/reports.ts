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
import { agencies, agencyTypeEnum } from "./agencies";
import { users } from "./auth";
import { geographyPoint } from "./postgis";

export const reportStatusEnum = pgEnum("report_status", REPORT_STATUSES);

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
