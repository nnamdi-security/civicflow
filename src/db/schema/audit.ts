/**
 * The audit log: a permanent record of administrative changes (ADR 0014).
 *
 * Whenever a platform admin or agency admin changes something that affects accountability
 * (an agency, its coverage, an SLA deadline, a category, a staff account), one row is added here
 * in the SAME database transaction as the change. So the change and its record exist together or
 * not at all.
 *
 * It is APPEND-ONLY: a database trigger (in the migration) refuses to UPDATE or DELETE rows, so
 * history cannot be quietly edited. It deliberately stores NO personal data: no emails, no phone
 * numbers. Only ids, role names and a short plain-language summary.
 */
import { index, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { AUDIT_ACTIONS } from "../../domain/admin";
import { users } from "./auth";

export const auditActionEnum = pgEnum("audit_action", AUDIT_ACTIONS);

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The signed-in admin who made the change. */
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id),
    /** The role they had at the time (roles can change later; the log keeps what was true then). */
    actorRole: text("actor_role").notNull(),
    action: auditActionEnum("action").notNull(),
    /** What kind of record was changed, for example "agency" or "sla_policy". */
    targetType: text("target_type").notNull(),
    /** The id of the changed record, when there is a single one. */
    targetId: uuid("target_id"),
    /** One plain sentence about what changed. Never personal data. */
    summary: text("summary").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    // The audit page lists the newest entries first, so index by time.
    index("audit_log_created_idx").on(table.createdAt),
    index("audit_log_target_idx").on(table.targetType, table.targetId),
  ],
);
