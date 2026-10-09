/**
 * Tests for the log redaction and the structured logger. These matter more than most tests: they
 * are the safety net behind the rule "no personal data in logs", so they try hard to sneak
 * personal data through, in every shape it might take.
 */
import { describe, expect, it, vi } from "vitest";
import { createLogger, errorFields, type LogLevel } from "./logger";
import { REDACTED, redact, scrubText } from "./redact";

describe("redacting by field name", () => {
  it("hides the value of sensitive fields, whatever they contain", () => {
    const result = redact({
      email: "alice@example.com",
      phone: "+2348031234567",
      token: "abc",
      password: "hunter2",
      description: "pothole outside my house",
      location: { lat: 6.5, lon: 3.4 },
      authorization: "Bearer xyz",
    });
    expect(result).toEqual({
      email: REDACTED,
      phone: REDACTED,
      token: REDACTED,
      password: REDACTED,
      description: REDACTED,
      location: REDACTED, // the whole object is hidden, not just its contents
      authorization: REDACTED,
    });
  });

  it("ignores capitalisation, underscores and hyphens in field names", () => {
    const result = redact({ Email: "a", E_mail: "b", "api-key": "c", SessionToken: "d", client_address: "e" });
    expect(Object.values(result as object)).toEqual([REDACTED, REDACTED, REDACTED, REDACTED, REDACTED]);
  });

  it("hides sensitive fields nested inside objects and lists", () => {
    const result = redact({ user: { profile: { email: "a@b.co", plan: "free" } }, people: [{ phone: "0803", id: 7 }] });
    expect(result).toEqual({ user: { profile: { email: REDACTED, plan: "free" } }, people: [{ phone: REDACTED, id: 7 }] });
  });

  it("keeps harmless fields such as ids, counts and codes", () => {
    const fields = { job: "sla-scan", recorded: 3, reportId: "3f2b8c1e-9d4a-4b7e-8a61-0c5d2e7f9a10", errorCode: "job_failed", ok: true };
    expect(redact(fields)).toEqual(fields);
  });
});

describe("redacting by what text looks like", () => {
  it("replaces email addresses anywhere in a string", () => {
    expect(scrubText("failed to send to alice.smith+news@mail.example.co.ng today")).toBe("failed to send to [email] today");
  });

  it("replaces phone numbers in common Nigerian and international forms", () => {
    for (const phone of ["+2348031234567", "+234 803 123 4567", "08031234567", "0803 123 4567", "0803-123-4567", "2348031234567"]) {
      expect(scrubText(`call ${phone} now`), phone).toBe("call [phone] now");
    }
  });

  it("treats a very long unbroken run of letters as a secret rather than logging it", () => {
    expect(scrubText("x".repeat(1000))).toBe("[secret]");
  });

  it("replaces bearer tokens, long hex strings and long token-like strings", () => {
    expect(scrubText("header Authorization: Bearer abc.def-ghi_123")).toContain("Bearer [secret]");
    expect(scrubText(`hash ${"a1b2c3d4".repeat(8)} stored`)).toBe("hash [secret] stored");
    expect(scrubText(`key ${"Zx9_".repeat(12)} here`)).toBe("key [secret] here");
  });

  it("leaves ordinary text, ids, references, dates and short numbers alone", () => {
    for (const text of [
      "scan finished",
      "3 reports escalated",
      "report CF-7K3M9QXD routed",
      "id 3f2b8c1e-9d4a-4b7e-8a61-0c5d2e7f9a10",
      "at 2026-06-30T12:00:00.000Z",
      "since 2026-06-30",
      "took 1234 ms",
    ]) {
      expect(scrubText(text), text).toBe(text);
    }
  });

  it("scrubs personal data inside harmlessly named fields", () => {
    const result = redact({ detail: "could not reach bob@example.com on 08031234567" });
    expect(result).toEqual({ detail: "could not reach [email] on [phone]" });
  });
});

describe("errors", () => {
  it("keeps the kind of error and a scrubbed message, never the stack or extra fields", () => {
    const error = Object.assign(new TypeError("no row for alice@example.com"), { stack: "at secret/path", userEmail: "x@y.co" });
    const result = redact(error) as Record<string, unknown>;
    expect(result).toEqual({ name: "TypeError", message: "no row for [email]" });
    expect(JSON.stringify(result)).not.toContain("secret/path");
  });

  it("makes safe fields from anything that was thrown", () => {
    expect(errorFields(new Error("boom for a@b.co"))).toEqual({ errorName: "Error", errorMessage: "boom for [email]" });
    expect(errorFields("a plain string with a@b.co")).toEqual({ errorName: "NonError" });
    expect(errorFields(undefined)).toEqual({ errorName: "NonError" });
  });
});

