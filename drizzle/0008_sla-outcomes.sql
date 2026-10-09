CREATE TABLE "sla_outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"agency_id" uuid NOT NULL,
	"timer" "sla_timer" NOT NULL,
	"sla_cycle" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"stopped_at" timestamp with time zone NOT NULL,
	"met" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sla_outcomes_report_timer_cycle_unique" UNIQUE("report_id","timer","sla_cycle"),
	CONSTRAINT "sla_outcomes_time_order" CHECK ("sla_outcomes"."stopped_at" >= "sla_outcomes"."started_at")
);
--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "sla_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sla_outcomes" ADD CONSTRAINT "sla_outcomes_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sla_outcomes" ADD CONSTRAINT "sla_outcomes_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sla_outcomes_agency_stopped_idx" ON "sla_outcomes" USING btree ("agency_id","stopped_at");--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- Backfill: reports that already have a running timer need a start time before we add the rule
-- below. The best information we have is the time the report was first routed.
-- ---------------------------------------------------------------------------------------------
UPDATE reports
SET sla_started_at = routed_at
WHERE sla_started_at IS NULL
	AND (ack_due_at IS NOT NULL OR resolve_due_at IS NOT NULL);--> statement-breakpoint

-- Rule: if a timer is running, we must know when it started. Added AFTER the backfill so that
-- existing rows already satisfy it.
ALTER TABLE "reports" ADD CONSTRAINT "reports_running_timer_has_start" CHECK (("reports"."ack_due_at" is null and "reports"."resolve_due_at" is null) or "reports"."sla_started_at" is not null);--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- sla_outcomes is APPEND-ONLY: new rows may be added, but existing rows can never be changed or
-- deleted. This trigger runs before any UPDATE or DELETE and refuses it with an error, so the
-- performance history cannot be quietly rewritten. (TRUNCATE is deliberately not blocked, so
-- test databases can be reset; it needs table-owner rights, which the app must not have in production.)
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION sla_outcomes_reject_change() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'sla_outcomes is append-only';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER sla_outcomes_append_only
	BEFORE UPDATE OR DELETE ON sla_outcomes
	FOR EACH ROW EXECUTE FUNCTION sla_outcomes_reject_change();
