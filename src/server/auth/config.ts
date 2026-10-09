import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import type { Adapter } from "next-auth/adapters";
import type { NextAuthConfig } from "next-auth";
import { z } from "zod";
import type { Db } from "../../db/client";
import { accounts, sessions, users, verificationTokens } from "../../db/schema";
import { signInEmail, type EmailSender } from "../adapters/email";
import { logger } from "../logging/logger";
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

/**
 * True when the object looks like a user row that has been deactivated (ADR 0014).
 *
 * Auth.js hands our code "user" objects of several shapes: a full database row for an existing
 * person, or a bare `{ id, email }` for someone signing in for the first time. So instead of
 * assuming a shape, we look for the one field we care about and treat everything else as "not
 * deactivated". `unknown` + checking is the safe way to read fields of a value we do not control.
 */
export function isDeactivatedUser(user: unknown): boolean {
  if (typeof user !== "object" || user === null) return false;
  const disabledAt = (user as { disabledAt?: unknown }).disabledAt;
  return disabledAt instanceof Date || (typeof disabledAt === "string" && disabledAt !== "");
}

/**
 * Wraps the stock database adapter so that a deactivated person's EXISTING sessions stop
 * working immediately.
 *
 * How sessions work here: after signing in, the browser holds a cookie containing a random
 * session token. On every request Auth.js asks the adapter "which session and user does this
 * token belong to?" (`getSessionAndUser`). If we answer "none", Auth.js treats the visitor as
 * signed out. So answering "none" for deactivated users ends their access on their very next
 * request, with no waiting for the session to expire.
 */
export function withDeactivationCheck(base: Adapter): Adapter {
  return {
    ...base,
    async getSessionAndUser(sessionToken) {
      // `base.getSessionAndUser` is optional in the type, so we check it exists before calling.
      const found = await base.getSessionAndUser?.(sessionToken);
      if (!found) return found ?? null;
      return isDeactivatedUser(found.user) ? null : found;
    },
  };
}

export function buildAuthConfig(deps: AuthDeps): NextAuthConfig {
  return {
    secret: deps.secret,
    adapter: withDeactivationCheck(
      DrizzleAdapter(deps.db, {
        usersTable: users,
        accountsTable: accounts,
        sessionsTable: sessions,
        verificationTokensTable: verificationTokens,
      }),
    ),
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

          // A deactivated account gets no sign-in link. We deliberately do NOT tell the person
          // (or anyone probing addresses): the page still says "check your email", exactly as it
          // does for an unknown address, so this cannot be used to discover who has an account.
          const [account] = await deps.db
            .select({ disabledAt: users.disabledAt })
            .from(users)
            .where(eq(users.email, identifier))
            .limit(1);
          if (account && isDeactivatedUser(account)) return;

          await deps.emailSender.send(signInEmail({ to: identifier, url }));
        },
      },
    ],
    callbacks: {
      // Last line of defence at the moment of signing in: even if a link was sent before the
      // account was deactivated, using it now is refused. Returning false makes Auth.js stop and
      // show the sign-in page with an error instead of creating a session.
      //
      // IMPORTANT: Auth.js calls this callback TWICE for email sign-in. Once when the person asks
      // for a link (`email.verificationRequest` is true) and again when they click it. We must
      // only refuse the second time. If we also refused the first, a deactivated address would
      // get an error page while an unknown address gets "check your email", which would let
      // anyone discover which addresses belong to deactivated staff. At the request step we say
      // nothing; `sendVerificationRequest` above quietly sends no email.
      signIn({ user, email }) {
        if (email?.verificationRequest) return true;
        return !isDeactivatedUser(user);
      },
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
        logger.error("auth.error", { errorName: error.name });
      },
      warn(code) {
        logger.warn("auth.warning", { warningCode: code });
      },
      debug() {},
    },
  };
}
