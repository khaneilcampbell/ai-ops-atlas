-- Undoes 0002_profile_edits.sql. Every edit made in Atlas goes back to the repository text, and
-- the edit log is deleted: take a backup (pg_dump -n atlas) first.
DROP TABLE IF EXISTS atlas.profile_edit_log;
DROP TABLE IF EXISTS atlas.profile_edits;
DELETE FROM atlas.schema_migrations WHERE version = 2;
