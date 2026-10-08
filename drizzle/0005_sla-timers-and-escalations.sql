CREATE TYPE "public"."sla_timer" AS ENUM('acknowledge', 'resolve');--> statement-breakpoint
CREATE TABLE "escalations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"timer" "sla_timer" NOT NULL,
	"level" smallint NOT NULL,
	"sla_cycle" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "escalations_report_timer_level_cycle_unique" UNIQUE("report_id","timer","level","sla_cycle"),
	CONSTRAINT "escalations_level_range" CHECK ("escalations"."level" between 1 and 3)
);
--> statement-breakpoint
CREATE TABLE "sla_policies" (
	"category_id" uuid PRIMARY KEY NOT NULL,
	"ack_minutes" integer NOT NULL,
	"resolve_minutes" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sla_policies_ack_positive" CHECK ("sla_policies"."ack_minutes" > 0),
	CONSTRAINT "sla_policies_resolve_positive" CHECK ("sla_policies"."resolve_minutes" > 0)
);
--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "ack_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "resolve_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "sla_cycle" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sla_policies" ADD CONSTRAINT "sla_policies_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reports_ack_due_idx" ON "reports" USING btree ("ack_due_at") WHERE "reports"."ack_due_at" is not null;--> statement-breakpoint
CREATE INDEX "reports_resolve_due_idx" ON "reports" USING btree ("resolve_due_at") WHERE "reports"."resolve_due_at" is not null;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_sla_cycle_nonnegative" CHECK ("reports"."sla_cycle" >= 0);
--> statement-breakpoint
-- escalations is append-only, like status_events and assignments (TRUNCATE stays allowed for test resets).
CREATE FUNCTION escalations_reject_change() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'escalations is append-only';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER escalations_append_only
	BEFORE UPDATE OR DELETE ON escalations
	FOR EACH ROW EXECUTE FUNCTION escalations_reject_change();--> statement-breakpoint

-- PROVISIONAL placeholder SLA values (ADR 0010, docs/sla-and-escalation.md). Not agreed targets:
-- replace them with a new migration once real values are decided.
INSERT INTO sla_policies (category_id, ack_minutes, resolve_minutes)
SELECT c.id, v.ack_minutes, v.resolve_minutes
FROM categories c
JOIN (VALUES
	('roads',        24 * 60, 14 * 24 * 60),
	('drainage',     24 * 60,  7 * 24 * 60),
	('water',        12 * 60,  3 * 24 * 60),
	('power',        12 * 60,  3 * 24 * 60),
	('waste',        24 * 60,  5 * 24 * 60),
	('streetlights', 48 * 60, 14 * 24 * 60)
) AS v(slug, ack_minutes, resolve_minutes) ON v.slug = c.slug
ON CONFLICT (category_id) DO NOTHING;--> statement-breakpoint

-- Backfill reports already routed before timers existed. Deadlines count from routed_at (the best
-- information available); a disputed report is treated the same way. Only running timers get a deadline.
UPDATE reports r
SET sla_cycle = 1,
	ack_due_at = CASE WHEN r.status = 'routed' THEN r.routed_at + make_interval(mins => p.ack_minutes) END,
	resolve_due_at = r.routed_at + make_interval(mins => p.resolve_minutes)
FROM sla_policies p
WHERE p.category_id = r.category_id
	AND r.routed_at IS NOT NULL
	AND r.status IN ('routed', 'acknowledged', 'in_progress', 'disputed');
