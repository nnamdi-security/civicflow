/**
 * The "use case" behind the performance dashboards: the one function the pages call.
 *
 * A use case is where a feature's steps are written in order. For anything that reads or changes
 * data on someone's behalf, the project's rule (.claude/rules/api-and-actions.md) is:
 *   1. check who is asking (authenticate),
 *   2. check they are ALLOWED to do this (authorize),
 *   3. check the input is sane (validate),
 *   4. then do the work.
 * Authorization comes before anything else touches data.
 */
import type { Db } from "../../db/client";
import type { Clock } from "../../domain/clock";
import { agencyScopeFor, canViewPerformance } from "../../domain/permissions";
import { parseWindow, type PerformanceWindowDays } from "../../domain/performance";
import { ForbiddenError, UnauthenticatedError } from "../auth/errors";
import type { AuthenticatedActor } from "../auth/session-user";
import { findAgencyPerformance, type PerformanceReport } from "../repositories/performance";

export interface DashboardDeps {
  db: Db;
  clock: Clock;
}

export interface PerformanceDashboard extends PerformanceReport {
  /** The window actually used (the requested one if valid, otherwise the default). */
  days: PerformanceWindowDays;
}

/**
 * Loads the dashboard for the signed-in user.
 * - Nobody signed in            -> throws UnauthenticatedError.
 * - Officers and residents      -> throw ForbiddenError (see `canViewPerformance`).
 * - Agency admins               -> their own agency only.
 * - Platform admins             -> every agency.
 * `rawDays` comes straight from the web address, so it is validated by `parseWindow`.
 */
export async function getPerformanceDashboard(
  deps: DashboardDeps,
  actor: AuthenticatedActor | null,
  rawDays: unknown,
): Promise<PerformanceDashboard> {
  if (!actor) throw new UnauthenticatedError();
  if (!canViewPerformance(actor)) throw new ForbiddenError();

  const days = parseWindow(rawDays);
  // The scope is computed from the SESSION (who you are), never from anything the browser sent.
  const report = await findAgencyPerformance(deps.db, agencyScopeFor(actor), days, deps.clock);
  return { ...report, days };
}
