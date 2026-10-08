import { describe, expect, it } from "vitest";
import { pickAgency, routingReason, type RoutingCandidate } from "./routing";

function c(agencyId: string, jurisdictionId: string, hops = 0, priority = 0): RoutingCandidate {
  return { agencyId, jurisdictionId, hops, priority };
}

describe("pickAgency", () => {
  it("sends to triage when nothing covers the point", () => {
    expect(pickAgency({ candidates: [], boundary: false })).toEqual({ kind: "triage" });
  });

  it("picks the only candidate", () => {
    expect(pickAgency({ candidates: [c("a1", "j1")], boundary: false })).toEqual({
      kind: "agency",
      agencyId: "a1",
      jurisdictionId: "j1",
      viaParent: false,
      boundary: false,
    });
  });

  it("prefers the more specific jurisdiction over a better priority at the parent", () => {
    const d = pickAgency({ candidates: [c("state", "s1", 1, 0), c("lga", "l1", 0, 9)], boundary: false });
    expect(d).toMatchObject({ agencyId: "lga", viaParent: false });
  });

  it("falls back to the parent when only the parent has an agency", () => {
    expect(pickAgency({ candidates: [c("state", "s1", 1)], boundary: false })).toMatchObject({
      agencyId: "state",
      viaParent: true,
    });
  });

  it("breaks ties by lower priority number", () => {
    const d = pickAgency({ candidates: [c("a", "j1", 0, 5), c("b", "j1", 0, 1)], boundary: false });
    expect(d).toMatchObject({ agencyId: "b" });
  });

  it("breaks remaining ties by jurisdiction id, then agency id", () => {
    expect(pickAgency({ candidates: [c("a", "j2"), c("b", "j1")], boundary: true })).toMatchObject({
      agencyId: "b",
      boundary: true,
    });
    expect(pickAgency({ candidates: [c("z", "j1"), c("m", "j1")], boundary: false })).toMatchObject({
      agencyId: "m",
    });
  });

  it("does not depend on input order", () => {
    const list = [c("a", "j2", 0, 1), c("b", "j1", 0, 1), c("c", "s", 1, 0)];
    const forward = pickAgency({ candidates: list, boundary: false });
    const backward = pickAgency({ candidates: [...list].reverse(), boundary: false });
    expect(forward).toEqual(backward);
  });
});

describe("routingReason", () => {
  it("notes fallback and boundary cases", () => {
    const base = { kind: "agency", agencyId: "a", jurisdictionId: "j" } as const;
    expect(routingReason({ ...base, viaParent: false, boundary: false })).toBe("auto-routed");
    expect(routingReason({ ...base, viaParent: true, boundary: true })).toBe(
      "auto-routed; parent jurisdiction fallback; boundary case",
    );
  });
});