describe("other values and limits", () => {
  it("turns dates into text and keeps numbers, booleans and null", () => {
    expect(redact({ at: new Date("2026-06-30T12:00:00Z"), n: 5, ok: false, none: null, big: BigInt(10) })).toEqual({
      at: "2026-06-30T12:00:00.000Z",
      n: 5,
      ok: false,
      none: null,
      big: "10",
    });
    expect(redact({ at: new Date("not a date") })).toEqual({ at: "[invalid date]" });
  });

  it("drops undefined values and functions", () => {
    expect(redact({ a: undefined, b: () => 1, c: 2 })).toEqual({ c: 2 });
  });

  it("shortens very long text", () => {
    // Ordinary words (a run of 1000 identical letters would be scrubbed as a secret-looking string instead).
    const result = redact({ detail: "the road is bad ".repeat(100) }) as { detail: string };
    expect(result.detail.length).toBeLessThan(400);
    expect(result.detail.endsWith("…")).toBe(true);
  });

  it("limits list length, field count and nesting depth", () => {
    const list = redact({ items: Array.from({ length: 50 }, (_, i) => i) }) as { items: unknown[] };
    expect(list.items).toHaveLength(21);
    expect(list.items.at(-1)).toBe("[+30 more]");

    const wide = redact(Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`k${i}`, i]))) as Record<string, unknown>;
    expect(Object.keys(wide)).toHaveLength(31);
    expect(wide["[more]"]).toBe("+20 fields");

    let deep: Record<string, unknown> = { leaf: "bottom" };
    for (let i = 0; i < 10; i++) deep = { inner: deep };
    expect(JSON.stringify(redact(deep))).toContain("[truncated]");
  });

  it("copes with objects that refer to themselves", () => {
    const loop: Record<string, unknown> = { id: 1 };
    loop.self = loop;
    expect(redact(loop)).toEqual({ id: 1, self: "[circular]" });
  });

  it("never throws, even for an object whose fields fail to read", () => {
    const hostile = {
      get boom(): string {
        throw new Error("getter exploded");
      },
    };
    expect(() => redact({ hostile })).not.toThrow();
    expect(redact({ hostile })).toEqual({ hostile: "[unloggable]" });
  });

  it("does not change the object it was given", () => {
    const input = { email: "a@b.co", nested: { phone: "08031234567" } };
    const copy = JSON.parse(JSON.stringify(input));
    redact(input);
    expect(input).toEqual(copy);
  });
});

describe("the structured logger", () => {
  /** A logger that records lines instead of printing them, with time frozen. */
  function recorder() {
    const lines: Array<{ level: LogLevel; parsed: Record<string, unknown> }> = [];
    const logger = createLogger({
      now: () => new Date("2026-06-30T12:00:00Z"),
      sink: { write: (level, line) => lines.push({ level, parsed: JSON.parse(line) as Record<string, unknown> }) },
    });
    return { logger, lines };
  }

  it("writes one JSON line with time, level, event and the fields", () => {
    const { logger, lines } = recorder();
    logger.info("sla_scan.finished", { recorded: 3 });
    expect(lines).toEqual([
      { level: "info", parsed: { recorded: 3, time: "2026-06-30T12:00:00.000Z", level: "info", event: "sla_scan.finished" } },
    ]);
  });

  it("supports all four levels", () => {
    const { logger, lines } = recorder();
    logger.debug("a");
    logger.info("b");
    logger.warn("c");
    logger.error("d");
    expect(lines.map((l) => l.level)).toEqual(["debug", "info", "warn", "error"]);
  });

  it("redacts personal data in the fields, even when a careless caller passes it", () => {
    const { logger, lines } = recorder();
    logger.error("send.failed", { email: "alice@example.com", error: new Error("no route to bob@example.com"), user: { phone: "08031234567" } });
    const text = JSON.stringify(lines);
    for (const secret of ["alice@example.com", "bob@example.com", "08031234567"]) expect(text).not.toContain(secret);
    expect(lines[0]?.parsed).toMatchObject({ email: REDACTED, user: { phone: REDACTED } });
  });

  it("does not let a field overwrite the time, level or event", () => {
    const { logger, lines } = recorder();
    logger.info("real.event", { time: "1999", level: "debug", event: "fake" } as Record<string, unknown>);
    expect(lines[0]?.parsed).toMatchObject({ time: "2026-06-30T12:00:00.000Z", level: "info", event: "real.event" });
  });

  it("works with no fields at all", () => {
    const { logger, lines } = recorder();
    logger.warn("just.an.event");
    expect(lines[0]?.parsed).toEqual({ time: "2026-06-30T12:00:00.000Z", level: "warn", event: "just.an.event" });
  });

  it("by default sends warnings and errors to the error stream and the rest to normal output", () => {
    const out = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const logger = createLogger();
    logger.info("i");
    logger.warn("w");
    logger.error("e");
    expect([out.mock.calls.length, err.mock.calls.length]).toEqual([1, 2]);
    out.mockRestore();
    err.mockRestore();
  });
});
