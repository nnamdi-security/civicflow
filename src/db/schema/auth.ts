import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { ROLES } from "../../domain/roles";
import { agencies } from "./agencies";

export const roleEnum = pgEnum("user_role", ROLES);

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

// Property names follow what @auth/drizzle-adapter reads and writes; column names are snake_case.
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name"),
    email: text("email").notNull().unique(),
    emailVerified: timestamptz("email_verified"),
    image: text("image"),
    role: roleEnum("role").notNull().default("resident"),
    agencyId: uuid("agency_id").references(() => agencies.id),
    /** Verified-or-pending mobile number in E.164 (ADR 0012). Personal data. */
    phoneE164: text("phone_e164"),
    phoneVerifiedAt: timestamptz("phone_verified_at"),
    /** Residents can switch off their report emails; staff escalation emails ignore this. */
    notifyEmail: boolean("notify_email").notNull().default(true),
    /** Only possible with a verified phone. */
    notifySms: boolean("notify_sms").notNull().default(false),
    /**
     * When the account was deactivated (ADR 0014), or null while it is active. A deactivated
     * person cannot sign in, their open sessions stop working at once, and they receive no
     * notifications. Their history on reports is kept. Reactivating sets this back to null.
     */
    disabledAt: timestamptz("disabled_at"),
    /**
     * When the person erased their account (ADR 0015), or null. An erased account keeps its row
     * (reports and history point at it) but holds no personal data: the email is a placeholder,
     * and name, picture and phone are removed. It is also deactivated, so nobody can sign in to it.
     */
    erasedAt: timestamptz("erased_at"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("users_agency_idx").on(table.agencyId),
    check("users_phone_format", sql`${table.phoneE164} is null or ${table.phoneE164} ~ '^\\+234[789][0-9]{9}$'`),
    check("users_phone_verified_needs_phone", sql`${table.phoneVerifiedAt} is null or ${table.phoneE164} is not null`),
    check("users_sms_needs_verified_phone", sql`not ${table.notifySms} or ${table.phoneVerifiedAt} is not null`),
    // Agency staff belong to exactly one agency; other roles belong to none.
    check(
      "users_agency_scope",
      sql`(${table.role} in ('agency_officer', 'agency_admin')) = (${table.agencyId} is not null)`,
    ),
    check("users_email_lowercase", sql`${table.email} = lower(${table.email})`),
  ],
);

export const accounts = pgTable(
  "accounts",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<"email" | "oauth" | "oidc" | "webauthn">().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (table) => [
    primaryKey({ columns: [table.provider, table.providerAccountId] }),
    index("accounts_user_idx").on(table.userId),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    sessionToken: text("session_token").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expires: timestamptz("expires").notNull(),
  },
  (table) => [index("sessions_user_idx").on(table.userId)],
);

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamptz("expires").notNull(),
  },
  (table) => [primaryKey({ columns: [table.identifier, table.token] })],
);

/** One pending phone verification per user. The code is stored hashed, never in clear (ADR 0012). */
export const phoneVerifications = pgTable("phone_verifications", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  phoneE164: text("phone_e164").notNull(),
  codeHash: text("code_hash").notNull(),
  expiresAt: timestamptz("expires_at").notNull(),
  attempts: integer("attempts").notNull().default(0),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
});
