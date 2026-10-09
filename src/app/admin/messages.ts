/**
 * The friendly sentences shown after an admin action.
 *
 * After a form is submitted, the server redirects back to the page with `?notice=<code>` in the
 * address. The page looks the code up here. Only codes listed below are ever shown, so a
 * visitor cannot make the page display arbitrary text by editing the address.
 */
const NOTICES: Record<string, { text: string; ok: boolean }> = {
  // ---- successes
  agency_created: { text: "Agency created.", ok: true },
  agency_updated: { text: "Agency updated.", ok: true },
  coverage_added: { text: "Coverage added.", ok: true },
  coverage_removed: { text: "Coverage removed.", ok: true },
  priority_saved: { text: "Priority saved.", ok: true },
  sla_saved: { text: "SLA policy saved. It applies to timers that start from now on.", ok: true },
  category_saved: { text: "Category updated.", ok: true },
  unchanged: { text: "Nothing was changed.", ok: true },
  // ---- problems
  malformed: { text: "Something was wrong with the form. Refresh the page and try again.", ok: false },
  not_found: { text: "That record could not be found.", ok: false },
  name_invalid: { text: "The name must be 2 to 100 characters.", ok: false },
  type_invalid: { text: "Choose one of the listed agency types.", ok: false },
  name_taken: { text: "Another agency already has that name.", ok: false },
  priority_invalid: { text: "Priority must be a whole number from 0 to 1000.", ok: false },
  already_covered: { text: "That agency already covers that area.", ok: false },
  ack_invalid: { text: "Acknowledge time must be a whole number of minutes from 5 to 43200 (30 days).", ok: false },
  resolve_invalid: { text: "Resolve time must be a whole number of minutes, at most 525600 (one year).", ok: false },
  resolve_before_ack: { text: "The resolve time cannot be shorter than the acknowledge time.", ok: false },
  note_invalid: { text: "Explain the change in 5 to 500 characters.", ok: false },
  last_active_category: { text: "At least one category must stay switched on.", ok: false },
};

/** Looks up a notice code from the address; unknown codes show nothing. */
export function noticeFor(code: string | undefined) {
  return code && Object.hasOwn(NOTICES, code) ? NOTICES[code] : undefined;
}
