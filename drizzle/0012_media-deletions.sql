CREATE TYPE "public"."media_deletion_status" AS ENUM('pending', 'failed');--> statement-breakpoint
CREATE TABLE "media_deletions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_id" text NOT NULL,
	"status" "media_deletion_status" DEFAULT 'pending' NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_deletions_public_id_unique" UNIQUE("public_id")
);
--> statement-breakpoint
CREATE INDEX "media_deletions_due_idx" ON "media_deletions" USING btree ("next_attempt_at") WHERE "media_deletions"."status" = 'pending';