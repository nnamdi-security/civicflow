CREATE TYPE "public"."notification_channel" AS ENUM('email', 'sms');--> statement-breakpoint
CREATE TYPE "public"."notification_event" AS ENUM('report_received', 'report_routed', 'report_acknowledged', 'report_resolved', 'report_rejected', 'report_disputed', 'escalation_level_1', 'escalation_level_2', 'escalation_level_3');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('pending', 'sent', 'failed', 'skipped');--> statement-breakpoint
CREATE TABLE "phone_verifications" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"phone_e164" text NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"event" "notification_event" NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"recipient_user_id" uuid NOT NULL,
	"sla_cycle" integer NOT NULL,
	"discriminator" text DEFAULT '' NOT NULL,
	"status" "notification_status" DEFAULT 'pending' NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"skipped_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "notifications_dedupe_unique" UNIQUE("report_id","event","channel","recipient_user_id","sla_cycle","discriminator")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "phone_e164" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "phone_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "notify_email" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "notify_sms" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "phone_verifications" ADD CONSTRAINT "phone_verifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_due_idx" ON "notifications" USING btree ("next_attempt_at") WHERE "notifications"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "notifications_report_idx" ON "notifications" USING btree ("report_id");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_phone_format" CHECK ("users"."phone_e164" is null or "users"."phone_e164" ~ '^\+234[789][0-9]{9}$');--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_phone_verified_needs_phone" CHECK ("users"."phone_verified_at" is null or "users"."phone_e164" is not null);--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_sms_needs_verified_phone" CHECK (not "users"."notify_sms" or "users"."phone_verified_at" is not null);