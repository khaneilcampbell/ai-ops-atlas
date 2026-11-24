-- Persistent agent memory and task memory, on top of schema v1 (0001_atlas_core.sql).
--
-- Reuses what v1 already has instead of copying it: atlas.agent_runs is the task history and the
-- stable run id, atlas.tasks the assignments, atlas.decisions the approved decisions, atlas.documents
-- the documentation pointers, atlas.approvals the approval gate and atlas.ai_notes model notes about
-- records. This migration adds only what was missing:
--
--   memory_items   agent memory, procedures, lessons and shared knowledge, with provenance,
--                  verification, revision (supersedes) and retention (expires_at / review_at)
--   run_feedback   one validation result per run: checks against success criteria, quality, error
--                  class, retryability, memory reused and the estimated tokens that reuse saved
--   memory_events  the audit trail: every write, review, revision, retirement and retrieval
--
-- and three reliability columns on runs and tasks:
--   agent_runs.task_key / attempt / heartbeat_at / lease_until, a 'timed_out' status, and a unique
--   index that lets only one worker hold a task key at a time
--   tasks.dedupe_key with a unique index over open tasks, so a recurring job can't file twice
--
-- Additive only: no existing row or column changes meaning. Undo with 0003_agent_memory.down.sql.
-- Migration 0002 (the Executive Agent's tables) is independent of this one.

-- ---- Runs: stable task keys, attempts, heartbeats, stale detection ---------------------------------

ALTER TABLE atlas.agent_runs
  ADD COLUMN task_key text CHECK (task_key ~ '^[A-Za-z0-9._:-]{3,160}$'),
  ADD COLUMN attempt smallint NOT NULL DEFAULT 1 CHECK (attempt BETWEEN 1 AND 100),
  ADD COLUMN heartbeat_at timestamptz,
  ADD COLUMN lease_until timestamptz;

-- 'timed_out': Atlas stopped hearing from a run (no finish, heartbeat or lease renewal). A late
-- finish is still accepted, so a run that really succeeded can say so afterwards.
ALTER TABLE atlas.agent_runs DROP CONSTRAINT IF EXISTS agent_runs_status_check;
ALTER TABLE atlas.agent_runs ADD CONSTRAINT agent_runs_status_check CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'timed_out'));

-- One live run per agent and task key: a second worker's start is refused, not doubled.
CREATE UNIQUE INDEX agent_runs_one_live ON atlas.agent_runs (agent_id, task_key) WHERE task_key IS NOT NULL AND status IN ('queued', 'running');
CREATE INDEX agent_runs_task_key ON atlas.agent_runs (task_key, started_at DESC) WHERE task_key IS NOT NULL;
CREATE INDEX agent_runs_live ON atlas.agent_runs (status, coalesce(lease_until, heartbeat_at, started_at)) WHERE status IN ('queued', 'running');

-- ---- Tasks: duplicate prevention for recurring work ----------------------------------------------

ALTER TABLE atlas.tasks ADD COLUMN dedupe_key text CHECK (dedupe_key ~ '^[A-Za-z0-9._:-]{3,160}$');
CREATE UNIQUE INDEX tasks_one_open_per_key ON atlas.tasks (dedupe_key) WHERE dedupe_key IS NOT NULL AND status IN ('queued', 'running', 'blocked', 'awaiting_approval');
CREATE INDEX tasks_dedupe_key ON atlas.tasks (dedupe_key, updated_at DESC) WHERE dedupe_key IS NOT NULL;

