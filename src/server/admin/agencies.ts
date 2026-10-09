/**
 * Platform-admin actions for AGENCIES and the places they cover (ADR 0014).
 *
 * What an agency is: a government body that handles one kind of problem (roads, water, ...).
 * What "coverage" is: which areas (states or local government areas) an agency is responsible
 * for, each with a "priority" number. When two agencies cover the same place, the one with the
 * LOWER priority number gets the report (see docs/routing.md).
 *
 * Every function here follows the same order, which is the project's standard for any change
 * (.claude/rules/api-and-actions.md):
 *   1. is someone signed in?                         (authenticate)
 *   2. are they allowed to do this at all?           (authorize)
 *   3. is what they sent valid?                      (validate)
 *   4. make the change AND write the audit entry in one transaction (persist)
 * "Transaction" = a group of database changes that either all succeed or are all undone.
 *
 * The functions never throw for ordinary mistakes (a missing name, a duplicate). They RETURN
 * `{ ok: false, reason }` so the page can show a friendly message. They only throw for "not
 * signed in" and "not allowed", which are not user mistakes.
 */
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../../db/client";
import { uniqueViolationConstraint } from "../../db/errors";
import { agencies, agencyJurisdictions, jurisdictions } from "../../db/schema";
import { validateAgencyInput, validatePriority } from "../../domain/admin";
import { canManageAgencies } from "../../domain/permissions";
import { ForbiddenError, UnauthenticatedError } from "../auth/errors";
import type { AuthenticatedActor } from "../auth/session-user";
import { recordAudit } from "../repositories/audit";

export interface AdminDeps {
  db: Db;
}

/** Steps 1 and 2 of the standard order, shared by every function below. */
function requireAgencyManager(actor: AuthenticatedActor | null): AuthenticatedActor {
  if (!actor) throw new UnauthenticatedError();
  if (!canManageAgencies(actor)) throw new ForbiddenError();
  return actor;
}

// ---- Create and edit an agency ------------------------------------------------------------

export type AgencyResult =
  | { ok: true; agencyId: string; changed: boolean }
  | { ok: false; reason: "malformed" | "name_invalid" | "type_invalid" | "name_taken" | "not_found" };

/** Adds a new agency. */
export async function createAgency(
  deps: AdminDeps,
  actorOrNull: AuthenticatedActor | null,
  raw: unknown,
): Promise<AgencyResult> {
  const actor = requireAgencyManager(actorOrNull);

  const parsed = z.object({ name: z.unknown(), type: z.unknown() }).safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "malformed" };
  const checked = validateAgencyInput(parsed.data);
  if (!checked.ok) return { ok: false, reason: checked.issue };

  try {
    const agencyId = await deps.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(agencies)
        .values({ name: checked.value.name, type: checked.value.type })
        .returning({ id: agencies.id });
      if (!row) throw new Error("Agency insert returned no row");
      await recordAudit(tx, {
        actor,
        action: "agency.created",
        targetType: "agency",
        targetId: row.id,
        summary: `created agency "${checked.value.name}" (${checked.value.type})`,
      });
      return row.id;
    });
    return { ok: true, agencyId, changed: true };
  } catch (error) {
    // The database enforces unique names (ignoring case). If two admins race, the loser lands here.
    if (uniqueViolationConstraint(error) === "agencies_name_unique") return { ok: false, reason: "name_taken" };
    throw error;
  }
}

const updateSchema = z.object({ agencyId: z.uuid(), name: z.unknown(), type: z.unknown() });

/** Renames an agency and/or changes its type. Does nothing (and writes no audit entry) if nothing changed. */
export async function updateAgency(
  deps: AdminDeps,
  actorOrNull: AuthenticatedActor | null,
  raw: unknown,
): Promise<AgencyResult> {
  const actor = requireAgencyManager(actorOrNull);

  const parsed = updateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "malformed" };
  const checked = validateAgencyInput(parsed.data);
  if (!checked.ok) return { ok: false, reason: checked.issue };
  const { agencyId } = parsed.data;

  const [before] = await deps.db
    .select({ name: agencies.name, type: agencies.type })
    .from(agencies)
    .where(eq(agencies.id, agencyId))
    .limit(1);
  if (!before) return { ok: false, reason: "not_found" };
  if (before.name === checked.value.name && before.type === checked.value.type) {
    return { ok: true, agencyId, changed: false };
  }

  // Describe exactly what changed, in words, for the audit log.
  const changes: string[] = [];
  if (before.name !== checked.value.name) changes.push(`renamed "${before.name}" to "${checked.value.name}"`);
  if (before.type !== checked.value.type) changes.push(`changed type of "${checked.value.name}" from ${before.type} to ${checked.value.type}`);

  try {
    await deps.db.transaction(async (tx) => {
      await tx.update(agencies).set({ name: checked.value.name, type: checked.value.type }).where(eq(agencies.id, agencyId));
      await recordAudit(tx, {
        actor,
        action: "agency.updated",
        targetType: "agency",
        targetId: agencyId,
        summary: changes.join("; "),
      });
    });
    return { ok: true, agencyId, changed: true };
  } catch (error) {
    if (uniqueViolationConstraint(error) === "agencies_name_unique") return { ok: false, reason: "name_taken" };
    throw error;
  }
}

// ---- Coverage: which areas an agency is responsible for ------------------------------------

