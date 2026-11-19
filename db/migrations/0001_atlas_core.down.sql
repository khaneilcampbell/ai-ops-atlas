-- Undoes 0001_atlas_core.sql. Deletes every Atlas record: take a backup (pg_dump -n atlas) first.
DROP TABLE IF EXISTS atlas.idempotency_keys;
DROP TABLE IF EXISTS atlas.ai_notes;
DROP TABLE IF EXISTS atlas.approvals;
DROP TABLE IF EXISTS atlas.agent_runs;
DROP TABLE IF EXISTS atlas.documents;
DROP TABLE IF EXISTS atlas.decisions;
DROP TABLE IF EXISTS atlas.tasks;
DROP TABLE IF EXISTS atlas.projects;
DROP TABLE IF EXISTS atlas.goals;
DROP FUNCTION IF EXISTS atlas.touch_row();
DELETE FROM atlas.schema_migrations WHERE version = 1;
