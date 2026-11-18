-- Atlas core records: the PostgreSQL source of truth that Atlas, n8n and agents share.
--
-- Facts (goals, projects, tasks, decisions, documents) are kept apart from what models write about
-- them (ai_notes). Every fact row records who created it (origin) and whether Khaneil confirmed it
-- (owner_confirmed_at); the data API never lets an agent change a row Khaneil created or confirmed,
-- it files an approval instead. Nothing here holds secrets, passwords or payment details.
--
-- Applied by scripts/db-migrate.mjs, which records each file in atlas.schema_migrations.
-- Needs PostgreSQL 13 or newer (gen_random_uuid() is built in from 13).

CREATE SCHEMA IF NOT EXISTS atlas;

CREATE TABLE IF NOT EXISTS atlas.schema_migrations (
  version integer PRIMARY KEY,
  name text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

-- Keeps updated_at honest and bumps version on every change, whoever writes.
CREATE OR REPLACE FUNCTION atlas.touch_row() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.updated_at := now();
  NEW.version := OLD.version + 1;
  RETURN NEW;
END;
$$;

CREATE TABLE atlas.goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  description text CHECK (char_length(description) <= 4000),
  area text NOT NULL CHECK (area IN ('business', 'projects', 'career', 'life', 'finance')),
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('proposed', 'active', 'paused', 'achieved', 'dropped')),
  target_date date,
  origin text NOT NULL CHECK (origin IN ('owner', 'agent', 'system')),
  created_by text NOT NULL CHECK (char_length(created_by) <= 120),
  updated_by text NOT NULL CHECK (char_length(updated_by) <= 120),
  owner_confirmed_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX goals_area_status ON atlas.goals (area, status);

CREATE TABLE atlas.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  description text CHECK (char_length(description) <= 4000),
  area text NOT NULL CHECK (area IN ('business', 'projects', 'career', 'life', 'finance')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('planned', 'active', 'paused', 'done', 'dropped')),
  goal_id uuid REFERENCES atlas.goals (id) ON DELETE SET NULL,
  origin text NOT NULL CHECK (origin IN ('owner', 'agent', 'system')),
  created_by text NOT NULL CHECK (char_length(created_by) <= 120),
  updated_by text NOT NULL CHECK (char_length(updated_by) <= 120),
  owner_confirmed_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX projects_area_status ON atlas.projects (area, status);
CREATE INDEX projects_goal ON atlas.projects (goal_id);

-- Statuses, priorities and sources match the Task Center (src/tasks/types.ts).
CREATE TABLE atlas.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  description text CHECK (char_length(description) <= 4000),
  area text NOT NULL CHECK (area IN ('business', 'projects', 'career', 'life', 'finance')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'blocked', 'awaiting_approval', 'completed', 'failed', 'cancelled')),
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  due_date date,
  project_id uuid REFERENCES atlas.projects (id) ON DELETE SET NULL,
  goal_id uuid REFERENCES atlas.goals (id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'agent', 'n8n', 'github', 'system')),
  origin text NOT NULL CHECK (origin IN ('owner', 'agent', 'system')),
  created_by text NOT NULL CHECK (char_length(created_by) <= 120),
  updated_by text NOT NULL CHECK (char_length(updated_by) <= 120),
  owner_confirmed_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tasks_project_status ON atlas.tasks (project_id, status);
CREATE INDEX tasks_goal_status ON atlas.tasks (goal_id, status);
CREATE INDEX tasks_area_status_due ON atlas.tasks (area, status, due_date);
CREATE INDEX tasks_updated ON atlas.tasks (updated_at DESC);

