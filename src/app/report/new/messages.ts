import { DESCRIPTION_MAX, DESCRIPTION_MIN, PHOTOS_MAX } from "@/domain/reports/new-report";
import type { ReportIssueCode } from "@/domain/reports/new-report";
import type { CreateReportResult } from "@/server/reports/create-report";

export const ISSUE_MESSAGES: Record<ReportIssueCode, string> = {
  description_too_short: `Describe the problem in at least ${DESCRIPTION_MIN} characters.`,
  description_too_long: `Keep the description under ${DESCRIPTION_MAX} characters.`,
  location_invalid: "Place the pin on the map.",
  location_outside_nigeria: "That location is outside Nigeria. Check the pin or the coordinates.",
  photos_missing: "Add at least one photo of the problem.",
  photos_too_many: `You can add at most ${PHOTOS_MAX} photos.`,
};

/** A short, plain-language message for a failed submission. */
export function failureMessage(result: Extract<CreateReportResult, { ok: false }>): string {
  switch (result.reason) {
    case "malformed":
      return "Something was wrong with the form. Refresh the page and try again.";
    case "invalid":
      return "Please fix the problems marked above.";
    case "rate_limited":
      return "You have sent several reports recently. Please wait a while before sending another.";
    case "category_unavailable":
      return "That category is no longer available. Pick another one.";
    case "photo_rejected":
      return "One of your photos was not accepted. Remove it and add it again.";
    case "media_unavailable":
      return "We could not check your photos right now. Try again in a moment.";
  }
}
