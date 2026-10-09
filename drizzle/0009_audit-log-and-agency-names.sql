CREATE TYPE "public"."audit_action" AS ENUM('agency.created', 'agency.updated', 'coverage.added', 'coverage.removed', 'coverage.priority_changed', 'sla_policy.updated', 'category.activated', 'category.deactivated', 'staff.invited', 'staff.deactivated', 'staff.reactivated');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid NOT NULL,
	"actor_role" text NOT NULL,
	"action" "audit_action" NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid,
	"summary" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_created_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_log_target_idx" ON "audit_log" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agencies_name_unique" ON "agencies" USING btree (lower("name"));--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- audit_log is APPEND-ONLY, like status_events: rows can be added but never changed or deleted.
-- This trigger runs before any UPDATE or DELETE and stops it with an error, so the record of who
-- changed what cannot be quietly edited. (TRUNCATE is deliberately not blocked, so test databases
-- can be reset; it needs table-owner rights, which the app must not have in production.)
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION audit_log_reject_change() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'audit_log is append-only';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER audit_log_append_only
	BEFORE UPDATE OR DELETE ON audit_log
	FOR EACH ROW EXECUTE FUNCTION audit_log_reject_change();
