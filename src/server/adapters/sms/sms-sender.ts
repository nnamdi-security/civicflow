export interface SmsMessage {
  /** E.164, for example +2348031234567. */
  to: string;
  text: string;
}

/** Callers depend on this interface, never on a vendor. */
export interface SmsSender {
  send(message: SmsMessage): Promise<void>;
}

/** Vendor failures are mapped to this; it never carries vendor payloads, numbers, or message text. */
export class SmsDeliveryError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "SmsDeliveryError";
  }
}
