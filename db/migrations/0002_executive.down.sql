-- Undoes 0002_executive.sql. Deletes the Executive's goal, plan, task, artifact and event history
-- (the core goals, tasks, runs and approvals it created stay): take a backup (pg_dump -n atlas) first.
DROP TABLE IF EXISTS atlas.exec_events;
DROP TABLE IF EXISTS atlas.exec_artifacts;
DROP TABLE IF EXISTS atlas.exec_tasks;
DROP TABLE IF EXISTS atlas.exec_plans;
DROP TABLE IF EXISTS atlas.exec_goals;
