import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { SmsMessage, SmsSender } from "./sms-sender";

/**
 * Local development only: appends messages to a gitignored file instead of logging them,
 * because phone numbers are PII and verification codes are credentials. Read with `pnpm dev:last-sms`.
 */
export class DevOutboxSmsSender implements SmsSender {
  constructor(private readonly dir: string = path.join(process.cwd(), ".dev-outbox")) {}

  async send(message: SmsMessage): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const line = JSON.stringify({ at: new Date().toISOString(), ...message });
    await appendFile(path.join(this.dir, "sms.jsonl"), `${line}\n`, "utf8");
  }
}
