import { describe, expect, it } from "vitest";
import {
  agencyScopeFor,
  canManageAgencies,
  canDeactivateUser,
  canEraseAccount,
  canManageCategories,
  canManageStaff,
  canManageSlaPolicy,
  canReassignReports,
  canViewAuditLog,
  canViewPerformance,
  canViewTriageQueue,
  canProvisionUser,
  canSubmitReport,
  canViewAgencyData,
  isConsistentTarget,
  type Actor,
  type UserTarget,
} from "./permissions";
import { ROLES, isAgencyRole, type Role } from "./roles";

const A = "agency-a";
const B = "agency-b";

function actor(role: Role, agencyId: string | null = isAgencyRole(role) ? A : null): Actor {
  return { role, agencyId };
}

describe("isConsistentTarget", () => {
  it.each(ROLES)("requires an agency exactly for agency roles (%s)", (role) => {
    expect(isConsistentTarget({ role, agencyId: A })).toBe(isAgencyRole(role));
    expect(isConsistentTarget({ role, agencyId: null })).toBe(!isAgencyRole(role));
  });
});

describe("canProvisionUser", () => {
  const targets: UserTarget[] = [
    { role: "resident", agencyId: null },
    { role: "agency_officer", agencyId: A },
    { role: "agency_officer", agencyId: B },
    { role: "agency_admin", agencyId: A },
    { role: "platform_admin", agencyId: null },
  ];

  it("lets a platform admin provision any staff role in any agency", () => {
    const results = targets.map((t) => canProvisionUser(actor("platform_admin"), t));
    expect(results).toEqual([false, true, true, true, true]);
  });

  it("lets an agency admin provision officers in their own agency only", () => {
    const results = targets.map((t) => canProvisionUser(actor("agency_admin"), t));
    expect(results).toEqual([false, true, false, false, false]);
  });

  it("denies agency officers and residents everything", () => {
    for (const role of ["agency_officer", "resident"] as const) {
      expect(targets.some((t) => canProvisionUser(actor(role), t))).toBe(false);
    }
  });

  it("never provisions a resident, even for a platform admin", () => {
    expect(canProvisionUser(actor("platform_admin"), { role: "resident", agencyId: null })).toBe(
      false,
    );
  });

  it("denies inconsistent targets for everyone", () => {
    const bad: UserTarget[] = [
      { role: "agency_officer", agencyId: null },
      { role: "platform_admin", agencyId: A },
    ];
    for (const role of ROLES) {
      expect(bad.some((t) => canProvisionUser(actor(role), t))).toBe(false);
    }
  });

  it("denies an agency admin who has no agency recorded", () => {
    expect(
      canProvisionUser(actor("agency_admin", null), { role: "agency_officer", agencyId: A }),
    ).toBe(false);
  });
});

describe("canSubmitReport", () => {
  it.each(ROLES)("allows %s", (role) => {
    expect(canSubmitReport(actor(role))).toBe(true);
  });
});

describe("canManageAgencies", () => {
  it.each(ROLES)("%s", (role) => {
    expect(canManageAgencies(actor(role))).toBe(role === "platform_admin");
  });
});

describe("canViewAgencyData", () => {
  it("allows platform admins everywhere", () => {
    expect(canViewAgencyData(actor("platform_admin"), A)).toBe(true);
    expect(canViewAgencyData(actor("platform_admin"), B)).toBe(true);
  });

  it.each(["agency_officer", "agency_admin"] as const)("limits %s to their own agency", (role) => {
    expect(canViewAgencyData(actor(role), A)).toBe(true);
    expect(canViewAgencyData(actor(role), B)).toBe(false);
  });

  it("denies residents", () => {
    expect(canViewAgencyData(actor("resident"), A)).toBe(false);
  });
});

