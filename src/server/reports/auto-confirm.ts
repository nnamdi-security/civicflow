import { and, eq, lt } from "drizzle-orm";
import type { Db } from "../../db/client";
import { reports } from "../../db/schema";
import type { Clock } from "../../domain/clock";
import { AUTO_CONFIRM_REASON, autoConfirmCutoff, isAutoConfirmDue } from "../../domain/reports/auto-confirm";
import { validateTransition } from "../../domain/reports/transitions";
import { applyStatusChange } from "../repositories/report-workflow";

/** Per run, so one pass stays short; leftovers are taken on the next pass. */
const BATCH = 200;

export interface AutoConfirmDeps {
  db: Db;
  clock: Clock;
}

export interface AutoConfirmResult {
  /** Reports confirmed by this run. Zero on a repeat run. */
  confirmed: number;
}

/**
 * Confirms reports still `resolved` more than 14 days after they were resolved (PROVISIONAL,
 * ADR 0013). Idempotent and safe to run concurrently with the resident answering: each change is a
 * compare-and-set on `resolved`, so whoever acts first wins and the other does nothing.
 */
export async function runAutoConfirm(deps: AutoConfirmDeps): Promise<AutoConfirmResult> {
  const candidates = await deps.db
    .select({ id: reports.id, resolvedAt: reports.resolvedAt, agencyId: reports.agencyId })
    .from(reports)
    .where(and(eq(reports.status, "resolved"), lt(reports.resolvedAt, autoConfirmCutoff(deps.clock))))
    .orderBy(reports.resolvedAt)
    .limit(BATCH);

  let confirmed = 0;
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
  return { confirmed };
}
