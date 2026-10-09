/**
 * Unit tests for the admin-form rules in admin.ts. No database: each test passes in what a
 * person might type and checks whether it is accepted, cleaned up, or refused with the right reason.
 */
import { describe, expect, it } from "vitest";
import {
  AGENCY_NAME_MAX,
  SLA_ACK_MAX_MINUTES,
  SLA_ACK_MIN_MINUTES,
  SLA_NOTE_MAX,
  SLA_RESOLVE_MAX_MINUTES,
  describeSlaChange,
  validateAgencyInput,
  validatePriority,
  validateSlaPolicyInput,
} from "./admin";

describe("validateAgencyInput", () => {
  it("accepts a normal name and a real type", () => {
    expect(validateAgencyInput({ name: "Lagos Roads Agency", type: "roads" })).toEqual({
      ok: true,
      value: { name: "Lagos Roads Agency", type: "roads" },
    });
  });

  it("tidies the name: trims, squashes spaces and line breaks into single spaces", () => {
    const result = validateAgencyInput({ name: "  Lagos \n\n Water\t Board  ", type: "water" });
    expect(result).toMatchObject({ ok: true, value: { name: "Lagos Water Board" } });
  });

  it("removes invisible control characters", () => {
    const result = validateAgencyInput({ name: "Lagos\u0000 Roads​ Agency", type: "roads" });
    expect(result).toMatchObject({ ok: true, value: { name: "Lagos Roads Agency" } });
  });

  it("rejects names that are too short or too long, at the exact limits", () => {
    expect(validateAgencyInput({ name: "A", type: "roads" })).toEqual({ ok: false, issue: "name_invalid" });
    expect(validateAgencyInput({ name: "AB", type: "roads" }).ok).toBe(true);
    expect(validateAgencyInput({ name: "x".repeat(AGENCY_NAME_MAX), type: "roads" }).ok).toBe(true);
    expect(validateAgencyInput({ name: "x".repeat(AGENCY_NAME_MAX + 1), type: "roads" })).toEqual({
      ok: false,
      issue: "name_invalid",
    });
  });

  it("rejects a name that is only blanks, and names that are not text", () => {
    expect(validateAgencyInput({ name: "   \n  ", type: "roads" })).toEqual({ ok: false, issue: "name_invalid" });
    for (const bad of [undefined, null, 42, {}, ["Roads"]]) {
      expect(validateAgencyInput({ name: bad, type: "roads" })).toEqual({ ok: false, issue: "name_invalid" });
    }
  });

  it("rejects an agency type that is not one of the six real ones", () => {
    for (const bad of ["parks", "ROADS", "", undefined, 5]) {
      expect(validateAgencyInput({ name: "Valid Name", type: bad })).toEqual({ ok: false, issue: "type_invalid" });
    }
  });
});

describe("validatePriority", () => {
  it("accepts whole numbers from 0 to 1000", () => {
    for (const ok of [0, 1, 500, 1000]) expect(validatePriority(ok)).toBe(ok);
  });

  it("rejects everything else", () => {
    for (const bad of [-1, 1001, 1.5, NaN, Infinity, "5", null, undefined]) expect(validatePriority(bad)).toBeNull();
  });
});

describe("validateSlaPolicyInput", () => {
  // A fully valid input that each test changes one part of.
  const valid = { ackMinutes: 1440, resolveMinutes: 20160, note: "Targets agreed with the ministry" };

  it("accepts valid durations and a note", () => {
    expect(validateSlaPolicyInput(valid)).toEqual({ ok: true, value: valid });
  });

  it("accepts the exact limits", () => {
    expect(validateSlaPolicyInput({ ...valid, ackMinutes: SLA_ACK_MIN_MINUTES, resolveMinutes: SLA_ACK_MIN_MINUTES }).ok).toBe(true);
    expect(
      validateSlaPolicyInput({ ...valid, ackMinutes: SLA_ACK_MAX_MINUTES, resolveMinutes: SLA_RESOLVE_MAX_MINUTES }).ok,
    ).toBe(true);
  });

  it("rejects an acknowledge time outside the allowed range, or not a whole number", () => {
    for (const bad of [0, 4, SLA_ACK_MAX_MINUTES + 1, 1.5, "1440", null, NaN]) {
      expect(validateSlaPolicyInput({ ...valid, ackMinutes: bad })).toEqual({ ok: false, issue: "ack_invalid" });
    }
  });

  it("rejects a resolve time that is too large or not a whole number", () => {
    for (const bad of [SLA_RESOLVE_MAX_MINUTES + 1, 2.5, "20160", undefined]) {
      expect(validateSlaPolicyInput({ ...valid, resolveMinutes: bad })).toEqual({ ok: false, issue: "resolve_invalid" });
    }
  });

  it("rejects a resolve time shorter than the acknowledge time", () => {
    expect(validateSlaPolicyInput({ ...valid, ackMinutes: 600, resolveMinutes: 599 })).toEqual({
      ok: false,
      issue: "resolve_before_ack",
    });
    // Equal is allowed.
    expect(validateSlaPolicyInput({ ...valid, ackMinutes: 600, resolveMinutes: 600 }).ok).toBe(true);
  });

  it("requires a real note, trimmed, between 5 and 500 characters", () => {
    for (const bad of [undefined, null, 5, "", "    ", "abcd", "x".repeat(SLA_NOTE_MAX + 1)]) {
      expect(validateSlaPolicyInput({ ...valid, note: bad })).toEqual({ ok: false, issue: "note_invalid" });
    }
    expect(validateSlaPolicyInput({ ...valid, note: "  abcde  " })).toMatchObject({ ok: true, value: { note: "abcde" } });
    expect(validateSlaPolicyInput({ ...valid, note: "x".repeat(SLA_NOTE_MAX) }).ok).toBe(true);
  });
});

describe("describeSlaChange", () => {
  it("writes a plain sentence with the old and new numbers and the reason", () => {
    expect(
      describeSlaChange(
        { ackMinutes: 1440, resolveMinutes: 20160 },
        { ackMinutes: 720, resolveMinutes: 4320 },
        "faster targets",
      ),
    ).toBe("acknowledge 1440 -> 720 min; resolve 20160 -> 4320 min. Reason: faster targets");
  });
});
