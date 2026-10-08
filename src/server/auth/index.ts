import NextAuth from "next-auth";
import { systemClock } from "../../domain/clock";
import { createEmailSender } from "../adapters/email";
import { getDb } from "../db";
import { parseAuthEnv } from "../env";
import { PostgresRateLimiter } from "../rate-limit/postgres-rate-limiter";
import { buildAuthConfig } from "./config";

// Lazy: nothing is read from env until the first auth request, so builds and /api/health
// do not need AUTH_SECRET.
export const { handlers, auth, signIn, signOut } = NextAuth(() => {
  const env = parseAuthEnv(process.env);
  const db = getDb();
  return buildAuthConfig({
    db,
    emailSender: createEmailSender(env),
    limiter: new PostgresRateLimiter(db, systemClock),
    secret: env.AUTH_SECRET,
  });
});
