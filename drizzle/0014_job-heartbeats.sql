CREATE TABLE "job_heartbeats" (
	"job" text PRIMARY KEY NOT NULL,
	"last_run_at" timestamp with time zone NOT NULL,
	"last_status" text NOT NULL,
	"last_error" text,
	CONSTRAINT "job_heartbeats_status" CHECK ("job_heartbeats"."last_status" in ('ok', 'error'))
);
