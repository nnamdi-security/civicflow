import type { ReportStatus } from "@/domain/reports/status";

const LABELS: Record<ReportStatus, string> = {
  submitted: "Submitted",
  routed: "Sent to agency",
  acknowledged: "Acknowledged",
  in_progress: "In progress",
  resolved: "Resolved",
  confirmed: "Confirmed fixed",
  disputed: "Disputed",
  rejected: "Rejected",
};

/** Status is always spelled out; colour is never the only signal. */
export function StatusBadge({ status }: { status: ReportStatus }) {
  return (
    <span className="inline-block rounded-md border border-current px-2 py-0.5 text-sm font-medium">
      Status: {LABELS[status]}
    </span>
  );
}