export type CoverageResult =
  | { ok: true; changed: boolean }
  | { ok: false; reason: "malformed" | "priority_invalid" | "not_found" | "already_covered" };

const coverageSchema = z.object({ agencyId: z.uuid(), jurisdictionId: z.uuid() });

/** Makes an agency responsible for an area, with a priority (lower number = tried first). */
export async function addCoverage(
  deps: AdminDeps,
  actorOrNull: AuthenticatedActor | null,
  raw: unknown,
): Promise<CoverageResult> {
  const actor = requireAgencyManager(actorOrNull);

  const parsed = coverageSchema.extend({ priority: z.unknown() }).safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "malformed" };
  const priority = validatePriority(parsed.data.priority);
  if (priority === null) return { ok: false, reason: "priority_invalid" };
  const { agencyId, jurisdictionId } = parsed.data;

  // Both the agency and the area must exist; we also fetch their names for the audit sentence.
  const [agency] = await deps.db.select({ name: agencies.name }).from(agencies).where(eq(agencies.id, agencyId)).limit(1);
  const [area] = await deps.db
    .select({ name: jurisdictions.name })
    .from(jurisdictions)
    .where(eq(jurisdictions.id, jurisdictionId))
    .limit(1);
  if (!agency || !area) return { ok: false, reason: "not_found" };

  try {
    await deps.db.transaction(async (tx) => {
      await tx.insert(agencyJurisdictions).values({ agencyId, jurisdictionId, priority });
      await recordAudit(tx, {
        actor,
        action: "coverage.added",
        targetType: "agency",
        targetId: agencyId,
        summary: `"${agency.name}" now covers "${area.name}" with priority ${priority}`,
      });
    });
    return { ok: true, changed: true };
  } catch (error) {
    // The (agency, area) pair is the table's primary key; a duplicate means it is already covered.
    if (uniqueViolationConstraint(error) === "agency_jurisdictions_agency_id_jurisdiction_id_pk") {
      return { ok: false, reason: "already_covered" };
    }
    throw error;
  }
}

/** Stops an agency covering an area. Reports already routed to the agency are not moved. */
export async function removeCoverage(
  deps: AdminDeps,
  actorOrNull: AuthenticatedActor | null,
  raw: unknown,
): Promise<CoverageResult> {
  const actor = requireAgencyManager(actorOrNull);

  const parsed = coverageSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "malformed" };
  const { agencyId, jurisdictionId } = parsed.data;

  const [existing] = await deps.db
    .select({ agencyName: agencies.name, areaName: jurisdictions.name })
    .from(agencyJurisdictions)
    .innerJoin(agencies, eq(agencies.id, agencyJurisdictions.agencyId))
    .innerJoin(jurisdictions, eq(jurisdictions.id, agencyJurisdictions.jurisdictionId))
    .where(and(eq(agencyJurisdictions.agencyId, agencyId), eq(agencyJurisdictions.jurisdictionId, jurisdictionId)))
    .limit(1);
  if (!existing) return { ok: false, reason: "not_found" };

  await deps.db.transaction(async (tx) => {
    await tx
      .delete(agencyJurisdictions)
      .where(and(eq(agencyJurisdictions.agencyId, agencyId), eq(agencyJurisdictions.jurisdictionId, jurisdictionId)));
    await recordAudit(tx, {
      actor,
      action: "coverage.removed",
      targetType: "agency",
      targetId: agencyId,
      summary: `"${existing.agencyName}" no longer covers "${existing.areaName}"`,
    });
  });
  return { ok: true, changed: true };
}

/** Changes the priority number of an existing coverage row. */
export async function setCoveragePriority(
  deps: AdminDeps,
  actorOrNull: AuthenticatedActor | null,
  raw: unknown,
): Promise<CoverageResult> {
  const actor = requireAgencyManager(actorOrNull);

  const parsed = coverageSchema.extend({ priority: z.unknown() }).safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "malformed" };
  const priority = validatePriority(parsed.data.priority);
  if (priority === null) return { ok: false, reason: "priority_invalid" };
  const { agencyId, jurisdictionId } = parsed.data;

  const [existing] = await deps.db
    .select({ agencyName: agencies.name, areaName: jurisdictions.name, priority: agencyJurisdictions.priority })
    .from(agencyJurisdictions)
    .innerJoin(agencies, eq(agencies.id, agencyJurisdictions.agencyId))
    .innerJoin(jurisdictions, eq(jurisdictions.id, agencyJurisdictions.jurisdictionId))
    .where(and(eq(agencyJurisdictions.agencyId, agencyId), eq(agencyJurisdictions.jurisdictionId, jurisdictionId)))
    .limit(1);
  if (!existing) return { ok: false, reason: "not_found" };
  if (existing.priority === priority) return { ok: true, changed: false };

  await deps.db.transaction(async (tx) => {
    await tx
      .update(agencyJurisdictions)
      .set({ priority })
      .where(and(eq(agencyJurisdictions.agencyId, agencyId), eq(agencyJurisdictions.jurisdictionId, jurisdictionId)));
    await recordAudit(tx, {
      actor,
      action: "coverage.priority_changed",
      targetType: "agency",
      targetId: agencyId,
      summary: `"${existing.agencyName}" priority for "${existing.areaName}" changed from ${existing.priority} to ${priority}`,
    });
  });
  return { ok: true, changed: true };
}
