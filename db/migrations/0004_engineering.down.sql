-- Undoes 0004_engineering.sql. Deletes CI incidents, engineering executions and QA reports (the
-- Executive goals, tasks, runs and events they belong to stay): take a backup (pg_dump -n atlas) first.
DROP TABLE IF EXISTS atlas.eng_executions;
DROP TABLE IF EXISTS atlas.eng_incidents;
DROP TABLE IF EXISTS atlas.eng_repo_state;
DROP TRIGGER IF EXISTS exec_events_append_only ON atlas.exec_events;
DROP FUNCTION IF EXISTS atlas.refuse_change();
ALTER TABLE atlas.exec_goals DROP COLUMN IF EXISTS template, DROP COLUMN IF EXISTS template_inputs, DROP COLUMN IF EXISTS area;
