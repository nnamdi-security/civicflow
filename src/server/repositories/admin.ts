/**
 * Read-only database queries used by the platform-admin screens (ADR 0014).
 *
 * These only READ. Changes go through the use cases in src/server/admin/, which check permission
 * and write the audit log. The pages call `requirePlatformAdminPage` before using anything here,
 * because these functions assume the caller has already been checked.
 */
import { asc, count, eq, ne } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "../../db/client";
import { agencies, agencyJurisdictions, categories, jurisdictions, slaPolicies, users } from "../../db/schema";
import type { AgencyScope } from "../../domain/permissions";
import type { Role } from "../../domain/roles";
import type { AgencyType } from "../../domain/agency-types";

export interface AgencyListItem {
  id: string;
  name: string;
  type: AgencyType;
  /** How many areas the agency covers. */
  coverageCount: number;
}

/** Every agency with the number of areas it covers, ordered by name. */
export async function listAgencies(db: Db): Promise<AgencyListItem[]> {
  const rows = await db
    .select({
      id: agencies.id,
      name: agencies.name,
      type: agencies.type,
      coverageCount: count(agencyJurisdictions.jurisdictionId),
    })
    .from(agencies)
    // LEFT JOIN keeps agencies that cover nothing yet (they would vanish with a plain join).
    .leftJoin(agencyJurisdictions, eq(agencyJurisdictions.agencyId, agencies.id))
    .groupBy(agencies.id)
    .orderBy(asc(agencies.name));
  return rows.map((row) => ({ ...row, coverageCount: Number(row.coverageCount) }));
}

export interface CoverageRow {
  jurisdictionId: string;
  jurisdictionName: string;
  level: string;
  priority: number;
}

export interface AgencyDetail {
  id: string;
  name: string;
  type: AgencyType;
  coverage: CoverageRow[];
}

/** One agency and the areas it covers, or null if there is no such agency. */
export async function findAgencyDetail(db: Db, agencyId: string): Promise<AgencyDetail | null> {
  const [agency] = await db
    .select({ id: agencies.id, name: agencies.name, type: agencies.type })
    .from(agencies)
    .where(eq(agencies.id, agencyId))
    .limit(1);
  if (!agency) return null;

  const coverage = await db
    .select({
      jurisdictionId: jurisdictions.id,
      jurisdictionName: jurisdictions.name,
      level: jurisdictions.level,
      priority: agencyJurisdictions.priority,
    })
    .from(agencyJurisdictions)
    .innerJoin(jurisdictions, eq(jurisdictions.id, agencyJurisdictions.jurisdictionId))
    .where(eq(agencyJurisdictions.agencyId, agencyId))
    .orderBy(asc(jurisdictions.name));
  return { ...agency, coverage };
}

export interface JurisdictionOption {
  id: string;
  /** For example "Ikeja (LGA) in Lagos", so two areas with the same name can be told apart. */
  label: string;
}

/** Every area an agency could be given, labelled with its level and parent. */
export async function listJurisdictionOptions(db: Db): Promise<JurisdictionOption[]> {
  // `alias` lets us join the jurisdictions table to itself to find each area's parent.
  const parent = alias(jurisdictions, "parent");
  const rows = await db
    .select({ id: jurisdictions.id, name: jurisdictions.name, level: jurisdictions.level, parentName: parent.name })
    .from(jurisdictions)
    .leftJoin(parent, eq(parent.id, jurisdictions.parentId))
    .orderBy(asc(jurisdictions.name));
  return rows.map((row) => ({
    id: row.id,
    label: `${row.name} (${row.level === "lga" ? "LGA" : "state"})${row.parentName ? ` in ${row.parentName}` : ""}`,
  }));
}

export interface SlaPolicyRow {
  categoryId: string;
  categoryName: string;
  ackMinutes: number;
  resolveMinutes: number;
  updatedAt: Date;
}

/** The SLA policy of every category, in the order categories are shown to residents. */
export async function listSlaPolicies(db: Db): Promise<SlaPolicyRow[]> {
  return db
    .select({
      categoryId: categories.id,
      categoryName: categories.name,
      ackMinutes: slaPolicies.ackMinutes,
      resolveMinutes: slaPolicies.resolveMinutes,
      updatedAt: slaPolicies.updatedAt,
    })
    .from(slaPolicies)
    .innerJoin(categories, eq(categories.id, slaPolicies.categoryId))
    .orderBy(asc(categories.sortOrder));
}

export interface CategoryRow {
  id: string;
  name: string;
  active: boolean;
}

/** Every category, including switched-off ones. */
export async function listCategories(db: Db): Promise<CategoryRow[]> {
  return db
    .select({ id: categories.id, name: categories.name, active: categories.active })
    .from(categories)
    .orderBy(asc(categories.sortOrder));
}

export interface StaffRow {
  id: string;
  email: string;
  role: Role;
  agencyId: string | null;
  agencyName: string | null;
  /** True when the account has been deactivated. */
  deactivated: boolean;
}

/**
 * The staff the caller is allowed to see, scoped INSIDE the query:
 *  - scope "all"    (platform admin): every staff account, i.e. everyone who is not a resident;
 *  - scope "agency" (agency admin):   only the people in that one agency;
 *  - scope "none":                    nobody.
 * Emails are shown because this is an internal directory for the people who manage these accounts.
 */
export async function listStaff(db: Db, scope: AgencyScope): Promise<StaffRow[]> {
  if (scope.kind === "none") return [];
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
      agencyId: users.agencyId,
      agencyName: agencies.name,
      disabledAt: users.disabledAt,
    })
    .from(users)
    .leftJoin(agencies, eq(agencies.id, users.agencyId))
    .where(
      scope.kind === "agency"
        ? eq(users.agencyId, scope.agencyId)
        : // Platform admin view: staff only. Residents are excluded.
          ne(users.role, "resident"),
    )
    .orderBy(asc(agencies.name), asc(users.role), asc(users.email));
  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    role: row.role,
    agencyId: row.agencyId,
    agencyName: row.agencyName,
    deactivated: row.disabledAt !== null,
  }));
}
