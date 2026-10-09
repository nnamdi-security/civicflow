import { isAgencyRole, type Role } from "./roles";

/** The authenticated user as seen by authorization. Built from the session, never from client input. */
export interface Actor {
  role: Role;
  agencyId: string | null;
}

/** The account being created or changed. */
export interface UserTarget {
  role: Role;
  agencyId: string | null;
}

/** What an actor may see in repository queries. */
export type AgencyScope =
  | { kind: "all" }
  | { kind: "agency"; agencyId: string }
  | { kind: "none" };

/** Agency roles must carry an agency; other roles must not. Mirrors the `users_agency_scope` constraint. */
export function isConsistentTarget(target: UserTarget): boolean {
  return isAgencyRole(target.role) === (target.agencyId !== null);
}

/**
 * Staff provisioning. Residents are never provisioned: they sign up themselves.
 * - platform_admin: any staff role, in any agency (or none, for platform_admin).
 * - agency_admin: agency_officer only, in their own agency.
 */
export function canProvisionUser(actor: Actor, target: UserTarget): boolean {
  if (!isConsistentTarget(target)) return false;
  if (target.role === "resident") return false;
  switch (actor.role) {
    case "platform_admin":
      return true;
    case "agency_admin":
      return (
        actor.agencyId !== null &&
        target.role === "agency_officer" &&
        target.agencyId === actor.agencyId
      );
    case "agency_officer":
    case "resident":
      return false;
  }
}

/** Any signed-in user may submit a report (ADR 0007); the role is recorded, not restricted. */
export function canSubmitReport(actor: Actor): boolean {
  switch (actor.role) {
    case "resident":
    case "agency_officer":
    case "agency_admin":
    case "platform_admin":
      return true;
  }
}

/** Creating agencies, jurisdictions, and coverage: platform admins only. */
export function canManageAgencies(actor: Actor): boolean {
  return actor.role === "platform_admin";
}

/** Reading data that belongs to an agency (its reports, staff, performance). */
export function canViewAgencyData(actor: Actor, agencyId: string): boolean {
  switch (actor.role) {
    case "platform_admin":
      return true;
    case "agency_officer":
    case "agency_admin":
      return actor.agencyId === agencyId;
    case "resident":
      return false;
  }
}

/** Scope to apply inside repository queries over agency-owned data. */
export function agencyScopeFor(actor: Actor): AgencyScope {
  switch (actor.role) {
    case "platform_admin":
      return { kind: "all" };
    case "agency_officer":
    case "agency_admin":
      return actor.agencyId === null ? { kind: "none" } : { kind: "agency", agencyId: actor.agencyId };
    case "resident":
      return { kind: "none" };
  }
}

/** The unrouted-reports queue: platform admins only. */
export function canViewTriageQueue(actor: Actor): boolean {
  return actor.role === "platform_admin";
}

/** Roles that may ever reassign; per-report authority is `validateReassignment`. */
export function canReassignReports(actor: Actor): boolean {
  return actor.role === "platform_admin" || actor.role === "agency_admin";
}

/**
 * Who may open the performance dashboards (ADR 0014).
 *  - platform admins: every agency, side by side;
 *  - agency admins: their own agency only;
 *  - officers and residents: nobody. (Officers have the inbox; the figures are for management.)
 * This answers "may you open the page at all?". WHICH agencies you may see is decided separately
 * by `agencyScopeFor`, which the database queries apply.
 */
export function canViewPerformance(actor: Actor): boolean {
  return actor.role === "platform_admin" || (actor.role === "agency_admin" && actor.agencyId !== null);
}

/**
 * Editing SLA deadlines (ADR 0014). Platform admins only: these numbers decide when agencies are
 * flagged as overdue, so they are not left to the agencies being measured.
 */
export function canManageSlaPolicy(actor: Actor): boolean {
  return actor.role === "platform_admin";
}

/** Switching report categories on or off. Platform admins only. */
export function canManageCategories(actor: Actor): boolean {
  return actor.role === "platform_admin";
}

/** Reading the audit log. Platform admins only. */
export function canViewAuditLog(actor: Actor): boolean {
  return actor.role === "platform_admin";
}

/**
 * Who may open the staff-management screen and invite people (ADR 0014).
 * Platform admins manage anyone; agency admins manage officers in their own agency.
 * (WHICH roles and agencies you may invite is decided by `canProvisionUser`, above.)
 */
export function canManageStaff(actor: Actor): boolean {
  return actor.role === "platform_admin" || (actor.role === "agency_admin" && actor.agencyId !== null);
}

/** The account someone wants to deactivate or reactivate. */
export interface DeactivationTarget {
  userId: string;
  role: Role;
  agencyId: string | null;
}

/**
 * May `actor` deactivate (or reactivate) `target`?
 *  - Nobody can deactivate themselves: it would lock them out mid-click, and the "last admin"
 *    safety rule would be easy to bypass.
 *  - Residents are never deactivated here; this screen is for staff accounts.
 *  - Platform admins may deactivate any staff account.
 *  - Agency admins may deactivate OFFICERS of their own agency only: not other admins, and not
 *    anyone from another agency.
 * `actorUserId` is separate from `actor` because `Actor` only describes role and agency.
 */
export function canDeactivateUser(actor: Actor, actorUserId: string, target: DeactivationTarget): boolean {
  if (actorUserId === target.userId) return false;
  if (target.role === "resident") return false;
  switch (actor.role) {
    case "platform_admin":
      return true;
    case "agency_admin":
      return (
        actor.agencyId !== null && target.role === "agency_officer" && target.agencyId === actor.agencyId
      );
    case "agency_officer":
    case "resident":
      return false;
  }
}

/**
 * Who may erase their own account (ADR 0015): ordinary residents only.
 * Staff accounts are not erased this way, because the audit log and report history refer to
 * them; a staff member who leaves is DEACTIVATED by an admin instead (ADR 0014).
 */
export function canEraseAccount(actor: Actor): boolean {
  return actor.role === "resident";
}
