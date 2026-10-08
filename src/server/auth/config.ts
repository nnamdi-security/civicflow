import { DrizzleAdapter } from "@auth/drizzle-adapter";
import type { NextAuthConfig } from "next-auth";
import { z } from "zod";
import type { Db } from "../../db/client";
import { accounts, sessions, users, verificationTokens } from "../../db/schema";
import { signInEmail, type EmailSender } from "../adapters/email";
import { rateLimitKey, type RateLimiter } from "../rate-limit/rate-limiter";
import { SIGN_IN_LINK_MAX_AGE_SECONDS } from "./constants";
import { toSessionUser } from "./session-user";

const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/** Per-address cap on sign-in emails. Applies to every path that triggers a send. */
export const EMAIL_RATE_RULE = { limit: 3, windowMs: 15 * 60 * 1000 } as const;

export class SignInRateLimitedError extends Error {
  constructor() {
    super("Too many sign-in requests");
    this.name = "SignInRateLimitedError";
  }
}

export interface AuthDeps {
  db: Db;
  emailSender: EmailSender;
  limiter: RateLimiter;
  secret: string;
}

const emailSchema = z.string().trim().toLowerCase().pipe(z.email());

/** Lowercases and validates; the users table also enforces lowercase emails. */
export function normalizeEmail(identifier: string): string {
  return emailSchema.parse(identifier);
}

export function buildAuthConfig(deps: AuthDeps): NextAuthConfig {
  return {
    secret: deps.secret,
    adapter: DrizzleAdapter(deps.db, {
      usersTable: users,
      accountsTable: accounts,
      sessionsTable: sessions,
      verificationTokensTable: verificationTokens,
    }),
    session: { strategy: "database", maxAge: SESSION_MAX_AGE_SECONDS, updateAge: 24 * 60 * 60 },
    pages: { signIn: "/sign-in", verifyRequest: "/sign-in/check-email", error: "/sign-in" },
    providers: [
      {
        id: "email",
        type: "email",
        name: "Email",
        maxAge: SIGN_IN_LINK_MAX_AGE_SECONDS,
        normalizeIdentifier: normalizeEmail,
        async sendVerificationRequest({ identifier, url }) {
          const key = rateLimitKey(deps.secret, "signin-email", identifier);
          const { allowed } = await deps.limiter.consume(key, EMAIL_RATE_RULE);
          if (!allowed) throw new SignInRateLimitedError();
          await deps.emailSender.send(signInEmail({ to: identifier, url }));
        },
      },
    ],
    callbacks: {
      // With database sessions Auth.js passes the stored user row; role and agency come from
      // there on every request, so role changes and revocation apply immediately.
      session({ session, user }) {
        const { id, role, agencyId } = toSessionUser(user);
        return { ...session, user: { ...session.user, id, role, agencyId } };
      },
    },
    // Auth.js errors can embed addresses; log only the error type, never message or metadata.
    logger: {
      error(error) {
        console.error(`[auth] ${error.name}`);
      },
      warn(code) {
        console.warn(`[auth] ${code}`);
      },
      debug() {},
    },
  };
}
