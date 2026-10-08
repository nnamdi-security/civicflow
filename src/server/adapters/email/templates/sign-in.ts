import type { EmailMessage } from "../email-sender";

/** Template version, bumped when wording changes materially. */
export const SIGN_IN_TEMPLATE_VERSION = 1;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function signInEmail(params: { to: string; url: string }): EmailMessage {
  const url = escapeHtml(params.url);
  return {
    to: params.to,
    subject: "Sign in to CivicFlow",
    text: `Use this link to sign in to CivicFlow:\n\n${params.url}\n\nIt expires soon and works once. If you did not ask for it, ignore this email.`,
    html: `<p>Use this link to sign in to CivicFlow:</p><p><a href="${url}">Sign in</a></p><p>It expires soon and works once. If you did not ask for it, ignore this email.</p>`,
  };
}
