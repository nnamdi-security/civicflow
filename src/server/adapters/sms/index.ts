import type { SmsEnv } from "../../env";
import { DevOutboxSmsSender } from "./dev-outbox-sms-sender";
import type { SmsSender } from "./sms-sender";
import { TermiiSmsSender } from "./termii-sms-sender";

export { DevOutboxSmsSender } from "./dev-outbox-sms-sender";
export { FakeSmsSender } from "./fake-sms-sender";
export { SmsDeliveryError } from "./sms-sender";
export type { SmsMessage, SmsSender } from "./sms-sender";
export { TermiiSmsSender } from "./termii-sms-sender";

/**
 * Termii when configured; the dev outbox outside production; otherwise null, meaning SMS is
 * switched off (the dispatcher skips SMS rows instead of failing; ADR 0012). Unlike email,
 * SMS is optional, so production does not refuse to start without it.
 */
export function createSmsSender(env: SmsEnv): SmsSender | null {
  if (env.TERMII_API_KEY !== undefined && env.TERMII_SENDER_ID !== undefined) {
    return new TermiiSmsSender({
      apiKey: env.TERMII_API_KEY,
      senderId: env.TERMII_SENDER_ID,
      baseUrl: env.TERMII_BASE_URL,
      channel: env.TERMII_CHANNEL,
    });
  }
  return env.NODE_ENV === "production" ? null : new DevOutboxSmsSender();
}
