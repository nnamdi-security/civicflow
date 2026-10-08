import { eq } from "drizzle-orm";
import type { Db } from "../../db/client";
import { phoneVerifications, users } from "../../db/schema";
import { maskPhone } from "../../domain/notifications/phone";

export interface NotificationSettings {
  notifyEmail: boolean;
  notifySms: boolean;
  /** Masked, never the full number. Null when no number is saved. */
  maskedPhone: string | null;
  phoneVerified: boolean;
  /** A code was sent to this masked number and is awaiting entry. */
  pending: { maskedPhone: string; expiresAt: Date } | null;
}

/** The caller's own settings only; the user id comes from the session, never from input. */
export async function findNotificationSettings(db: Db, userId: string): Promise<NotificationSettings | null> {
  const [row] = await db
    .select({
      notifyEmail: users.notifyEmail,
      notifySms: users.notifySms,
      phone: users.phoneE164,
      verifiedAt: users.phoneVerifiedAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row) return null;

  const [pending] = await db
    .select({ phone: phoneVerifications.phoneE164, expiresAt: phoneVerifications.expiresAt })
    .from(phoneVerifications)
    .where(eq(phoneVerifications.userId, userId))
    .limit(1);

  return {
    notifyEmail: row.notifyEmail,
    notifySms: row.notifySms,
    maskedPhone: row.phone ? maskPhone(row.phone) : null,
    phoneVerified: row.verifiedAt !== null,
    pending: pending ? { maskedPhone: maskPhone(pending.phone), expiresAt: pending.expiresAt } : null,
  };
}
