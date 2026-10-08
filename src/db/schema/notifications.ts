import { sql } from "drizzle-orm";
import { index, integer, pgEnum, pgTable, smallint, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_EVENTS,
  NOTIFICATION_STATUSES,
} from "../../domain/notifications/events";
import { users } from "./auth";
import { reports } from "./reports";

export const notificationEventEnum = pgEnum("notification_event", NOTIFICATION_EVENTS);
export const notificationChannelEnum = pgEnum("notification_channel", NOTIFICATION_CHANNELS);
export const notificationStatusEnum = pgEnum("notification_status", NOTIFICATION_STATUSES);

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/**
 * The notification outbox (ADR 0011). Rows are written in the same transaction as the change
 * that causes them. They hold ids and codes only: never bodies, addresses or phone numbers.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reportId: uuid("report_id")
      .notNull()
      .references(() => reports.id),
    event: notificationEventEnum("event").notNull(),
    channel: notificationChannelEnum("channel").notNull(),
    recipientUserId: uuid("recipient_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** The report's SLA cycle when queued, so a reassignment or dispute can notify again. */
    slaCycle: integer("sla_cycle").notNull(),
    /** Extra dedupe part: the timer for escalations, otherwise empty. */
    discriminator: text("discriminator").notNull().default(""),
    status: notificationStatusEnum("status").notNull().default("pending"),
    attempts: smallint("attempts").notNull().default(0),
    nextAttemptAt: timestamptz("next_attempt_at").notNull().defaultNow(),
    /** Short machine code such as "provider_unreachable"; never provider text. */
    lastError: text("last_error"),
    /** Why a row was skipped, such as "email_opted_out". */
    skippedReason: text("skipped_reason"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    sentAt: timestamptz("sent_at"),
  },
  (table) => [
    unique("notifications_dedupe_unique").on(
      table.reportId,
      table.event,
      table.channel,
      table.recipientUserId,
      table.slaCycle,
      table.discriminator,
    ),
    index("notifications_due_idx").on(table.nextAttemptAt).where(sql`${table.status} = 'pending'`),
    index("notifications_report_idx").on(table.reportId),
  ],
);
