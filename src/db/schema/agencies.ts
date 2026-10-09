import { index, integer, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { AGENCY_TYPES, JURISDICTION_LEVELS } from "../../domain/agency-types";
import { multiPolygon } from "./postgis";

export const agencyTypeEnum = pgEnum("agency_type", AGENCY_TYPES);
export const jurisdictionLevelEnum = pgEnum("jurisdiction_level", JURISDICTION_LEVELS);

export const agencies = pgTable(
  "agencies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    type: agencyTypeEnum("type").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    // No two agencies may share a name, ignoring upper/lower case ("Lagos Roads" = "lagos roads").
    // This also protects against two admins creating the same agency at the same moment.
    uniqueIndex("agencies_name_unique").on(sql`lower(${table.name})`),
  ],
);

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
    // A place is identified by its level, its name (ignoring capital letters) and its parent.
    // This lets the boundary importer run again safely: a second run finds the same place and
    // updates its shape instead of creating a duplicate. `coalesce` turns "no parent" (null) into
    // a fixed value, because the database treats two nulls as different and would otherwise let
    // two states with the same name through.
    uniqueIndex("jurisdictions_identity_unique").on(
      table.level,
      sql`lower(${table.name})`,
      sql`coalesce(${table.parentId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
    ),
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
