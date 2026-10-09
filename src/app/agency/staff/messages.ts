/**
 * Friendly sentences for the staff screen. After a form is submitted the server redirects back
 * here with `?notice=<code>`; only the codes listed below are ever displayed.
 */
const NOTICES: Record<string, { text: string; ok: boolean }> = {
  invited: {
    text: "Invitation created. Ask them to sign in with that email address; a sign-in link will be sent to them.",
    ok: true,
  },
  deactivated: { text: "Account deactivated. They are signed out and can no longer sign in.", ok: true },
  reactivated: { text: "Account reactivated. They can sign in again.", ok: true },
  unchanged: { text: "Nothing was changed.", ok: true },
  malformed: { text: "Something was wrong with the form. Refresh the page and try again.", ok: false },
  email_invalid: { text: "Enter a valid email address.", ok: false },
  already_exists: { text: "An account with that email address already exists.", ok: false },
  agency_not_found: { text: "Choose an agency from the list.", ok: false },
  not_found: { text: "That account could not be found.", ok: false },
  last_platform_admin: { text: "You cannot deactivate the last active platform admin.", ok: false },
};

export function noticeFor(code: string | undefined) {
  return code && Object.hasOwn(NOTICES, code) ? NOTICES[code] : undefined;
}