-- ---- Memory --------------------------------------------------------------------------------------
-- category (who may write it, how long it lives), matching the Agent Intelligence categories in
-- src/intelligence/types.ts:
--   working            agents or Khaneil; always expires (7 days by default, 30 at most)
--   operational        agents write it UNVERIFIED; only Khaneil verifies it
--   project_knowledge  Khaneil only (or a migration / pull request)
--   human_approved     Khaneil only, verified on write
-- kind (what it is): fact, procedure (a reusable method), lesson (what went wrong or right), context.
-- A procedure is trusted only when verified; agents can propose one but never verify it.
-- sensitivity uses the document access categories, so an agent's document policy also limits memory.
CREATE TABLE atlas.memory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL CHECK (category IN ('working', 'operational', 'project_knowledge', 'human_approved')),
  kind text NOT NULL DEFAULT 'fact' CHECK (kind IN ('fact', 'procedure', 'lesson', 'context')),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 2000),
  tags text NOT NULL DEFAULT '' CHECK (char_length(tags) <= 500),
  area text NOT NULL CHECK (area IN ('business', 'projects', 'career', 'life', 'finance')),
  -- Scope. agent_id set: only that agent (and Khaneil) reads it. Null: every agent cleared for the area.
  agent_id text CHECK (agent_id ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  project_id uuid REFERENCES atlas.projects (id) ON DELETE SET NULL,
  goal_id uuid REFERENCES atlas.goals (id) ON DELETE SET NULL,
  workflow_id text CHECK (char_length(workflow_id) <= 120),
  task_key text CHECK (task_key ~ '^[A-Za-z0-9._:-]{3,160}$'),
  error_class text CHECK (error_class ~ '^[a-z0-9][a-z0-9_.-]{0,59}$'),
  sensitivity text NOT NULL DEFAULT 'internal' CHECK (sensitivity IN ('shared', 'internal', 'private', 'restricted')),
  -- Provenance: where it came from. A pointer, never the source's content.
  source_kind text NOT NULL CHECK (source_kind IN ('run', 'task', 'decision', 'document', 'repository', 'person', 'agent', 'external')),
  source_ref text NOT NULL CHECK (char_length(source_ref) BETWEEN 1 AND 500),
  source_url text CHECK (char_length(source_url) <= 2000 AND source_url ~ '^https://'),
  run_id uuid REFERENCES atlas.agent_runs (id) ON DELETE SET NULL,
  -- Trust
  verification text NOT NULL DEFAULT 'unverified' CHECK (verification IN ('unverified', 'verified', 'disputed')),
  verified_by text CHECK (char_length(verified_by) <= 120),
  verified_at timestamptz,
  suspicious text CHECK (char_length(suspicious) <= 200),
  -- Revision and retention
  supersedes uuid REFERENCES atlas.memory_items (id) ON DELETE SET NULL,
  superseded_by uuid REFERENCES atlas.memory_items (id) ON DELETE SET NULL,
  expires_at timestamptz,
  review_at timestamptz,
  retired_at timestamptz,
  retired_by text CHECK (char_length(retired_by) <= 120),
  retire_reason text CHECK (char_length(retire_reason) <= 200),
  use_count integer NOT NULL DEFAULT 0 CHECK (use_count >= 0),
  last_used_at timestamptz,
  origin text NOT NULL CHECK (origin IN ('owner', 'agent', 'system')),
  created_by text NOT NULL CHECK (char_length(created_by) <= 120),
  updated_by text NOT NULL CHECK (char_length(updated_by) <= 120),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (category <> 'working' OR expires_at IS NOT NULL),
  CHECK (category <> 'human_approved' OR verification = 'verified'),
  CHECK ((verification = 'unverified') = (verified_at IS NULL)),
  CHECK (origin = 'owner' OR category IN ('working', 'operational')),
  CHECK (origin = 'owner' OR verification = 'unverified' OR verified_by IS NOT NULL)
);
CREATE INDEX memory_live_area ON atlas.memory_items (area, category, updated_at DESC) WHERE retired_at IS NULL;
CREATE INDEX memory_task_key ON atlas.memory_items (task_key) WHERE retired_at IS NULL AND task_key IS NOT NULL;
CREATE INDEX memory_workflow ON atlas.memory_items (workflow_id) WHERE retired_at IS NULL AND workflow_id IS NOT NULL;
CREATE INDEX memory_agent ON atlas.memory_items (agent_id, updated_at DESC);
CREATE INDEX memory_review ON atlas.memory_items (verification, created_at DESC) WHERE retired_at IS NULL;
CREATE INDEX memory_project ON atlas.memory_items (project_id) WHERE project_id IS NOT NULL;
CREATE INDEX memory_run ON atlas.memory_items (run_id) WHERE run_id IS NOT NULL;

-- ---- Execution feedback --------------------------------------------------------------------------
-- One validation result per run, written by the run's agent (or Khaneil). verdict 'passed' needs at
-- least one check and every check passed; the API downgrades anything else.
CREATE TABLE atlas.run_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL UNIQUE REFERENCES atlas.agent_runs (id) ON DELETE CASCADE,
  agent_id text NOT NULL CHECK (agent_id ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  task_key text CHECK (task_key ~ '^[A-Za-z0-9._:-]{3,160}$'),
  verdict text NOT NULL CHECK (verdict IN ('passed', 'partial', 'failed', 'unverified')),
  checks jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(checks) = 'array' AND pg_column_size(checks) <= 8192),
  quality_score smallint CHECK (quality_score BETWEEN 0 AND 100),
  error_class text CHECK (error_class ~ '^[a-z0-9][a-z0-9_.-]{0,59}$'),
  retryable boolean,
  duration_ms integer CHECK (duration_ms >= 0),
  memory_ids text NOT NULL DEFAULT '' CHECK (char_length(memory_ids) <= 1000),
  tokens_saved_est integer NOT NULL DEFAULT 0 CHECK (tokens_saved_est >= 0),
  note text CHECK (char_length(note) <= 1000),
  created_by text NOT NULL CHECK (char_length(created_by) <= 120),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX run_feedback_agent ON atlas.run_feedback (agent_id, created_at DESC);
CREATE INDEX run_feedback_task_key ON atlas.run_feedback (task_key, created_at DESC) WHERE task_key IS NOT NULL;

-- ---- Audit trail ---------------------------------------------------------------------------------
-- Ids and short notes only, never memory content. 'prepare' rows record each pre-run check: what
-- Atlas decided, which memory it handed over and the tokens it estimates the decision saved.
CREATE TABLE atlas.memory_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text NOT NULL CHECK (action IN ('write', 'verify', 'dispute', 'revise', 'retire', 'expire', 'refused', 'prepare', 'search', 'feedback', 'sweep')),
  memory_id uuid REFERENCES atlas.memory_items (id) ON DELETE SET NULL,
  memory_ids text NOT NULL DEFAULT '' CHECK (char_length(memory_ids) <= 1000),
  actor text NOT NULL CHECK (char_length(actor) <= 120),
  agent_id text CHECK (char_length(agent_id) <= 80),
  task_key text CHECK (char_length(task_key) <= 160),
  run_id uuid REFERENCES atlas.agent_runs (id) ON DELETE SET NULL,
  decision text CHECK (decision IN ('create', 'update', 'skip', 'wait', 'resume', 'retry', 'backoff', 'escalate')),
  tokens_used integer CHECK (tokens_used >= 0),
  tokens_saved_est integer CHECK (tokens_saved_est >= 0),
  note text CHECK (char_length(note) <= 300),
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX memory_events_recent ON atlas.memory_events (at DESC);
CREATE INDEX memory_events_agent ON atlas.memory_events (agent_id, at DESC);
CREATE INDEX memory_events_memory ON atlas.memory_events (memory_id, at DESC) WHERE memory_id IS NOT NULL;

CREATE TRIGGER memory_items_touch BEFORE UPDATE ON atlas.memory_items FOR EACH ROW EXECUTE FUNCTION atlas.touch_row();