CREATE TABLE atlas.decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision text NOT NULL CHECK (char_length(decision) BETWEEN 1 AND 500),
  rationale text CHECK (char_length(rationale) <= 4000),
  area text NOT NULL CHECK (area IN ('business', 'projects', 'career', 'life', 'finance')),
  decided_on date NOT NULL DEFAULT CURRENT_DATE,
  project_id uuid REFERENCES atlas.projects (id) ON DELETE SET NULL,
  goal_id uuid REFERENCES atlas.goals (id) ON DELETE SET NULL,
  origin text NOT NULL CHECK (origin IN ('owner', 'agent', 'system')),
  created_by text NOT NULL CHECK (char_length(created_by) <= 120),
  updated_by text NOT NULL CHECK (char_length(updated_by) <= 120),
  owner_confirmed_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX decisions_project ON atlas.decisions (project_id, decided_on DESC);
CREATE INDEX decisions_goal ON atlas.decisions (goal_id, decided_on DESC);

-- Documents are pointers (a storage URL), never file contents. access_category decides which
-- agents may see a row at all; 'restricted' is never served to an agent key.
-- summary is the human-written or owner-approved summary; model summaries go in ai_notes.
-- Future document search: add a document_chunks table with a pgvector column keyed to id.
CREATE TABLE atlas.documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  doc_type text NOT NULL CHECK (doc_type IN ('note', 'report', 'contract', 'resume', 'plan', 'spec', 'invoice', 'other')),
  storage_url text CHECK (char_length(storage_url) <= 2000 AND storage_url ~ '^https://'),
  summary text CHECK (char_length(summary) <= 4000),
  doc_date date,
  area text NOT NULL CHECK (area IN ('business', 'projects', 'career', 'life', 'finance')),
  access_category text NOT NULL DEFAULT 'private' CHECK (access_category IN ('shared', 'internal', 'private', 'restricted')),
  project_id uuid REFERENCES atlas.projects (id) ON DELETE SET NULL,
  goal_id uuid REFERENCES atlas.goals (id) ON DELETE SET NULL,
  origin text NOT NULL CHECK (origin IN ('owner', 'agent', 'system')),
  created_by text NOT NULL CHECK (char_length(created_by) <= 120),
  updated_by text NOT NULL CHECK (char_length(updated_by) <= 120),
  owner_confirmed_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX documents_project ON atlas.documents (project_id, doc_date DESC);
CREATE INDEX documents_area_access ON atlas.documents (area, access_category);

-- One row per agent or n8n workflow run. idempotency_key makes "start" and "finish" safe to retry.
CREATE TABLE atlas.agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id text NOT NULL CHECK (agent_id ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  workflow_id text CHECK (char_length(workflow_id) <= 120),
  external_run_id text CHECK (char_length(external_run_id) <= 120),
  idempotency_key text NOT NULL UNIQUE CHECK (char_length(idempotency_key) BETWEEN 8 AND 128),
  input_ref text CHECK (char_length(input_ref) <= 500),
  status text NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  result_summary text CHECK (char_length(result_summary) <= 2000),
  error text CHECK (char_length(error) <= 2000),
  goal_id uuid REFERENCES atlas.goals (id) ON DELETE SET NULL,
  project_id uuid REFERENCES atlas.projects (id) ON DELETE SET NULL,
  task_id uuid REFERENCES atlas.tasks (id) ON DELETE SET NULL,
  model text CHECK (char_length(model) <= 120),
  input_tokens integer CHECK (input_tokens >= 0),
  output_tokens integer CHECK (output_tokens >= 0),
  cost_usd numeric(10, 4) CHECK (cost_usd >= 0),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_runs_recent ON atlas.agent_runs (started_at DESC);
CREATE INDEX agent_runs_agent ON atlas.agent_runs (agent_id, started_at DESC);
CREATE INDEX agent_runs_status ON atlas.agent_runs (status, started_at DESC);
CREATE INDEX agent_runs_task ON atlas.agent_runs (task_id);
CREATE INDEX agent_runs_project ON atlas.agent_runs (project_id);

-- Anything consequential waits here for Khaneil: external messages, money, destructive changes,
-- other outside writes, and agent changes to facts Khaneil owns (kind 'fact_change', whose
-- target + payload the API applies only when approved).
CREATE TABLE atlas.approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('external_message', 'financial', 'destructive', 'external_write', 'fact_change', 'other')),
  proposed_action text NOT NULL CHECK (char_length(proposed_action) BETWEEN 1 AND 500),
  context text CHECK (char_length(context) <= 4000),
  area text NOT NULL CHECK (area IN ('business', 'projects', 'career', 'life', 'finance')),
  target_table text CHECK (target_table IN ('goals', 'projects', 'tasks', 'decisions', 'documents')),
  target_id uuid,
  payload jsonb CHECK (payload IS NULL OR pg_column_size(payload) <= 16384),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'expired')),
  requested_by text NOT NULL CHECK (char_length(requested_by) <= 120),
  run_id uuid REFERENCES atlas.agent_runs (id) ON DELETE SET NULL,
  task_id uuid REFERENCES atlas.tasks (id) ON DELETE SET NULL,
  project_id uuid REFERENCES atlas.projects (id) ON DELETE SET NULL,
  goal_id uuid REFERENCES atlas.goals (id) ON DELETE SET NULL,
  reviewer text CHECK (char_length(reviewer) <= 120),
  decision_note text CHECK (char_length(decision_note) <= 1000),
  decided_at timestamptz,
  expires_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'pending') = (decided_at IS NULL)),
  CHECK (kind <> 'fact_change' OR (target_table IS NOT NULL AND payload IS NOT NULL))
);
CREATE INDEX approvals_pending ON atlas.approvals (status, created_at DESC);
CREATE INDEX approvals_target ON atlas.approvals (target_table, target_id);

