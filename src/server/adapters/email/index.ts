import type { AuthEnv } from "../../env";
import { DevOutboxEmailSender } from "./dev-outbox-email-sender";
import type { EmailSender } from "./email-sender";
import { ResendEmailSender } from "./resend-email-sender";

export { EmailDeliveryError } from "./email-sender";
export type { EmailMessage, EmailSender } from "./email-sender";
export { FakeEmailSender } from "./fake-email-sender";
export { signInEmail } from "./templates/sign-in";

/** Resend when configured; the dev outbox outside production; otherwise a hard failure. */
export function createEmailSender(env: AuthEnv): EmailSender {
  if (env.RESEND_API_KEY !== undefined && env.EMAIL_FROM !== undefined) {
    return new ResendEmailSender({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM });
  }
  if (env.NODE_ENV === "production") {
    throw new Error("Email is not configured: set RESEND_API_KEY and EMAIL_FROM");
  }
  return new DevOutboxEmailSender();
}
