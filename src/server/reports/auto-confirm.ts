import { and, eq, lt } from "drizzle-orm";
import type { Db } from "../../db/client";
import { reports } from "../../db/schema";
import type { Clock } from "../../domain/clock";
import { AUTO_CONFIRM_REASON, autoConfirmCutoff, isAutoConfirmDue } from "../../domain/reports/auto-confirm";
import { validateTransition } from "../../domain/reports/transitions";
import { applyStatusChange } from "../repositories/report-workflow";

/** Reports looked at per database query. Small enough to stay quick. */
const DEFAULT_BATCH = 200;
/**
 * Batches per run. After a long outage there may be thousands of reports due; working through
 * several batches per run clears a backlog in a few hours instead of days, while still keeping a
 * single run bounded (10 x 200 = 2,000 reports) so it never monopolises the database.
 */
const DEFAULT_MAX_BATCHES = 10;

export interface AutoConfirmDeps {
  db: Db;
  clock: Clock;
  /** Reports per batch. Only tests change this. */
  batchSize?: number;
  /** Maximum batches per run. Only tests change this. */
  maxBatches?: number;
}

export interface AutoConfirmResult {
  /** Reports confirmed by this run. Zero on a repeat run. */
  confirmed: number;
}

/**
 * Confirms reports still `resolved` more than 14 days after they were resolved (PROVISIONAL,
 * ADR 0013). Idempotent and safe to run concurrently with the resident answering: each change is a
 * compare-and-set on `resolved`, so whoever acts first wins and the other does nothing. Works
 * through several batches per run so a backlog (after the worker was down) clears quickly.
 */
export async function runAutoConfirm(deps: AutoConfirmDeps): Promise<AutoConfirmResult> {
  const batchSize = deps.batchSize ?? DEFAULT_BATCH;
  const maxBatches = deps.maxBatches ?? DEFAULT_MAX_BATCHES;
  let confirmed = 0;

  for (let batch = 0; batch < maxBatches; batch++) {
    // Each pass asks for the next group of due reports. Reports confirmed in an earlier pass are no
    // longer "resolved", so they do not come back; this naturally moves on to the next group.
    const candidates = await deps.db
      .select({ id: reports.id, resolvedAt: reports.resolvedAt, agencyId: reports.agencyId })
      .from(reports)
      .where(and(eq(reports.status, "resolved"), lt(reports.resolvedAt, autoConfirmCutoff(deps.clock))))
      .orderBy(reports.resolvedAt)
      .limit(batchSize);

    for (const candidate of candidates) {
      // The domain function is the authority on "due"; SQL only narrowed the list.
      if (!isAutoConfirmDue(candidate.resolvedAt, deps.clock)) continue;
      const check = validateTransition({
        from: "resolved",
        to: "confirmed",
        actor: { kind: "system" },
        reportAgencyId: candidate.agencyId,
        reason: AUTO_CONFIRM_REASON,
      });
      if (!check.ok) throw new Error(`Auto-confirm transition rejected: ${check.denial}`);

      const applied = await deps.db.transaction((tx) =>
        applyStatusChange(
          tx,
          { reportId: candidate.id, from: check.from, to: check.to, actorId: null, reason: check.reason },
          deps.clock,
        ),
      );
      if (applied) confirmed += 1;
    }

    // A short batch means there is nothing more due right now.
    if (candidates.length < batchSize) break;
  }
  return { confirmed };
}
