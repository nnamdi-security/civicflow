import { describe, expect, it } from "vitest";
import { REPORT_STATUSES, type ReportStatus } from "./status";
import {
  ALL_STATUS_PAIRS,
  MAX_REASON_LENGTH,
  allowedTargets,
  REASSIGNABLE_STATUSES,
  validateReassignment,
  validateTransition,
  type TransitionActor,
} from "./transitions";

const AGENCY = "agency-a";
const OTHER = "agency-b";

const system: TransitionActor = { kind: "system" };
const platformAdmin: TransitionActor = { kind: "user", role: "platform_admin", agencyId: null, isReporter: false };
const officer: TransitionActor = { kind: "user", role: "agency_officer", agencyId: AGENCY, isReporter: false };
const agencyAdmin: TransitionActor = { kind: "user", role: "agency_admin", agencyId: AGENCY, isReporter: false };
const otherOfficer: TransitionActor = { kind: "user", role: "agency_officer", agencyId: OTHER, isReporter: false };
const reporter: TransitionActor = { kind: "user", role: "resident", agencyId: null, isReporter: true };
const stranger: TransitionActor = { kind: "user", role: "resident", agencyId: null, isReporter: false };

const EXPECTED_EDGES: ReadonlyArray<readonly [ReportStatus, ReportStatus]> = [
  ["submitted", "routed"],
  ["routed", "acknowledged"],
  ["acknowledged", "in_progress"],
  ["in_progress", "resolved"],
  ["resolved", "confirmed"],
  ["resolved", "disputed"],
  ["disputed", "in_progress"],
  ["submitted", "rejected"],
  ["routed", "rejected"],
  ["acknowledged", "rejected"],
  ["in_progress", "rejected"],
  ["resolved", "rejected"],
  ["disputed", "rejected"],
];

describe("transition table", () => {
  it("allows exactly the documented edges, across every status pair", () => {
    const allowed = ALL_STATUS_PAIRS.filter(([from, to]) => allowedTargets(from).includes(to));
    expect(allowed).toHaveLength(EXPECTED_EDGES.length);
    for (const edge of EXPECTED_EDGES) expect(allowed).toContainEqual(edge);
  });

  it("has no way out of confirmed or rejected", () => {
    expect(allowedTargets("confirmed")).toEqual([]);
    expect(allowedTargets("rejected")).toEqual([]);
  });

  it.each(ALL_STATUS_PAIRS.filter(([f, t]) => !allowedTargets(f).includes(t)))(
    "denies %s -> %s as not_allowed even for a platform admin",
    (from, to) => {
      const result = validateTransition({ from, to, actor: platformAdmin, reportAgencyId: AGENCY, reason: "x" });
      expect(result).toEqual({ ok: false, denial: "not_allowed" });
    },
  );

  it("covers every status", () => {
    expect(REPORT_STATUSES).toHaveLength(8);
  });
});

describe("who may transition", () => {
  const staffSteps: ReadonlyArray<readonly [ReportStatus, ReportStatus]> = [
    ["routed", "acknowledged"],
    ["acknowledged", "in_progress"],
    ["in_progress", "resolved"],
    ["disputed", "in_progress"],
  ];

  it.each(staffSteps)("%s -> %s: assigned agency staff and platform admin only", (from, to) => {
    const ok = (actor: TransitionActor) =>
      validateTransition({ from, to, actor, reportAgencyId: AGENCY }).ok;
    expect([ok(officer), ok(agencyAdmin), ok(platformAdmin)]).toEqual([true, true, true]);
    expect([ok(otherOfficer), ok(reporter), ok(stranger), ok(system)]).toEqual([false, false, false, false]);
  });

  it("denies agency staff on a report with no agency", () => {
    const result = validateTransition({ from: "routed", to: "acknowledged", actor: officer, reportAgencyId: null });
    expect(result).toEqual({ ok: false, denial: "forbidden" });
  });

  it("routes only by system or platform admin", () => {
    const ok = (actor: TransitionActor) =>
      validateTransition({ from: "submitted", to: "routed", actor, reportAgencyId: null }).ok;
    expect([ok(system), ok(platformAdmin)]).toEqual([true, true]);
    expect([ok(officer), ok(reporter)]).toEqual([false, false]);
  });

  it.each(["confirmed", "disputed"] as const)("lets only the reporter move resolved -> %s", (to) => {
    const ok = (actor: TransitionActor) => validateTransition({ from: "resolved", to, actor, reportAgencyId: AGENCY }).ok;
    expect(ok(reporter)).toBe(true);
    expect([ok(stranger), ok(officer), ok(platformAdmin), ok(system)]).toEqual([false, false, false, false]);
  });
});

