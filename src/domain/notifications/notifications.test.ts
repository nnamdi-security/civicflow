import { describe, expect, it } from "vitest";
import { fixedClock } from "../clock";
import { REPORT_STATUSES } from "../reports/status";
import { ESCALATION_LEVELS } from "../sla";
import {
  NOTIFICATION_EVENTS,
  NOTIFICATION_RULES,
  discriminatorFor,
  eventForEscalation,
  eventForStatus,
} from "./events";
import { maskPhone, normalizeNigerianPhone } from "./phone";
import { MAX_ATTEMPTS, RETRY_DELAYS_MINUTES, nextAttemptAt } from "./retry";
import { SMS_MAX_LENGTH, renderEmail, renderSms, reportUrl, type MessageContext } from "./templates";

const ID = "3f2b8c1e-9d4a-4b7e-8a61-0c5d2e7f9a10";
const BASE = "https://civicflow.example.ng";
const ctx = (overrides: Partial<MessageContext> = {}): MessageContext => ({
  reference: "CF-7K3M9QXD",
  url: reportUrl(BASE, "reporter", ID),
  agencyName: "Lagos Roads Agency",
  ...overrides,
});

describe("rules", () => {
  it("gives every event at least one recipient and email first", () => {
    for (const event of NOTIFICATION_EVENTS) {
      const intents = NOTIFICATION_RULES[event];
      expect(intents.length).toBeGreaterThan(0);
      expect(intents.some((i) => i.channel === "email")).toBe(true);
    }
  });

  it("uses SMS only for residents, on exactly resolved and publicly overdue (ADR 0012)", () => {
    const withSms = NOTIFICATION_EVENTS.filter((e) => NOTIFICATION_RULES[e].some((i) => i.channel === "sms"));
    expect(withSms).toEqual(["report_resolved", "escalation_level_3"]);
    for (const event of withSms) {
      for (const intent of NOTIFICATION_RULES[event]) {
        if (intent.channel === "sms") expect(intent.recipient).toBe("reporter");
      }
    }
  });

  it("sends escalations up the ladder: agency admins, platform admins, then the resident", () => {
    expect(NOTIFICATION_RULES.escalation_level_1.map((i) => i.recipient)).toEqual(["agency_admins"]);
    expect(NOTIFICATION_RULES.escalation_level_2.map((i) => i.recipient)).toEqual(["platform_admins"]);
    expect(NOTIFICATION_RULES.escalation_level_3.map((i) => i.recipient)).toEqual(["reporter", "reporter"]);
  });

  it("maps statuses to events, leaving in_progress, confirmed and submitted silent", () => {
    const silent = REPORT_STATUSES.filter((s) => eventForStatus(s) === null);
    expect(silent).toEqual(["submitted", "in_progress", "confirmed"]);
  });

  it("maps each escalation level to its event", () => {
    expect(ESCALATION_LEVELS.map(eventForEscalation)).toEqual([
      "escalation_level_1",
      "escalation_level_2",
      "escalation_level_3",
    ]);
  });

  it("separates the two timers' escalations in the dedupe key, and nothing else", () => {
    expect(discriminatorFor("escalation_level_1", "acknowledge")).toBe("acknowledge");
    expect(discriminatorFor("escalation_level_1", "resolve")).toBe("resolve");
    expect(discriminatorFor("report_resolved", "resolve")).toBe("");
    expect(discriminatorFor("escalation_level_1")).toBe("");
  });
});

