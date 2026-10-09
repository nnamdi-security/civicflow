ALTER TABLE "reports" ADD COLUMN "jurisdiction_id" uuid;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_jurisdiction_id_jurisdictions_id_fk" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."jurisdictions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reports_jurisdiction_idx" ON "reports" USING btree ("jurisdiction_id");--> statement-breakpoint
CREATE INDEX "reports_resolved_at_idx" ON "reports" USING btree ("resolved_at") WHERE "reports"."status" = 'resolved';--> statement-breakpoint

-- Backfill for reports created before these columns existed.
-- Area: the finest jurisdiction covering the point (one with no covering child); lowest id on a shared boundary.
UPDATE reports r
SET jurisdiction_id = (
	SELECT j.id FROM jurisdictions j
	WHERE ST_Covers(j.geom, r.location::geometry)
		AND NOT EXISTS (
			SELECT 1 FROM jurisdictions c
			WHERE c.parent_id = j.id AND ST_Covers(c.geom, r.location::geometry)
		)
	ORDER BY j.id
	LIMIT 1
);--> statement-breakpoint
-- Resolved time: the latest time the report entered `resolved`, from its append-only history.
UPDATE reports r
SET resolved_at = (
	SELECT max(e.created_at) FROM status_events e
	WHERE e.report_id = r.id AND e.to_status = 'resolved'
)
WHERE r.status = 'resolved';--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_resolved_has_time" CHECK ("reports"."status" <> 'resolved' or "reports"."resolved_at" is not null);
