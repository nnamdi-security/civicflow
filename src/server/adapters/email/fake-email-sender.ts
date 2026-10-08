import { EmailDeliveryError, type EmailMessage, type EmailSender } from "./email-sender";

/** In-memory fake for tests. */
export class FakeEmailSender implements EmailSender {
  readonly sent: EmailMessage[] = [];
  private failures: Array<{ retryable: boolean }> = [];

  /** The next send fails; retryable by default, like a provider outage. */
  failOnNextSend(options: { retryable?: boolean } = {}): void {
    this.failures.push({ retryable: options.retryable ?? true });
  }

  async send(message: EmailMessage): Promise<void> {
    const failure = this.failures.shift();
    if (failure) throw new EmailDeliveryError("fake email failure", failure.retryable);
    this.sent.push(message);
  }
}
