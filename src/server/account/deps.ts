import { randomBytes } from "node:crypto";
import { systemClock } from "../../domain/clock";
import { createEmailSender } from "../adapters/email";
import { createSmsSender } from "../adapters/sms";
import { getDb } from "../db";
import { parseEmailEnv, parseMediaEnv, parseSmsEnv } from "../env";
import { PostgresRateLimiter } from "../rate-limit/postgres-rate-limiter";
import type { EraseDeps } from "./erase";
import type { PhoneDeps } from "./phone";

export function getSmsSender() {
  return createSmsSender(parseSmsEnv(process.env));
}

export function getPhoneDeps(): PhoneDeps {
  const db = getDb();
  return {
    db,
    clock: systemClock,
    sms: getSmsSender(),
    limiter: new PostgresRateLimiter(db, systemClock),
    secret: parseMediaEnv(process.env).AUTH_SECRET,
    randomBytes: (length) => randomBytes(length),
  };
}

/** What the account-erasure use case needs, built from the app's settings. */
export function getEraseDeps(): EraseDeps {
  const db = getDb();
  return {
    db,
    email: createEmailSender(parseEmailEnv(process.env)),
    limiter: new PostgresRateLimiter(db, systemClock),
    secret: parseMediaEnv(process.env).AUTH_SECRET,
  };
}
