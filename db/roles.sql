-- Least-privilege database role for the Atlas data API. Run once as the database owner, after the
-- migrations. Set the password yourself (psql: \password atlas_app); never commit it.
--
-- atlas_app can read and write rows in the atlas schema but cannot create, alter or drop tables,
-- cannot delete fact rows or edit-log lines, and cannot touch any other schema. Migrations run as the owner role.

CREATE ROLE atlas_app LOGIN;
GRANT USAGE ON SCHEMA atlas TO atlas_app;
GRANT SELECT ON ALL TABLES IN SCHEMA atlas TO atlas_app;
GRANT INSERT, UPDATE ON atlas.goals, atlas.projects, atlas.tasks, atlas.decisions, atlas.documents, atlas.agent_runs, atlas.approvals TO atlas_app;
GRANT INSERT ON atlas.ai_notes TO atlas_app;
-- 0002_executive (also granted by that migration when the role already exists).
GRANT INSERT, UPDATE ON atlas.exec_goals, atlas.exec_plans, atlas.exec_tasks, atlas.exec_artifacts TO atlas_app;
GRANT INSERT ON atlas.exec_events TO atlas_app;
GRANT USAGE ON SEQUENCE atlas.exec_events_id_seq TO atlas_app;
GRANT INSERT, UPDATE, DELETE ON atlas.idempotency_keys TO atlas_app;
-- Profile edits (migration 0002): edits can be removed (undo); the edit log is append-only.
GRANT INSERT, UPDATE, DELETE ON atlas.profile_edits TO atlas_app;
GRANT INSERT ON atlas.profile_edit_log TO atlas_app;
REVOKE CREATE ON SCHEMA atlas FROM atlas_app;
REVOKE ALL ON SCHEMA public FROM atlas_app;

-- On Supabase, also keep the public Data API roles out of the atlas schema (the schema is not
-- exposed through the Data API, and this makes sure it stays unreadable even if it is added):
--   REVOKE ALL ON SCHEMA atlas FROM anon, authenticated;
--   REVOKE ALL ON ALL TABLES IN SCHEMA atlas FROM anon, authenticated;
--   ALTER DEFAULT PRIVILEGES IN SCHEMA atlas REVOKE ALL ON TABLES FROM anon, authenticated;
