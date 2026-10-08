import { sql } from "drizzle-orm";
import {
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
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("users_agency_idx").on(table.agencyId),
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
