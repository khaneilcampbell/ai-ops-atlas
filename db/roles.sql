-- Least-privilege database role for the Atlas data API. Run once as the database owner, after the
-- migrations. Set the password yourself (psql: \password atlas_app); never commit it.
--
-- atlas_app can read and write rows in the atlas schema but cannot create, alter or drop tables,
-- cannot delete fact rows, and cannot touch any other schema. Migrations run as the owner role.

CREATE ROLE atlas_app LOGIN;
GRANT USAGE ON SCHEMA atlas TO atlas_app;
GRANT SELECT ON ALL TABLES IN SCHEMA atlas TO atlas_app;
GRANT INSERT, UPDATE ON atlas.goals, atlas.projects, atlas.tasks, atlas.decisions, atlas.documents, atlas.agent_runs, atlas.approvals TO atlas_app;
GRANT INSERT ON atlas.ai_notes TO atlas_app;
GRANT INSERT, UPDATE, DELETE ON atlas.idempotency_keys TO atlas_app;
REVOKE CREATE ON SCHEMA atlas FROM atlas_app;
REVOKE ALL ON SCHEMA public FROM atlas_app;
