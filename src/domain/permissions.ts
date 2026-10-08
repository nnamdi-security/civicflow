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
