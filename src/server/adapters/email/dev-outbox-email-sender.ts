import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { EmailMessage, EmailSender } from "./email-sender";

/**
 * Local development only: appends messages to a gitignored file instead of logging them,
 * because sign-in links are credentials and addresses are PII. Read with `pnpm dev:last-email`.
 */
export class DevOutboxEmailSender implements EmailSender {
  constructor(private readonly dir: string = path.join(process.cwd(), ".dev-outbox")) {}

  async send(message: EmailMessage): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const line = JSON.stringify({ at: new Date().toISOString(), ...message });
    await appendFile(path.join(this.dir, "emails.jsonl"), `${line}\n`, "utf8");
  }
}
