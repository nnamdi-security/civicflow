/**
 * Report statuses from docs/domain-model.md. Transitions between them belong to the state
 * machine in `transitions.ts`.
 */
export const REPORT_STATUSES = [
  "submitted",
  "routed",
  "acknowledged",
  "in_progress",
  "resolved",
  "confirmed",
  "disputed",
  "rejected",
] as const;

export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const INITIAL_REPORT_STATUS = "submitted" satisfies ReportStatus;
