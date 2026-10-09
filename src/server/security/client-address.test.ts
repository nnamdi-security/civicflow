/**
 * Unit tests for reading the visitor's network address from proxy headers. The key scenario is an
 * attacker who invents their own X-Forwarded-For value on every request to get around rate limits:
 * these tests prove the invented part is ignored.
 */
import { describe, expect, it } from "vitest";
import { UNKNOWN_ADDRESS, pickClientAddress } from "./client-address";

const headers = (init: Record<string, string>) => new Headers(init);

describe("with one trusted proxy (the usual setup)", () => {
  it("uses the single address the proxy wrote", () => {
    expect(pickClientAddress(headers({ "x-forwarded-for": "203.0.113.7" }), 1)).toBe("203.0.113.7");
  });

  it("takes the LAST entry, because the proxy appended it; the visitor's forged part is ignored", () => {
    // The attacker sent "X-Forwarded-For: 1.2.3.4" and the proxy added the real address after it.
    expect(pickClientAddress(headers({ "x-forwarded-for": "1.2.3.4, 203.0.113.7" }), 1)).toBe("203.0.113.7");
    expect(pickClientAddress(headers({ "x-forwarded-for": "9.9.9.9, 8.8.8.8, 203.0.113.7" }), 1)).toBe("203.0.113.7");
  });

  it("gives the SAME answer however the visitor forges the front of the list (so limits cannot be dodged)", () => {
    const real = "203.0.113.7";
    const answers = new Set(
      ["1.1.1.1", "2.2.2.2", "3.3.3.3, 4.4.4.4", "evil, evil2"].map((forged) =>
        pickClientAddress(headers({ "x-forwarded-for": `${forged}, ${real}` }), 1),
      ),
    );
    expect([...answers]).toEqual([real]);
  });

  it("tolerates extra spaces and empty entries", () => {
    expect(pickClientAddress(headers({ "x-forwarded-for": " 1.2.3.4 ,, 203.0.113.7 " }), 1)).toBe("203.0.113.7");
  });

  it("accepts IPv6 addresses", () => {
    expect(pickClientAddress(headers({ "x-forwarded-for": "2001:db8::1" }), 1)).toBe("2001:db8::1");
  });
});

describe("with more trusted proxies", () => {
  it("counts that many entries in from the right", () => {
    // visitor -> CDN -> load balancer -> app: the list is "forged?, visitor-as-CDN-saw-it, CDN-as-LB-saw-it"
    const list = "6.6.6.6, 203.0.113.7, 198.51.100.2";
    expect(pickClientAddress(headers({ "x-forwarded-for": list }), 2)).toBe("203.0.113.7");
    expect(pickClientAddress(headers({ "x-forwarded-for": list }), 1)).toBe("198.51.100.2");
    expect(pickClientAddress(headers({ "x-forwarded-for": list }), 3)).toBe("6.6.6.6");
  });

  it("falls back to the earliest entry when the list is shorter than the trusted proxies", () => {
    expect(pickClientAddress(headers({ "x-forwarded-for": "203.0.113.7" }), 3)).toBe("203.0.113.7");
  });
});

describe("when the headers cannot be trusted or are missing", () => {
  it("ignores all headers when no proxy is trusted (hops = 0)", () => {
    expect(pickClientAddress(headers({ "x-forwarded-for": "203.0.113.7", "x-real-ip": "203.0.113.8" }), 0)).toBe(UNKNOWN_ADDRESS);
  });

  it("treats a nonsense number of hops as untrusted rather than guessing", () => {
    for (const bad of [-1, 1.5, Number.NaN]) {
      expect(pickClientAddress(headers({ "x-forwarded-for": "203.0.113.7" }), bad)).toBe(UNKNOWN_ADDRESS);
    }
  });

  it("returns 'unknown' when there are no headers at all", () => {
    expect(pickClientAddress(headers({}), 1)).toBe(UNKNOWN_ADDRESS);
  });

  it("uses X-Real-IP only when X-Forwarded-For is absent", () => {
    expect(pickClientAddress(headers({ "x-real-ip": "203.0.113.9" }), 1)).toBe("203.0.113.9");
    expect(pickClientAddress(headers({ "x-forwarded-for": "203.0.113.7", "x-real-ip": "1.2.3.4" }), 1)).toBe("203.0.113.7");
  });

  it("refuses values that are not addresses, so hostile text never reaches a rate-limit key", () => {
    for (const hostile of ["not-an-ip!", "<script>alert(1)</script>", "x".repeat(200), "1.2.3.4 evil", "DROP TABLE"]) {
      expect(pickClientAddress(headers({ "x-forwarded-for": hostile }), 1), hostile).toBe(UNKNOWN_ADDRESS);
      expect(pickClientAddress(headers({ "x-real-ip": hostile }), 1), hostile).toBe(UNKNOWN_ADDRESS);
    }
  });
});
