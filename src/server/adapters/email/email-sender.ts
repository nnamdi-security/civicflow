export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Callers depend on this interface, never on a vendor. */
export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

/** Vendor failures are mapped to this; it never carries vendor payloads, addresses, or bodies. */
export class EmailDeliveryError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "EmailDeliveryError";
  }
}
