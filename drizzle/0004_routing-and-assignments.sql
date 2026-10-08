CREATE TABLE "assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"agency_id" uuid NOT NULL,
	"assigned_by" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "agency_id" uuid;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "routed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_routed_has_agency" CHECK ("reports"."status" in ('submitted', 'rejected') or "reports"."agency_id" is not null);
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assignments_report_created_idx" ON "assignments" USING btree ("report_id","created_at");--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reports_agency_status_idx" ON "reports" USING btree ("agency_id","status");--> statement-breakpoint
--> statement-breakpoint
-- assignments is append-only, like status_events (TRUNCATE stays allowed for test resets).
CREATE FUNCTION assignments_reject_change() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'assignments is append-only';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER assignments_append_only
	BEFORE UPDATE OR DELETE ON assignments
	FOR EACH ROW EXECUTE FUNCTION assignments_reject_change();
