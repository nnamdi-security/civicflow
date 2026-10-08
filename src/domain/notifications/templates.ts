import type { SlaTimer } from "../sla";
import type { NotificationEvent, RecipientKind } from "./events";

/** Template wording version; bump when a message changes materially. */
export const TEMPLATE_VERSION = 1;

export interface MessageContext {
  reference: string;
  /** Absolute link to the report page for this recipient (see `reportUrl`). */
  url: string;
  /** Agency currently holding the report, if any. */
  agencyName?: string | null;
  /** Staff-entered rejection note. Never the reporter's description or location. */
  reason?: string | null;
  /** Which timer an escalation is about. */
  timer?: SlaTimer | null;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

export function reportUrl(baseUrl: string, recipient: RecipientKind, reportId: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  return recipient === "reporter" ? `${base}/reports/${reportId}` : `${base}/agency/reports/${reportId}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const TIMER_WORD: Record<SlaTimer, string> = { acknowledge: "acknowledged", resolve: "resolved" };

interface Copy {
  subject: string;
  /** Body paragraphs. */
  lines: string[];
  linkLabel: string;
}

function copyFor(event: NotificationEvent, ctx: MessageContext): Copy {
  const ref = ctx.reference;
  const agency = ctx.agencyName ? ctx.agencyName : "the responsible agency";
  const timer = TIMER_WORD[ctx.timer ?? "acknowledge"];
  switch (event) {
    case "report_received":
      return {
        subject: `We received your report ${ref}`,
        lines: [`Thank you. Your report ${ref} has been received.`, "We will send it to the agency responsible and keep you updated."],
        linkLabel: "View your report",
      };
    case "report_routed":
      return {
        subject: `Your report ${ref} was sent to ${agency}`,
        lines: [`Your report ${ref} has been sent to ${agency}.`],
        linkLabel: "Track your report",
      };
    case "report_acknowledged":
      return {
        subject: `${agency} has acknowledged your report ${ref}`,
        lines: [`${agency} has acknowledged your report ${ref} and will deal with it.`],
        linkLabel: "Track your report",
      };
    case "report_resolved":
      return {
        subject: `Your report ${ref} was marked resolved`,
        lines: [`${agency} has marked your report ${ref} as resolved.`, "Please check the location and confirm whether it has really been fixed."],
        linkLabel: "Confirm or dispute",
      };
    case "report_rejected":
      return {
        subject: `Your report ${ref} could not be taken forward`,
        lines: [
          `Your report ${ref} could not be taken forward.`,
          ...(ctx.reason ? [`Reason given: ${ctx.reason}`] : []),
        ],
        linkLabel: "View your report",
      };
    case "report_disputed":
      return {
        subject: `Report ${ref} was disputed by the reporter`,
        lines: [`The reporter says report ${ref} is not fixed. It has been reopened.`],
        linkLabel: "Open the report",
      };
    case "escalation_level_1":
      return {
        subject: `Overdue: report ${ref} has not been ${timer}`,
        lines: [`Report ${ref} has passed its deadline and has not been ${timer}.`, "Please act on it or reassign it."],
        linkLabel: "Open the report",
      };
    case "escalation_level_2":
      return {
        subject: `Escalated: report ${ref} is still not ${timer}`,
        lines: [`Report ${ref} is more than a day past its deadline and has not been ${timer}.`],
        linkLabel: "Open the report",
      };
    case "escalation_level_3":
      return {
        subject: `Your report ${ref} is overdue`,
        lines: [
          `${agency} has not ${timer === "acknowledged" ? "acknowledged" : "resolved"} your report ${ref} in time. It is now marked publicly overdue.`,
          "We are sorry about the delay.",
        ],
        linkLabel: "View your report",
      };
  }
}

export function renderEmail(event: NotificationEvent, ctx: MessageContext): RenderedEmail {
  const copy = copyFor(event, ctx);
  const text = [...copy.lines, `${copy.linkLabel}: ${ctx.url}`].join("\n\n");
  const html = [
    ...copy.lines.map((line) => `<p>${escapeHtml(line)}</p>`),
    `<p><a href="${escapeHtml(ctx.url)}">${escapeHtml(copy.linkLabel)}</a></p>`,
  ].join("");
  return { subject: copy.subject, text, html };
}

/** The longest an SMS may be to stay in one GSM-7 segment. */
export const SMS_MAX_LENGTH = 160;

/** SMS text for events that use SMS, otherwise null. Plain ASCII so it stays one segment. */
export function renderSms(event: NotificationEvent, ctx: MessageContext): string | null {
  const ref = ctx.reference;
  switch (event) {
    case "report_resolved":
      return `CivicFlow: report ${ref} is marked resolved. Is it fixed? Confirm: ${ctx.url}`;
    case "escalation_level_3":
      return `CivicFlow: report ${ref} is overdue and now public. Details: ${ctx.url}`;
    default:
      return null;
  }
}
