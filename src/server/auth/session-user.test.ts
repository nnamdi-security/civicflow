import { describe, expect, it } from "vitest";
import { normalizeEmail } from "./config";
import { actorFromSession, toSessionUser } from "./session-user";

describe("toSessionUser", () => {
  it("maps a user row and defaults a missing agency to null", () => {
    expect(toSessionUser({ id: "u1", role: "resident", extra: "ignored" })).toEqual({
      id: "u1",
      role: "resident",
      agencyId: null,
    });
  });

  it("keeps the agency for staff", () => {
    expect(toSessionUser({ id: "u1", role: "agency_officer", agencyId: "a1" }).agencyId).toBe("a1");
  });

  it("fails closed on an unknown role", () => {
    expect(() => toSessionUser({ id: "u1", role: "superuser" })).toThrow();
  });

  it("fails closed on a missing id", () => {
    expect(() => toSessionUser({ role: "resident" })).toThrow();
  });
});

describe("actorFromSession", () => {
  it("returns null when nobody is signed in", () => {
    expect(actorFromSession(null)).toBeNull();
    expect(actorFromSession({})).toBeNull();
  });

  it("builds the actor from the session user", () => {
    expect(
      actorFromSession({ user: { id: "u1", role: "agency_admin", agencyId: "a1" } }),
    ).toEqual({ userId: "u1", role: "agency_admin", agencyId: "a1" });
  });
});

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  User@Example.COM ")).toBe("user@example.com");
  });

  it("rejects invalid addresses", () => {
    expect(() => normalizeEmail("not-an-email")).toThrow();
    expect(() => normalizeEmail("a@b.co, c@d.co")).toThrow();
  });
});
