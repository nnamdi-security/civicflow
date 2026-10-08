import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { parseSmsEnv } from "../../env";
import { DevOutboxSmsSender } from "./dev-outbox-sms-sender";
import { FakeSmsSender } from "./fake-sms-sender";
import { createSmsSender } from "./index";
import { SmsDeliveryError, type SmsMessage } from "./sms-sender";
import { TermiiSmsSender } from "./termii-sms-sender";

const message: SmsMessage = { to: "+2348031234567", text: "CivicFlow: code 123456" };

function termii(fetchFn: typeof fetch, channel: "generic" | "dnd" = "dnd") {
  return new TermiiSmsSender({
    apiKey: "key",
    senderId: "CivicFlow",
    baseUrl: "https://api.example.test/",
    channel,
    fetchFn,
  });
}

describe("TermiiSmsSender", () => {
  it("posts the documented fields, without the plus sign on the number", async () => {
    const fetchFn = vi.fn(async () => new Response("{}", { status: 200 }));
    await termii(fetchFn as unknown as typeof fetch).send(message);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.example.test/api/sms/send");
    expect(JSON.parse(init.body as string)).toEqual({
      api_key: "key",
      to: "2348031234567",
      from: "CivicFlow",
      sms: "CivicFlow: code 123456",
      type: "plain",
      channel: "dnd",
    });
  });

  it("uses the configured channel", async () => {
    const fetchFn = vi.fn(async () => new Response("{}", { status: 200 }));
    await termii(fetchFn as unknown as typeof fetch, "generic").send(message);
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string).channel).toBe("generic");
  });

  it("marks server errors and rate limits retryable, client errors not, without leaking details", async () => {
    for (const [status, retryable] of [
      [500, true],
      [429, true],
      [401, false],
      [400, false],
    ] as const) {
      const fetchFn = vi.fn(async () => new Response("bad number 2348031234567 text CivicFlow", { status }));
      const error = await termii(fetchFn as unknown as typeof fetch)
        .send(message)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(SmsDeliveryError);
      expect((error as SmsDeliveryError).retryable).toBe(retryable);
      expect((error as SmsDeliveryError).message).not.toContain("2348031234567");
      expect((error as SmsDeliveryError).message).not.toContain("key");
    }
  });

  it("maps network failures to a retryable error that leaks nothing", async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError("fetch failed for 2348031234567");
    });
    const error = await termii(fetchFn as unknown as typeof fetch)
      .send(message)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SmsDeliveryError);
    expect((error as SmsDeliveryError).retryable).toBe(true);
    expect((error as SmsDeliveryError).message).not.toContain("2348031234567");
  });
});

describe("FakeSmsSender", () => {
  it("records sent messages and can fail on demand, retryable or not", async () => {
    const fake = new FakeSmsSender();
    fake.failOnNextSend();
    fake.failOnNextSend({ retryable: false });
    const first = await fake.send(message).catch((e: unknown) => e);
    const second = await fake.send(message).catch((e: unknown) => e);
    expect([(first as SmsDeliveryError).retryable, (second as SmsDeliveryError).retryable]).toEqual([true, false]);
    await fake.send(message);
    expect(fake.sent).toEqual([message]);
  });
});

describe("DevOutboxSmsSender", () => {
  it("appends messages to a file instead of logging", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "outbox-"));
    await new DevOutboxSmsSender(dir).send(message);
    const lines = (await readFile(path.join(dir, "sms.jsonl"), "utf8")).trim().split("\n");
    expect(JSON.parse(lines[0] ?? "{}").to).toBe("+2348031234567");
  });
});

describe("createSmsSender", () => {
  it("uses Termii when configured", () => {
    const env = parseSmsEnv({ TERMII_API_KEY: "k", TERMII_SENDER_ID: "CivicFlow" });
    expect(createSmsSender(env)).toBeInstanceOf(TermiiSmsSender);
  });

  it("uses the dev outbox outside production without Termii", () => {
    expect(createSmsSender(parseSmsEnv({ NODE_ENV: "development" }))).toBeInstanceOf(DevOutboxSmsSender);
  });

  it("is switched off in production without Termii, instead of refusing to start", () => {
    expect(createSmsSender(parseSmsEnv({ NODE_ENV: "production" }))).toBeNull();
  });
});

describe("parseSmsEnv", () => {
  it("requires the key and sender ID together", () => {
    expect(() => parseSmsEnv({ TERMII_API_KEY: "k" })).toThrow("TERMII_SENDER_ID");
    expect(() => parseSmsEnv({ TERMII_SENDER_ID: "CivicFlow" })).toThrow("TERMII_SENDER_ID");
  });

  it("limits the sender ID to 11 characters and defaults to the DND channel", () => {
    expect(() => parseSmsEnv({ TERMII_API_KEY: "k", TERMII_SENDER_ID: "TooLongSenderId" })).toThrow();
    expect(parseSmsEnv({}).TERMII_CHANNEL).toBe("dnd");
  });
});
