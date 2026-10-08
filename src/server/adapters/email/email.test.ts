import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { parseAuthEnv } from "../../env";
import { DevOutboxEmailSender } from "./dev-outbox-email-sender";
import { EmailDeliveryError, type EmailMessage } from "./email-sender";
import { FakeEmailSender } from "./fake-email-sender";
import { createEmailSender } from "./index";
import { ResendEmailSender } from "./resend-email-sender";
import { signInEmail } from "./templates/sign-in";

const message: EmailMessage = signInEmail({ to: "user@example.com", url: "https://x.test/cb?t=1" });
const SECRET = "x".repeat(32);

function resend(fetchFn: typeof fetch) {
  return new ResendEmailSender({ apiKey: "key", from: "CivicFlow <no-reply@example.com>", fetchFn });
}

describe("ResendEmailSender", () => {
  it("posts the message with bearer auth", async () => {
    const fetchFn = vi.fn(async () => new Response("{}", { status: 200 }));
    await resend(fetchFn as unknown as typeof fetch).send(message);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer key");
    expect(JSON.parse(init.body as string).to).toEqual(["user@example.com"]);
  });

  it("marks server errors and rate limits retryable, client errors not", async () => {
    for (const [status, retryable] of [
      [500, true],
      [429, true],
      [422, false],
    ] as const) {
      const fetchFn = vi.fn(async () => new Response("secret body user@example.com", { status }));
      const error = await resend(fetchFn as unknown as typeof fetch)
        .send(message)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(EmailDeliveryError);
      expect((error as EmailDeliveryError).retryable).toBe(retryable);
      expect((error as EmailDeliveryError).message).not.toContain("user@example.com");
    }
  });

  it("maps network failures to a retryable delivery error", async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError("fetch failed for user@example.com");
    });
    const error = await resend(fetchFn as unknown as typeof fetch)
      .send(message)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EmailDeliveryError);
    expect((error as EmailDeliveryError).message).not.toContain("user@example.com");
  });
});

describe("FakeEmailSender", () => {
  it("records sent messages and can fail once", async () => {
    const fake = new FakeEmailSender();
    fake.failOnNextSend();
    await expect(fake.send(message)).rejects.toThrow();
    await fake.send(message);
    expect(fake.sent).toHaveLength(1);
  });
});

describe("DevOutboxEmailSender", () => {
  it("appends messages to a file instead of logging", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "outbox-"));
    await new DevOutboxEmailSender(dir).send(message);
    const lines = (await readFile(path.join(dir, "emails.jsonl"), "utf8")).trim().split("\n");
    expect(JSON.parse(lines[0] ?? "{}").to).toBe("user@example.com");
  });
});

describe("createEmailSender", () => {
  it("uses Resend when configured", () => {
    const env = parseAuthEnv({ AUTH_SECRET: SECRET, RESEND_API_KEY: "k", EMAIL_FROM: "a@b.co" });
    expect(createEmailSender(env)).toBeInstanceOf(ResendEmailSender);
  });

  it("uses the dev outbox outside production without Resend", () => {
    const env = parseAuthEnv({ AUTH_SECRET: SECRET, NODE_ENV: "development" });
    expect(createEmailSender(env)).toBeInstanceOf(DevOutboxEmailSender);
  });

  it("refuses to start in production without Resend", () => {
    const env = parseAuthEnv({ AUTH_SECRET: SECRET, NODE_ENV: "production" });
    expect(() => createEmailSender(env)).toThrow("Email is not configured");
  });
});

describe("parseAuthEnv", () => {
  it("requires a long AUTH_SECRET", () => {
    expect(() => parseAuthEnv({ AUTH_SECRET: "short" })).toThrow("AUTH_SECRET");
  });

  it("requires EMAIL_FROM when RESEND_API_KEY is set", () => {
    expect(() => parseAuthEnv({ AUTH_SECRET: SECRET, RESEND_API_KEY: "k" })).toThrow("EMAIL_FROM");
  });
});

describe("signInEmail", () => {
  it("escapes the link in HTML", () => {
    const m = signInEmail({ to: "a@b.co", url: 'https://x.test/?a=1&b="2"' });
    expect(m.html).toContain("a=1&amp;b=&quot;2&quot;");
    expect(m.text).toContain('b="2"');
  });
});
