import { index, integer, pgEnum, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { AGENCY_TYPES, JURISDICTION_LEVELS } from "../../domain/agency-types";
import { multiPolygon } from "./postgis";

export const agencyTypeEnum = pgEnum("agency_type", AGENCY_TYPES);
export const jurisdictionLevelEnum = pgEnum("jurisdiction_level", JURISDICTION_LEVELS);

export const agencies = pgTable("agencies", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  type: agencyTypeEnum("type").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const jurisdictions = pgTable(
  "jurisdictions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    level: jurisdictionLevelEnum("level").notNull(),
    parentId: uuid("parent_id").references((): AnyPgColumn => jurisdictions.id),
    geom: multiPolygon("geom").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    index("jurisdictions_geom_gist").using("gist", table.geom),
    index("jurisdictions_parent_idx").on(table.parentId),
  ],
);

/** Which jurisdictions an agency covers. Lower priority number wins routing ties. */
export const agencyJurisdictions = pgTable(
  "agency_jurisdictions",
  {
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    jurisdictionId: uuid("jurisdiction_id")
      .notNull()
      .references(() => jurisdictions.id, { onDelete: "cascade" }),
    priority: integer("priority").notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.agencyId, table.jurisdictionId] }),
    index("agency_jurisdictions_jurisdiction_idx").on(table.jurisdictionId),
  ],
);
