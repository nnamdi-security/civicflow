import { SmsDeliveryError, type SmsMessage, type SmsSender } from "./sms-sender";

/** In-memory fake for tests. */
export class FakeSmsSender implements SmsSender {
  readonly sent: SmsMessage[] = [];
  private failures: Array<{ retryable: boolean }> = [];

  /** The next send fails; retryable by default, like a provider outage. */
  failOnNextSend(options: { retryable?: boolean } = {}): void {
    this.failures.push({ retryable: options.retryable ?? true });
  }

  async send(message: SmsMessage): Promise<void> {
    const failure = this.failures.shift();
    if (failure) throw new SmsDeliveryError("fake SMS failure", failure.retryable);
    this.sent.push(message);
  }
}
