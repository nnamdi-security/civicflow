import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../../db/client";
import { phoneVerifications, users } from "../../db/schema";
import type { Clock } from "../../domain/clock";
import { maskPhone, normalizeNigerianPhone } from "../../domain/notifications/phone";
import { renderVerificationSms } from "../../domain/notifications/templates";
import {
  CODE_TTL_MINUTES,
  MAX_CODE_ATTEMPTS,
  codeExpiresAt,
  generateVerificationCode,
  isCodeExpired,
  isValidCodeFormat,
} from "../../domain/notifications/verification";
import type { SmsSender } from "../adapters/sms/sms-sender";
import { UnauthenticatedError } from "../auth/errors";
import type { AuthenticatedActor } from "../auth/session-user";
import type { RateLimiter } from "../rate-limit/rate-limiter";
import { rateLimitKey } from "../rate-limit/rate-limiter";

export const PHONE_RATE_RULES = {
  /** Codes one ACCOUNT may request per hour. */
  hour: { limit: 3, windowMs: 60 * 60 * 1000 },
  /** Codes one ACCOUNT may request per day. */
  day: { limit: 6, windowMs: 24 * 60 * 60 * 1000 },
  /**
   * Codes any ONE PHONE NUMBER may be sent per day, from all accounts together. Accounts are free
   * to create (an email address is enough), so limiting only per account would let one person make
   * many accounts and flood a victim's phone with texts, or run up the SMS bill ("SMS pumping").
   * This cap protects the number itself.
   */
  number: { limit: 3, windowMs: 24 * 60 * 60 * 1000 },
} as const;

export interface PhoneDeps {
  db: Db;
  clock: Clock;
  /** Null when SMS is switched off for the deployment. */
  sms: SmsSender | null;
  limiter: RateLimiter;
  /** Keys rate-limit hashes and code hashes. */
  secret: string;
  randomBytes: (length: number) => Uint8Array;
}

/** Binds the hash to the user and number, so a code cannot be replayed for another number. */
function hashCode(secret: string, userId: string, phone: string, code: string): string {
  return createHmac("sha256", secret).update(`phone-code:${userId}:${phone}:${code}`).digest("hex");
}

const startSchema = z.object({ phone: z.string().max(40) });
const confirmSchema = z.object({ code: z.string().max(20) });

export type StartPhoneResult =
  | { ok: true; maskedPhone: string }
  | { ok: false; reason: "malformed" | "invalid_phone" | "already_verified" | "rate_limited" | "sms_unavailable" | "delivery_failed" };

/**
 * Step 1: text a code to the number. Order: authenticate, validate, rate limit, persist the
 * hashed code, send. A failed send removes the pending code so nobody is left waiting.
 */
