import type { ReportStatus } from "../reports/status";
import type { EscalationLevel, SlaTimer } from "../sla";

export const NOTIFICATION_EVENTS = [
  "report_received",
  "report_routed",
  "report_acknowledged",
  "report_resolved",
  "report_rejected",
  "report_disputed",
  "escalation_level_1",
  "escalation_level_2",
  "escalation_level_3",
] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

export const NOTIFICATION_CHANNELS = ["email", "sms"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/** Who a message is for. Resolved to real users only when the message is sent. */
export const RECIPIENT_KINDS = ["reporter", "agency_admins", "platform_admins"] as const;
export type RecipientKind = (typeof RECIPIENT_KINDS)[number];

export interface NotificationIntent {
  recipient: RecipientKind;
  channel: NotificationChannel;
}

const email = (recipient: RecipientKind): NotificationIntent => ({ recipient, channel: "email" });
const sms = (recipient: RecipientKind): NotificationIntent => ({ recipient, channel: "sms" });

/** docs/integrations.md: who is told what, and where SMS is used (ADR 0012). */
export const NOTIFICATION_RULES: Readonly<Record<NotificationEvent, readonly NotificationIntent[]>> = {
  report_received: [email("reporter")],
  report_routed: [email("reporter")],
  report_acknowledged: [email("reporter")],
  report_resolved: [email("reporter"), sms("reporter")],
  report_rejected: [email("reporter")],
  report_disputed: [email("agency_admins")],
  escalation_level_1: [email("agency_admins")],
  escalation_level_2: [email("platform_admins")],
  escalation_level_3: [email("reporter"), sms("reporter")],
};

/** The event for a report entering `status`, or null when nobody is told (in_progress, confirmed, submitted). */
export function eventForStatus(status: ReportStatus): NotificationEvent | null {
  switch (status) {
    case "routed":
      return "report_routed";
    case "acknowledged":
      return "report_acknowledged";
    case "resolved":
      return "report_resolved";
    case "rejected":
      return "report_rejected";
    case "disputed":
      return "report_disputed";
    case "submitted":
    case "in_progress":
    case "confirmed":
      return null;
  }
}

export function eventForEscalation(level: EscalationLevel): NotificationEvent {
  return `escalation_level_${level}`;
}

/**
 * Part of the dedupe key beyond report, event, recipient, channel and SLA cycle. Escalations
 * from the acknowledgement and resolution timers are different messages; every other event has
 * one per cycle.
 */
export function discriminatorFor(event: NotificationEvent, timer?: SlaTimer): string {
  return event.startsWith("escalation_level_") && timer ? timer : "";
}