describe("rejection", () => {
  const reject = (reason?: string | null, actor: TransitionActor = officer) =>
    validateTransition({ from: "routed", to: "rejected", actor, reportAgencyId: AGENCY, reason });

  it("requires a non-blank reason", () => {
    expect(reject(undefined)).toEqual({ ok: false, denial: "reason_required" });
    expect(reject("   ")).toEqual({ ok: false, denial: "reason_required" });
  });

  it("accepts a reason exactly at the length limit and rejects one over it", () => {
    expect(reject("a".repeat(MAX_REASON_LENGTH)).ok).toBe(true);
    expect(reject("a".repeat(MAX_REASON_LENGTH + 1))).toEqual({ ok: false, denial: "reason_required" });
  });

  it("trims the reason", () => {
    expect(reject("  duplicate of CF-1  ")).toMatchObject({ ok: true, reason: "duplicate of CF-1" });
  });

  it("is staff only: the reporter and other agencies cannot reject", () => {
    expect(reject("spam", reporter)).toEqual({ ok: false, denial: "forbidden" });
    expect(reject("spam", otherOfficer)).toEqual({ ok: false, denial: "forbidden" });
  });

  it("lets only a platform admin reject an unrouted report", () => {
    const r = (actor: TransitionActor) =>
      validateTransition({ from: "submitted", to: "rejected", actor, reportAgencyId: null, reason: "spam" }).ok;
    expect([r(platformAdmin), r(officer), r(system)]).toEqual([true, false, false]);
  });
});

describe("reassignment", () => {
  const ok = (from: ReportStatus, actor: TransitionActor, reportAgencyId: string | null = AGENCY) =>
    validateReassignment({ from, actor, reportAgencyId }).ok;

  it.each(REPORT_STATUSES)("is allowed from %s only if the status is reassignable", (from) => {
    const result = validateReassignment({ from, actor: platformAdmin, reportAgencyId: null });
    expect(result.ok).toBe(REASSIGNABLE_STATUSES.includes(from));
    if (!result.ok) expect(result.denial).toBe("not_allowed");
  });

  it("always lands the report in routed", () => {
    expect(validateReassignment({ from: "in_progress", actor: platformAdmin, reportAgencyId: AGENCY })).toEqual({
      ok: true,
      from: "in_progress",
      to: "routed",
    });
  });

  it("lets the holding agency admin and platform admin reassign a routed report", () => {
    expect([ok("routed", agencyAdmin), ok("routed", platformAdmin)]).toEqual([true, true]);
  });

  it("denies officers, other agencies, residents and the system", () => {
    for (const actor of [officer, otherOfficer, reporter, stranger, system]) {
      expect(ok("routed", actor)).toBe(false);
    }
    const otherAdmin: TransitionActor = { kind: "user", role: "agency_admin", agencyId: OTHER, isReporter: false };
    expect(ok("routed", otherAdmin)).toBe(false);
  });

  it("leaves triage (submitted) to platform admins", () => {
    expect([ok("submitted", platformAdmin, null), ok("submitted", agencyAdmin, null)]).toEqual([true, false]);
  });
});
