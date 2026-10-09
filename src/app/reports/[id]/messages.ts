const NOTICES: Record<string, { text: string; ok: boolean }> = {
  confirmed: { text: "Thank you. We have recorded that the problem is fixed.", ok: true },
  disputed: { text: "Thank you. We reopened your report and told the agency what is still wrong.", ok: true },
  reason_required: { text: "Tell us what is still wrong (up to 500 characters).", ok: false },
  not_allowed: { text: "This report is no longer waiting for your answer.", ok: false },
  conflict: { text: "This report was just updated. Review it and try again.", ok: false },
  malformed: { text: "Something was wrong with the form. Refresh the page and try again.", ok: false },
  not_found: { text: "That report could not be found.", ok: false },
  forbidden: { text: "You are not allowed to do that.", ok: false },
};

/** Looks up a notice code from the URL; unknown codes show nothing. */
export function noticeFor(code: string | undefined) {
  return code && Object.hasOwn(NOTICES, code) ? NOTICES[code] : undefined;
}
