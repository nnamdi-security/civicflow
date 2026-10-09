ALTER TYPE "public"."audit_action" ADD VALUE 'account.erased';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "erased_at" timestamp with time zone;--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- status_events stays append-only, with ONE narrow exception for account erasure (ADR 0015).
--
-- Until now this function refused every UPDATE and DELETE. A resident who erases their account
-- has the right to have their own free-text notes (for example "still broken, call me on ...")
-- removed from the history, so the function now allows exactly this and nothing else:
--   1. it is an UPDATE (never a DELETE);
--   2. the current transaction has switched on the setting `civicflow.erasure` (the erasure code
--      sets it with set_config(..., true), which lasts only until that transaction ends);
--   3. the ONLY column that changes is `reason`;
--   4. and it changes to exactly the word 'removed'.
-- Anything else still raises the same error as before. CREATE OR REPLACE swaps the function body
-- without touching the trigger that calls it.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION status_events_reject_change() RETURNS trigger AS $$
BEGIN
	IF TG_OP = 'UPDATE'
		AND current_setting('civicflow.erasure', true) = 'on'
		AND NEW.reason = 'removed'
		AND NEW.reason IS DISTINCT FROM OLD.reason
		-- "everything except reason is identical": compare the rows as JSON with `reason` taken out
		AND (to_jsonb(NEW) - 'reason') = (to_jsonb(OLD) - 'reason')
	THEN
		RETURN NEW;
	END IF;
	RAISE EXCEPTION 'status_events is append-only';
END;
$$ LANGUAGE plpgsql;
