import { SmsDeliveryError, type SmsMessage, type SmsSender } from "./sms-sender";

const TIMEOUT_MS = 10_000;

export interface TermiiConfig {
  apiKey: string;
  /** Approved sender ID. */
  senderId: string;
  baseUrl: string;
  /** "dnd" reaches numbers on Nigeria's Do-Not-Disturb list; "generic" does not. */
  channel: "generic" | "dnd";
  /** Injectable for tests; defaults to the global fetch. */
  fetchFn?: typeof fetch;
}

/**
 * Termii over its REST API. NOT yet checked against a live account (docs/integrations.md):
 * the request shape follows Termii's documented "send message" API and the base URL differs
 * per account. Errors keep the status only, never the body, which may echo numbers or text.
 */
export class TermiiSmsSender implements SmsSender {
  private readonly fetchFn: typeof fetch;

  constructor(private readonly config: TermiiConfig) {
    this.fetchFn = config.fetchFn ?? fetch;
  }

  async send(message: SmsMessage): Promise<void> {
    let response: Response;
    try {
      response = await this.fetchFn(`${this.config.baseUrl.replace(/\/+$/, "")}/api/sms/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: this.config.apiKey,
          // Termii wants the number without the leading plus.
          to: message.to.replace(/^\+/, ""),
          from: this.config.senderId,
          sms: message.text,
          type: "plain",
          channel: this.config.channel,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new SmsDeliveryError("SMS provider unreachable", true);
    }

    if (!response.ok) {
      throw new SmsDeliveryError(
        `SMS provider rejected the request (${response.status})`,
        response.status >= 500 || response.status === 429,
      );
    }
  }
}