-- What models write about the facts: summaries, recommendations, extractions. Never merged into
-- the fact rows; shown and passed on as AI-written.
CREATE TABLE atlas.ai_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_table text NOT NULL CHECK (subject_table IN ('goals', 'projects', 'tasks', 'decisions', 'documents')),
  subject_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('summary', 'recommendation', 'extraction', 'risk')),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  area text NOT NULL CHECK (area IN ('business', 'projects', 'career', 'life', 'finance')),
  agent_id text NOT NULL CHECK (char_length(agent_id) <= 80),
  model text CHECK (char_length(model) <= 120),
  run_id uuid REFERENCES atlas.agent_runs (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_notes_subject ON atlas.ai_notes (subject_table, subject_id, created_at DESC);

-- Remembers each write's idempotency key per caller, with the answer it got, so a retried request
-- gets the same answer instead of writing twice. Rows older than 7 days can be deleted.
CREATE TABLE atlas.idempotency_keys (
  actor text NOT NULL CHECK (char_length(actor) <= 120),
  key text NOT NULL CHECK (char_length(key) BETWEEN 8 AND 128),
  request_hash text NOT NULL,
  status integer NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor, key)
);
CREATE INDEX idempotency_keys_created ON atlas.idempotency_keys (created_at);

CREATE TRIGGER goals_touch BEFORE UPDATE ON atlas.goals FOR EACH ROW EXECUTE FUNCTION atlas.touch_row();
CREATE TRIGGER projects_touch BEFORE UPDATE ON atlas.projects FOR EACH ROW EXECUTE FUNCTION atlas.touch_row();
CREATE TRIGGER tasks_touch BEFORE UPDATE ON atlas.tasks FOR EACH ROW EXECUTE FUNCTION atlas.touch_row();
CREATE TRIGGER decisions_touch BEFORE UPDATE ON atlas.decisions FOR EACH ROW EXECUTE FUNCTION atlas.touch_row();
CREATE TRIGGER documents_touch BEFORE UPDATE ON atlas.documents FOR EACH ROW EXECUTE FUNCTION atlas.touch_row();
CREATE TRIGGER agent_runs_touch BEFORE UPDATE ON atlas.agent_runs FOR EACH ROW EXECUTE FUNCTION atlas.touch_row();
CREATE TRIGGER approvals_touch BEFORE UPDATE ON atlas.approvals FOR EACH ROW EXECUTE FUNCTION atlas.touch_row();
