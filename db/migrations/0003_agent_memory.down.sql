-- Undoes 0003_agent_memory.sql. Deletes all agent memory, run feedback and memory audit rows:
-- take a backup (pg_dump -n atlas) first. Runs marked 'timed_out' go back to 'failed' so the old
-- status check holds again.
DROP TABLE IF EXISTS atlas.memory_events;
DROP TABLE IF EXISTS atlas.run_feedback;
DROP TABLE IF EXISTS atlas.memory_items;
DROP INDEX IF EXISTS atlas.tasks_dedupe_key;
DROP INDEX IF EXISTS atlas.tasks_one_open_per_key;
ALTER TABLE atlas.tasks DROP COLUMN IF EXISTS dedupe_key;
DROP INDEX IF EXISTS atlas.agent_runs_live;
DROP INDEX IF EXISTS atlas.agent_runs_task_key;
DROP INDEX IF EXISTS atlas.agent_runs_one_live;
UPDATE atlas.agent_runs SET status = 'failed', error = coalesce(error, 'Timed out (no finish reported).'), finished_at = coalesce(finished_at, now()) WHERE status = 'timed_out';
ALTER TABLE atlas.agent_runs DROP CONSTRAINT IF EXISTS agent_runs_status_check;
ALTER TABLE atlas.agent_runs ADD CONSTRAINT agent_runs_status_check CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled'));
ALTER TABLE atlas.agent_runs DROP COLUMN IF EXISTS lease_until, DROP COLUMN IF EXISTS heartbeat_at, DROP COLUMN IF EXISTS attempt, DROP COLUMN IF EXISTS task_key;
DELETE FROM atlas.schema_migrations WHERE version = 3;
