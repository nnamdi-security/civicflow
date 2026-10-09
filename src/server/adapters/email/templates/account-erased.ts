/**
 * The email sent to the OLD address just before an account is erased (ADR 0015).
 *
 * Why send it: if someone else got into a resident's signed-in session and pressed "delete my
 * account", the real owner finds out straight away instead of silently losing their data. It is
 * sent to the address as it was before erasure, then that address is removed from our records.
 * It contains no report details and no link: there is nothing to sign in to any more.
 */
import type { EmailMessage } from "../email-sender";

/** Template version, bumped when the wording changes materially. */
export const ACCOUNT_ERASED_TEMPLATE_VERSION = 1;

export function accountErasedEmail(params: { to: string }): EmailMessage {
  const lines = [
    "Your CivicFlow account has been deleted at your request.",
    "We have removed your email address, name, phone number and the descriptions and photos of your reports. The reports themselves stay on record without any personal details, so that the public history of what agencies did is kept.",
    "If you did not ask for this, please contact the CivicFlow team as soon as you can.",
  ];
  return {
    to: params.to,
    subject: "Your CivicFlow account was deleted",
    text: lines.join("\n\n"),
    html: lines.map((line) => `<p>${line}</p>`).join(""),
  };
}
