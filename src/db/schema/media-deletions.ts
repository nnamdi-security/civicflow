/**
 * The queue of photos waiting to be deleted from the media provider (ADR 0015).
 *
 * When a resident erases their account, their photos must be deleted from Cloudinary. That is a
 * call to another company's server, which can fail or be slow. So we do not do it inside the
 * erasure itself. Instead the erasure writes one row per photo here, in the SAME database
 * transaction, and a background job works through the queue with retries. That way:
 *   - a photo is never forgotten if the provider is down at that moment;
 *   - the erasure never half-happens because of a network problem.
 *
 * A row is deleted as soon as its photo is gone. Rows that stay are either still waiting
 * ('pending') or have failed for good ('failed') and need a person to look at them.
 */
import { index, pgEnum, pgTable, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const MEDIA_DELETION_STATUSES = ["pending", "failed"] as const;
export const mediaDeletionStatusEnum = pgEnum("media_deletion_status", MEDIA_DELETION_STATUSES);

export const mediaDeletions = pgTable(
  "media_deletions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The provider's id for the photo. Unique, so queueing the same photo twice does nothing. */
    publicId: text("public_id").notNull().unique(),
    status: mediaDeletionStatusEnum("status").notNull().default("pending"),
    attempts: smallint("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    /** A short machine code such as "provider_unavailable". Never the provider's text. */
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    // The job asks "which pending rows are due?", so index exactly that.
    index("media_deletions_due_idx").on(table.nextAttemptAt).where(sql`${table.status} = 'pending'`),
  ],
);