export async function startPhoneVerification(
  deps: PhoneDeps,
  actor: AuthenticatedActor | null,
  raw: unknown,
): Promise<StartPhoneResult> {
  if (!actor) throw new UnauthenticatedError();
  const parsed = startSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "malformed" };
  const phone = normalizeNigerianPhone(parsed.data.phone);
  if (phone === null) return { ok: false, reason: "invalid_phone" };
  if (deps.sms === null) return { ok: false, reason: "sms_unavailable" };

  const [current] = await deps.db
    .select({ phone: users.phoneE164, verifiedAt: users.phoneVerifiedAt })
    .from(users)
    .where(eq(users.id, actor.userId))
    .limit(1);
  if (current?.phone === phone && current.verifiedAt !== null) return { ok: false, reason: "already_verified" };

  const key = rateLimitKey(deps.secret, "phone-verify", actor.userId);
  if (!(await deps.limiter.consume(key, PHONE_RATE_RULES.hour)).allowed) return { ok: false, reason: "rate_limited" };
  if (!(await deps.limiter.consume(`${key}:day`, PHONE_RATE_RULES.day)).allowed) return { ok: false, reason: "rate_limited" };
  // The limit on the NUMBER itself, whoever asks. The key is a keyed hash of the number, so the
  // limiter never stores the phone number. The refusal is the same "rate_limited" answer, so it
  // does not say whether somebody else asked for that number.
  const numberKey = rateLimitKey(deps.secret, "phone-verify-number", phone);
  if (!(await deps.limiter.consume(numberKey, PHONE_RATE_RULES.number)).allowed) return { ok: false, reason: "rate_limited" };

  const code = generateVerificationCode(deps.randomBytes);
  const values = {
    userId: actor.userId,
    phoneE164: phone,
    codeHash: hashCode(deps.secret, actor.userId, phone, code),
    expiresAt: codeExpiresAt(deps.clock),
    attempts: 0,
    createdAt: deps.clock.now(),
  };
  await deps.db
    .insert(phoneVerifications)
    .values(values)
    .onConflictDoUpdate({ target: phoneVerifications.userId, set: values });

  try {
    await deps.sms.send({ to: phone, text: renderVerificationSms(code, CODE_TTL_MINUTES) });
  } catch {
    await deps.db.delete(phoneVerifications).where(eq(phoneVerifications.userId, actor.userId));
    return { ok: false, reason: "delivery_failed" };
  }
  return { ok: true, maskedPhone: maskPhone(phone) };
}

export type ConfirmPhoneResult =
  | { ok: true }
  | { ok: false; reason: "malformed" | "no_pending" | "expired" | "too_many_attempts" | "wrong_code" };

/**
 * Step 2: check the code. A correct code verifies the number and turns SMS off again, so SMS
 * always needs an explicit opt-in (ADR 0012). Wrong guesses are counted and capped.
 */
export async function confirmPhoneVerification(
  deps: PhoneDeps,
  actor: AuthenticatedActor | null,
  raw: unknown,
): Promise<ConfirmPhoneResult> {
  if (!actor) throw new UnauthenticatedError();
  const parsed = confirmSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "malformed" };
  const code = parsed.data.code.replace(/\s/g, "");
  if (!isValidCodeFormat(code)) return { ok: false, reason: "malformed" };

  const [pending] = await deps.db
    .select()
    .from(phoneVerifications)
    .where(eq(phoneVerifications.userId, actor.userId))
    .limit(1);
  if (!pending) return { ok: false, reason: "no_pending" };
  if (isCodeExpired(pending.expiresAt, deps.clock)) {
    await deps.db.delete(phoneVerifications).where(eq(phoneVerifications.userId, actor.userId));
    return { ok: false, reason: "expired" };
  }
  if (pending.attempts >= MAX_CODE_ATTEMPTS) {
    await deps.db.delete(phoneVerifications).where(eq(phoneVerifications.userId, actor.userId));
    return { ok: false, reason: "too_many_attempts" };
  }

  const expected = Buffer.from(pending.codeHash, "hex");
  const actual = Buffer.from(hashCode(deps.secret, actor.userId, pending.phoneE164, code), "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    await deps.db
      .update(phoneVerifications)
      .set({ attempts: pending.attempts + 1 })
      .where(eq(phoneVerifications.userId, actor.userId));
    return { ok: false, reason: "wrong_code" };
  }

  await deps.db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ phoneE164: pending.phoneE164, phoneVerifiedAt: deps.clock.now(), notifySms: false })
      .where(eq(users.id, actor.userId));
    await tx.delete(phoneVerifications).where(eq(phoneVerifications.userId, actor.userId));
  });
  return { ok: true };
}

/** Removes the number, any pending code, and SMS consent. Always allowed for your own account. */
export async function removePhone(deps: Pick<PhoneDeps, "db">, actor: AuthenticatedActor | null): Promise<void> {
  if (!actor) throw new UnauthenticatedError();
  await deps.db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ phoneE164: null, phoneVerifiedAt: null, notifySms: false })
      .where(eq(users.id, actor.userId));
    await tx.delete(phoneVerifications).where(eq(phoneVerifications.userId, actor.userId));
  });
}
