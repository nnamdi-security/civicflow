export const ROLES = ["resident", "agency_officer", "agency_admin", "platform_admin"] as const;

export type Role = (typeof ROLES)[number];

/** Roles that belong to exactly one agency. */
export const AGENCY_ROLES = ["agency_officer", "agency_admin"] as const satisfies readonly Role[];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function isAgencyRole(role: Role): boolean {
  return (AGENCY_ROLES as readonly Role[]).includes(role);
}