describe("agencyScopeFor", () => {
  it("maps each role to a repository scope", () => {
    expect(agencyScopeFor(actor("platform_admin"))).toEqual({ kind: "all" });
    expect(agencyScopeFor(actor("agency_officer"))).toEqual({ kind: "agency", agencyId: A });
    expect(agencyScopeFor(actor("agency_admin"))).toEqual({ kind: "agency", agencyId: A });
    expect(agencyScopeFor(actor("resident"))).toEqual({ kind: "none" });
  });

  it("fails closed for agency staff without an agency", () => {
    expect(agencyScopeFor(actor("agency_officer", null))).toEqual({ kind: "none" });
  });
});

describe("triage and reassignment roles", () => {
  it("limits the triage queue to platform admins", () => {
    expect(ROLES.filter((r) => canViewTriageQueue(actor(r)))).toEqual(["platform_admin"]);
  });

  it("limits reassignment to platform and agency admins", () => {
    expect(ROLES.filter((r) => canReassignReports(actor(r)))).toEqual(["agency_admin", "platform_admin"]);
  });
});

describe("canViewPerformance", () => {
  it("allows only platform admins and agency admins", () => {
    expect(ROLES.filter((r) => canViewPerformance(actor(r)))).toEqual(["agency_admin", "platform_admin"]);
  });

  it("does not allow an agency admin who somehow has no agency", () => {
    // The database forbids this combination, but the rule should still fail safe if it ever appears.
    expect(canViewPerformance({ role: "agency_admin", agencyId: null })).toBe(false);
  });
});

describe("administration permissions (platform admins only)", () => {
  it.each([
    ["canManageSlaPolicy", canManageSlaPolicy],
    ["canManageCategories", canManageCategories],
    ["canViewAuditLog", canViewAuditLog],
  ])("%s allows only a platform admin", (_name, check) => {
    expect(ROLES.filter((r) => check(actor(r)))).toEqual(["platform_admin"]);
  });
});

describe("canManageStaff", () => {
  it("allows platform admins and agency admins only", () => {
    expect(ROLES.filter((r) => canManageStaff(actor(r)))).toEqual(["agency_admin", "platform_admin"]);
  });
});

describe("canDeactivateUser", () => {
  // `me` is the person pressing the button; the targets are other accounts.
  const me = "user-me";
  const officerOfA = { userId: "u1", role: "agency_officer", agencyId: A } as const;
  const officerOfB = { userId: "u2", role: "agency_officer", agencyId: B } as const;
  const adminOfA = { userId: "u3", role: "agency_admin", agencyId: A } as const;
  const platform = { userId: "u4", role: "platform_admin", agencyId: null } as const;
  const someResident = { userId: "u5", role: "resident", agencyId: null } as const;

  it("lets a platform admin deactivate any staff account", () => {
    for (const target of [officerOfA, officerOfB, adminOfA, platform]) {
      expect(canDeactivateUser(actor("platform_admin"), me, target)).toBe(true);
    }
  });

  it("lets an agency admin deactivate officers of their own agency only", () => {
    const admin = actor("agency_admin"); // an admin of agency A
    expect(canDeactivateUser(admin, me, officerOfA)).toBe(true);
    expect(canDeactivateUser(admin, me, officerOfB)).toBe(false); // another agency
    expect(canDeactivateUser(admin, me, adminOfA)).toBe(false); // another admin, even in their own agency
    expect(canDeactivateUser(admin, me, platform)).toBe(false);
  });

  it("never allows deactivating yourself", () => {
    expect(canDeactivateUser(actor("platform_admin"), "u1", officerOfA)).toBe(false);
    expect(canDeactivateUser(actor("agency_admin"), "u1", officerOfA)).toBe(false);
  });

  it("never applies to residents", () => {
    expect(canDeactivateUser(actor("platform_admin"), me, someResident)).toBe(false);
  });

  it("is not available to officers or residents", () => {
    for (const role of ["agency_officer", "resident"] as const) {
      for (const target of [officerOfA, adminOfA]) expect(canDeactivateUser(actor(role), me, target)).toBe(false);
    }
  });
});

describe("canEraseAccount", () => {
  it("is for residents only; staff are deactivated by an admin instead", () => {
    expect(ROLES.filter((r) => canEraseAccount(actor(r)))).toEqual(["resident"]);
  });
});
