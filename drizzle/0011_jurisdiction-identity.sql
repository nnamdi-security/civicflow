-- A place (state or LGA) is identified by its level, its name ignoring capital letters, and its
-- parent. The boundary importer relies on this to be re-runnable: running it twice updates the same
-- places instead of creating duplicates. `coalesce` replaces a missing parent (null) with a fixed
-- value, because the database considers two nulls different and would otherwise allow two states
-- with the same name. If this migration fails, two places share an identity: rename or merge one.
CREATE UNIQUE INDEX "jurisdictions_identity_unique" ON "jurisdictions" USING btree ("level",lower("name"),coalesce("parent_id", '00000000-0000-0000-0000-000000000000'::uuid));