describe("templates", () => {
  it("renders every event with the reference and link, in text and html", () => {
    for (const event of NOTIFICATION_EVENTS) {
      const mail = renderEmail(event, ctx({ reason: "Duplicate of another report", timer: "acknowledge" }));
      expect(mail.subject.length).toBeGreaterThan(0);
      expect(mail.text).toContain("CF-7K3M9QXD");
      expect(mail.text).toContain(ctx().url);
      expect(mail.html).toContain(`href="${ctx().url}"`);
    }
  });

  it("escapes staff-entered text in html", () => {
    const mail = renderEmail("report_rejected", ctx({ reason: '<script>alert("x")</script> & more' }));
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&lt;script&gt;");
    expect(mail.html).toContain("&amp; more");
  });

  it("includes the rejection reason only when there is one", () => {
    expect(renderEmail("report_rejected", ctx({ reason: "Not a civic issue" })).text).toContain("Not a civic issue");
    expect(renderEmail("report_rejected", ctx({ reason: null })).text).not.toContain("Reason given");
  });

  it("names the right timer in escalation wording", () => {
    expect(renderEmail("escalation_level_1", ctx({ timer: "acknowledge" })).subject).toContain("acknowledged");
    expect(renderEmail("escalation_level_1", ctx({ timer: "resolve" })).subject).toContain("resolved");
  });

  it("falls back to a generic agency name", () => {
    expect(renderEmail("report_routed", ctx({ agencyName: null })).subject).toContain("the responsible agency");
  });

  it("builds report links for residents and staff without a double slash", () => {
    expect(reportUrl(`${BASE}/`, "reporter", ID)).toBe(`${BASE}/reports/${ID}`);
    expect(reportUrl(BASE, "agency_admins", ID)).toBe(`${BASE}/agency/reports/${ID}`);
    expect(reportUrl(BASE, "platform_admins", ID)).toBe(`${BASE}/agency/reports/${ID}`);
  });

  it("never needs the description or location: the context has no such field", () => {
    const keys = Object.keys(ctx({ reason: "x", timer: "resolve" })).sort();
    expect(keys).toEqual(["agencyName", "reason", "reference", "timer", "url"]);
  });
});

describe("SMS templates", () => {
  it("exist exactly for the events that use SMS", () => {
    const withText = NOTIFICATION_EVENTS.filter((e) => renderSms(e, ctx()) !== null);
    expect(withText).toEqual(["report_resolved", "escalation_level_3"]);
  });

  it("fit in one plain-ASCII segment even with a long link", () => {
    const longUrl = reportUrl("https://civicflow-production.example.com.ng", "reporter", ID);
    for (const event of ["report_resolved", "escalation_level_3"] as const) {
      const text = renderSms(event, ctx({ url: longUrl }));
      expect(text).not.toBeNull();
      expect(text?.length).toBeLessThanOrEqual(SMS_MAX_LENGTH);
      expect(text).toMatch(/^[\x20-\x7E]+$/);
      expect(text).toContain("CF-7K3M9QXD");
    }
  });
});

describe("normalizeNigerianPhone", () => {
  it.each([
    ["08031234567", "+2348031234567"],
    ["0803 123 4567", "+2348031234567"],
    ["+234 803 123 4567", "+2348031234567"],
    ["2348031234567", "+2348031234567"],
    ["(0803) 123-4567", "+2348031234567"],
    ["8031234567", "+2348031234567"],
    ["07012345678", "+2347012345678"],
    ["09012345678", "+2349012345678"],
  ])("accepts %s", (input, expected) => {
    expect(normalizeNigerianPhone(input)).toBe(expected);
  });

  it.each([
    "",
    "abc",
    "0803123456", // too short
    "080312345678", // too long
    "+14155550123", // another country
    "01234567890", // not a mobile prefix
    "0603 123 4567", // 6xx is not a mobile range
    "+234 803 123 45a7",
  ])("rejects %j", (input) => {
    expect(normalizeNigerianPhone(input)).toBeNull();
  });

  it("masks all but the last two digits", () => {
    expect(maskPhone("+2348031234567")).toBe("+234********67");
  });
});

describe("retry schedule", () => {
  const clock = fixedClock(new Date("2026-03-01T09:00:00Z"));

  it("waits 1, 5, 30 then 120 minutes, then gives up", () => {
    expect(RETRY_DELAYS_MINUTES).toEqual([1, 5, 30, 120]);
    expect(MAX_ATTEMPTS).toBe(5);
    const minutes = [1, 2, 3, 4, 5].map((n) => {
      const at = nextAttemptAt(n, clock);
      return at === null ? null : (at.getTime() - clock.now().getTime()) / 60_000;
    });
    expect(minutes).toEqual([1, 5, 30, 120, null]);
  });

  it("does not schedule for a nonsense attempt count", () => {
    expect(nextAttemptAt(0, clock)).toBeNull();
    expect(nextAttemptAt(-1, clock)).toBeNull();
  });
});
