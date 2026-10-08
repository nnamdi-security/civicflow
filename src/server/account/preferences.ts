import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../../db/client";
import { users } from "../../db/schema";
import { UnauthenticatedError } from "../auth/errors";
import type { AuthenticatedActor } from "../auth/session-user";

const schema = z.object({ notifyEmail: z.boolean(), notifySms: z.boolean() });

export type UpdatePreferencesResult =
  | { ok: true }
  | { ok: false; reason: "malformed" | "phone_not_verified" };

/**
 * Sets the caller's own report-notification choices. Turning SMS on needs a verified number
 * (also enforced by a database constraint). Staff escalation emails ignore these settings.
 */
export async function updateNotificationPreferences(
  deps: { db: Db },
  actor: AuthenticatedActor | null,
  raw: unknown,
): Promise<UpdatePreferencesResult> {
  if (!actor) throw new UnauthenticatedError();
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "malformed" };

  if (parsed.data.notifySms) {
    const [row] = await deps.db
      .select({ verifiedAt: users.phoneVerifiedAt, phone: users.phoneE164 })
      .from(users)
      .where(eq(users.id, actor.userId))
      .limit(1);
    if (!row || row.verifiedAt === null || row.phone === null) return { ok: false, reason: "phone_not_verified" };
  }

  await deps.db
    .update(users)
    .set({ notifyEmail: parsed.data.notifyEmail, notifySms: parsed.data.notifySms })
    .where(eq(users.id, actor.userId));
  return { ok: true };
}
