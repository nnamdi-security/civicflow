const NOTICES: Record<string, { text: string; ok: boolean }> = {
  status_updated: { text: "Status updated.", ok: true },
  reassigned: { text: "Report reassigned.", ok: true },
  malformed: { text: "Something was wrong with the form. Refresh the page and try again.", ok: false },
  not_found: { text: "That report could not be found.", ok: false },
  forbidden: { text: "You are not allowed to do that.", ok: false },
  not_allowed: { text: "That change is not possible from the report's current status.", ok: false },
  reason_required: { text: "Add a short reason (up to 500 characters) to reject a report.", ok: false },
  conflict: { text: "Someone else changed this report first. Review it and try again.", ok: false },
  unknown_agency: { text: "Choose an agency from the list.", ok: false },
  same_agency: { text: "The report is already with that agency.", ok: false },
};

/** Looks up a notice code from the URL; unknown codes show nothing. */
export function noticeFor(code: string | undefined) {
  return code && Object.hasOwn(NOTICES, code) ? NOTICES[code] : undefined;
}

