import type { EmailMessage, EmailSender } from "./email-sender";

/** In-memory fake for tests. */
export class FakeEmailSender implements EmailSender {
  readonly sent: EmailMessage[] = [];
  private failNext = false;

  failOnNextSend(): void {
    this.failNext = true;
  }

  async send(message: EmailMessage): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("fake email failure");
    }
    this.sent.push(message);
  }
}
