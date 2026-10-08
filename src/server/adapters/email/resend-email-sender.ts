import { EmailDeliveryError, type EmailMessage, type EmailSender } from "./email-sender";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const TIMEOUT_MS = 10_000;

interface ResendConfig {
  apiKey: string;
  from: string;
  /** Injectable for tests; defaults to the global fetch. */
  fetchFn?: typeof fetch;
}

/**
 * Resend over its REST API. Sign-in emails are not retried here: a duplicate link is worse
 * than asking the user to request another.
 */
export class ResendEmailSender implements EmailSender {
  private readonly fetchFn: typeof fetch;

  constructor(private readonly config: ResendConfig) {
    this.fetchFn = config.fetchFn ?? fetch;
  }

  async send(message: EmailMessage): Promise<void> {
    let response: Response;
    try {
      response = await this.fetchFn(RESEND_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: this.config.from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          html: message.html,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new EmailDeliveryError("Email provider unreachable", true);
    }

    if (!response.ok) {
      // Status only: never include the response body, which may echo addresses.
      throw new EmailDeliveryError(
        `Email provider rejected the request (${response.status})`,
        response.status >= 500 || response.status === 429,
      );
    }
  }
}
