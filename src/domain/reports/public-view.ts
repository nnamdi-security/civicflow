import type { Clock } from "../clock";
import { overdueTimers, type SlaTimer } from "../sla";
import type { ReportStatus } from "./status";

/**
 * What the public may see of a report (ADR 0013). This is an allow-list: `toPublicReport`
 * copies the named fields below and nothing else, so a column added to reports later cannot
 * reach a public page by accident. Never add the reporter, handling staff, description, photos,
 * exact location or staff notes here.
 */
export interface PublicReportSource {
  reference: string;
  categoryName: string;
  status: ReportStatus;
  agencyName: string | null;
  /** LGA or state name; never coordinates. */
  areaName: string | null;
  createdAt: Date;
  ackDueAt: Date | null;
  resolveDueAt: Date | null;
  /** Highest escalation level recorded for the current cycle, per timer. */
  ackLevel: number | null;
  resolveLevel: number | null;
  timeline: ReadonlyArray<{ toStatus: ReportStatus; createdAt: Date }>;
}

export interface PublicReport {
  reference: string;
  categoryName: string;
  status: ReportStatus;
  agencyName: string | null;
  areaName: string | null;
  createdAt: Date;
  /** Status changes only: no actor and no notes. */
  timeline: Array<{ status: ReportStatus; at: Date }>;
  /** Present only when SLA information is public (the overdue board switch). */
  sla: PublicSla | null;
}

export interface PublicSla {
  acknowledgeBy: Date | null;
  resolveBy: Date | null;
  overdue: SlaTimer[];
  /** Marked publicly overdue (escalation level 3) on either timer. */
  publiclyOverdue: boolean;
}

export function toPublicReport(
  source: PublicReportSource,
  options: { showSla: boolean },
  clock: Clock,
): PublicReport {
  const sla: PublicSla | null = options.showSla
    ? {
        acknowledgeBy: source.ackDueAt,
        resolveBy: source.resolveDueAt,
        overdue: overdueTimers(source, clock),
        publiclyOverdue: source.ackLevel === 3 || source.resolveLevel === 3,
      }
    : null;

  return {
    reference: source.reference,
    categoryName: source.categoryName,
    status: source.status,
    agencyName: source.agencyName,
    areaName: source.areaName,
    createdAt: source.createdAt,
    timeline: source.timeline.map((entry) => ({ status: entry.toStatus, at: entry.createdAt })),
    sla,
  };
}
