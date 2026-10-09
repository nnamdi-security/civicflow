/**
 * Platform-admin action: change the SLA deadlines for one category (ADR 0014, ADR 0010).
 *
 * An SLA policy says how many minutes an agency has to ACKNOWLEDGE and to RESOLVE a report of a
 * given category (for example Roads: 1440 minutes = 24 hours to acknowledge). Changing it is a
 * sensitive act because it decides when agencies are flagged as overdue, so:
 *   - only platform admins may do it;
 *   - a written reason is REQUIRED;
 *   - it is recorded in the audit log, in the same transaction as the change;
 *   - it only affects timers that START afterwards. Reports whose timers are already running keep
 *     the deadline they were given. This function deliberately never touches the `reports` table.
 */
import { eq } from "drizzle-orm";
import { z } from "zod";
import { categories, slaPolicies } from "../../db/schema";
import { describeSlaChange, validateSlaPolicyInput, type SlaPolicyIssue } from "../../domain/admin";
import { canManageSlaPolicy } from "../../domain/permissions";
import { ForbiddenError, UnauthenticatedError } from "../auth/errors";
import type { AuthenticatedActor } from "../auth/session-user";
import { recordAudit } from "../repositories/audit";
import type { AdminDeps } from "./agencies";

export type UpdateSlaPolicyResult =
  | { ok: true; changed: boolean }
  | { ok: false; reason: "malformed" | "not_found" | SlaPolicyIssue };

const schema = z.object({
  categoryId: z.uuid(),
  // `unknown` here because the real checking (ranges, whole numbers) is done by validateSlaPolicyInput.
  ackMinutes: z.unknown(),
  resolveMinutes: z.unknown(),
  note: z.unknown(),
});

export async function updateSlaPolicy(
  deps: AdminDeps,
  actorOrNull: AuthenticatedActor | null,
  raw: unknown,
): Promise<UpdateSlaPolicyResult> {
  // 1 + 2: signed in, and allowed.
  if (!actorOrNull) throw new UnauthenticatedError();
  if (!canManageSlaPolicy(actorOrNull)) throw new ForbiddenError();
  const actor = actorOrNull;

  // 3: validate the shape, then the values and the required note.
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "malformed" };
  const checked = validateSlaPolicyInput(parsed.data);
  if (!checked.ok) return { ok: false, reason: checked.issue };
  const { categoryId } = parsed.data;

  // Read the current policy (and the category name for the audit sentence).
  const [current] = await deps.db
    .select({
      categoryName: categories.name,
      ackMinutes: slaPolicies.ackMinutes,
      resolveMinutes: slaPolicies.resolveMinutes,
    })
    .from(slaPolicies)
    .innerJoin(categories, eq(categories.id, slaPolicies.categoryId))
    .where(eq(slaPolicies.categoryId, categoryId))
    .limit(1);
  if (!current) return { ok: false, reason: "not_found" };

  // Saving identical numbers would only clutter the audit log, so do nothing.
  if (current.ackMinutes === checked.value.ackMinutes && current.resolveMinutes === checked.value.resolveMinutes) {
    return { ok: true, changed: false };
  }

  // 4: change the policy and write the audit entry together.
  await deps.db.transaction(async (tx) => {
    await tx
      .update(slaPolicies)
      .set({
        ackMinutes: checked.value.ackMinutes,
        resolveMinutes: checked.value.resolveMinutes,
        updatedAt: new Date(),
      })
      .where(eq(slaPolicies.categoryId, categoryId));
    await recordAudit(tx, {
      actor,
      action: "sla_policy.updated",
      targetType: "sla_policy",
      targetId: categoryId,
      summary: `${current.categoryName}: ${describeSlaChange(current, checked.value, checked.value.note)}`,
    });
  });
  return { ok: true, changed: true };
}
