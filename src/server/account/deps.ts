import { randomBytes } from "node:crypto";
import { systemClock } from "../../domain/clock";
import { createSmsSender } from "../adapters/sms";
import { getDb } from "../db";
import { parseMediaEnv, parseSmsEnv } from "../env";
import { PostgresRateLimiter } from "../rate-limit/postgres-rate-limiter";
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
