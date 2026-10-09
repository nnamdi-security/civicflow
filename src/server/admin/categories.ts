/**
 * Platform-admin action: switch a report category on or off (ADR 0014).
 *
 * A category is the "kind of problem" a resident picks when reporting (Roads, Water, ...).
 * Switching one OFF hides it from the report form; reports already filed under it are untouched.
 * The platform must always keep at least one category on, otherwise nobody could file a report.
 */
import { and, count, eq } from "drizzle-orm";
import { z } from "zod";
import { categories } from "../../db/schema";
import { canManageCategories } from "../../domain/permissions";
import { ForbiddenError, UnauthenticatedError } from "../auth/errors";
import type { AuthenticatedActor } from "../auth/session-user";
import { recordAudit } from "../repositories/audit";
import type { AdminDeps } from "./agencies";

export type SetCategoryActiveResult =
  | { ok: true; changed: boolean }
  | { ok: false; reason: "malformed" | "not_found" | "last_active_category" };

const schema = z.object({ categoryId: z.uuid(), active: z.boolean() });

export async function setCategoryActive(
  deps: AdminDeps,
  actorOrNull: AuthenticatedActor | null,
  raw: unknown,
): Promise<SetCategoryActiveResult> {
  if (!actorOrNull) throw new UnauthenticatedError();
  if (!canManageCategories(actorOrNull)) throw new ForbiddenError();
  const actor = actorOrNull;

  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "malformed" };
  const { categoryId, active } = parsed.data;

  const [category] = await deps.db
    .select({ name: categories.name, active: categories.active })
    .from(categories)
    .where(eq(categories.id, categoryId))
    .limit(1);
  if (!category) return { ok: false, reason: "not_found" };
  if (category.active === active) return { ok: true, changed: false };

  // Never allow the last active category to be switched off.
  if (!active) {
    const [others] = await deps.db
      .select({ n: count() })
      .from(categories)
      .where(and(eq(categories.active, true)));
    // `others` counts ALL active categories, including this one; if this is the only one, refuse.
    if (Number(others?.n ?? 0) <= 1) return { ok: false, reason: "last_active_category" };
  }

  await deps.db.transaction(async (tx) => {
    await tx.update(categories).set({ active }).where(eq(categories.id, categoryId));
    await recordAudit(tx, {
      actor,
      action: active ? "category.activated" : "category.deactivated",
      targetType: "category",
      targetId: categoryId,
      summary: `${active ? "switched on" : "switched off"} category "${category.name}"`,
    });
  });
  return { ok: true, changed: true };
}
