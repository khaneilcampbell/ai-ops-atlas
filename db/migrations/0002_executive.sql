-- Atlas Executive: durable goal orchestration state, beside the core records of 0001.
--
-- Reuses the core tables instead of copying them: each executive goal points to an atlas.goals
-- row, each executive task to an atlas.tasks row (what the Task Center shows), each execution
-- attempt to an atlas.agent_runs row (model, tokens, cost), and owner approvals live in
-- atlas.approvals. These tables only hold what the core tables have no place for: the lifecycle
-- state, the checked plan, dependencies and assignments, dispatch claims, returned artifacts with
-- their verification, and an append-only event log. Additive only; nothing in 0001 changes.

CREATE TABLE atlas.exec_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id uuid REFERENCES atlas.goals (id) ON DELETE SET NULL,
  objective text NOT NULL CHECK (char_length(objective) BETWEEN 1 AND 500),
  state text NOT NULL DEFAULT 'GOAL_RECEIVED' CHECK (state IN (
    'GOAL_RECEIVED', 'GOAL_VALIDATED', 'PLAN_GENERATED', 'PLAN_CHECKED', 'TASKS_CREATED', 'AGENTS_ASSIGNED',
    'EXECUTION_AUTHORIZED', 'EXECUTION_STARTED', 'EXECUTION_MONITORED', 'RESULTS_VERIFIED', 'GOAL_COMPLETED',
    'AWAITING_APPROVAL', 'PAUSED', 'BLOCKED', 'FAILED', 'CANCELLED')),
  -- Where a paused or blocked goal returns to.
  resume_state text,
  state_reason text CHECK (char_length(state_reason) <= 1000),
  autonomy smallint NOT NULL DEFAULT 2 CHECK (autonomy BETWEEN 1 AND 4),
  budget_usd numeric(10, 4) NOT NULL CHECK (budget_usd > 0 AND budget_usd <= 5),
  spent_usd numeric(10, 4) NOT NULL DEFAULT 0 CHECK (spent_usd >= 0),
  summary text CHECK (char_length(summary) <= 2000),
  created_by text NOT NULL CHECK (char_length(created_by) <= 120),
  completed_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX exec_goals_state ON atlas.exec_goals (state, updated_at DESC);

CREATE TABLE atlas.exec_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exec_goal_id uuid NOT NULL REFERENCES atlas.exec_goals (id) ON DELETE CASCADE,
  plan jsonb NOT NULL CHECK (pg_column_size(plan) <= 32768),
  accepted boolean NOT NULL,
  problems jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX exec_plans_goal ON atlas.exec_plans (exec_goal_id, created_at DESC);

CREATE TABLE atlas.exec_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exec_goal_id uuid NOT NULL REFERENCES atlas.exec_goals (id) ON DELETE CASCADE,
  plan_key text NOT NULL CHECK (plan_key ~ '^[a-z][a-z0-9-]{1,39}$'),
  task_id uuid REFERENCES atlas.tasks (id) ON DELETE SET NULL,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  capability text NOT NULL CHECK (char_length(capability) <= 60),
  depends_on jsonb NOT NULL DEFAULT '[]'::jsonb,
  inputs jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (pg_column_size(inputs) <= 16384),
  agent_id text CHECK (agent_id ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  workflow text CHECK (char_length(workflow) <= 120),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'ready', 'blocked', 'awaiting_approval', 'dispatching', 'running', 'verifying', 'completed', 'failed', 'cancelled')),
  action_level smallint NOT NULL DEFAULT 2 CHECK (action_level BETWEEN 1 AND 4),
  max_cost_usd numeric(10, 4) NOT NULL DEFAULT 0 CHECK (max_cost_usd >= 0),
  cost_usd numeric(10, 4) NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 5),
  timeout_seconds integer NOT NULL DEFAULT 300 CHECK (timeout_seconds BETWEEN 10 AND 3600),
  -- The current attempt's claim: only the request that set it may send it.
  lease_until timestamptz,
  correlation_id text CHECK (char_length(correlation_id) <= 120),
  idempotency_key text UNIQUE CHECK (char_length(idempotency_key) BETWEEN 8 AND 128),
  -- SHA-256 of the one-time value sent with the attempt; the result must bring the value back.
  nonce_hash text CHECK (char_length(nonce_hash) = 64),
  external_execution_id text CHECK (char_length(external_execution_id) <= 60),
  run_id uuid REFERENCES atlas.agent_runs (id) ON DELETE SET NULL,
  approval_id uuid REFERENCES atlas.approvals (id) ON DELETE SET NULL,
  blocked_reason text CHECK (char_length(blocked_reason) <= 1000),
  error text CHECK (char_length(error) <= 1000),
  dispatched_at timestamptz,
  finished_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (exec_goal_id, plan_key)
);
CREATE INDEX exec_tasks_state ON atlas.exec_tasks (state, lease_until);
CREATE INDEX exec_tasks_agent ON atlas.exec_tasks (agent_id, state);

CREATE TABLE atlas.exec_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exec_task_id uuid NOT NULL REFERENCES atlas.exec_tasks (id) ON DELETE CASCADE,
  exec_goal_id uuid NOT NULL REFERENCES atlas.exec_goals (id) ON DELETE CASCADE,
  attempt integer NOT NULL,
  schema text NOT NULL CHECK (char_length(schema) <= 60),
  body jsonb NOT NULL CHECK (pg_column_size(body) <= 65536),
  -- Links the run's own web search returned (the evidence the citations are checked against).
  searched jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (pg_column_size(searched) <= 32768),
  verification jsonb,
  verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX exec_artifacts_task ON atlas.exec_artifacts (exec_task_id, created_at DESC);

-- Append-only audit log. event_key makes a repeated callback a no-op (unique when set).
CREATE TABLE atlas.exec_events (
  id bigserial PRIMARY KEY,
  exec_goal_id uuid NOT NULL REFERENCES atlas.exec_goals (id) ON DELETE CASCADE,
  exec_task_id uuid REFERENCES atlas.exec_tasks (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (char_length(kind) <= 60),
  from_state text,
  to_state text,
  actor text NOT NULL CHECK (char_length(actor) <= 120),
  detail text CHECK (char_length(detail) <= 500),
  correlation_id text CHECK (char_length(correlation_id) <= 120),
  event_key text UNIQUE CHECK (char_length(event_key) <= 200),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX exec_events_goal ON atlas.exec_events (exec_goal_id, id DESC);
CREATE INDEX exec_events_recent ON atlas.exec_events (created_at DESC);

CREATE TRIGGER exec_goals_touch BEFORE UPDATE ON atlas.exec_goals FOR EACH ROW EXECUTE FUNCTION atlas.touch_row();
CREATE TRIGGER exec_tasks_touch BEFORE UPDATE ON atlas.exec_tasks FOR EACH ROW EXECUTE FUNCTION atlas.touch_row();

-- The site's role (db/roles.sql) gets the same rights here as on the core tables. Skipped where
-- the role doesn't exist (tests, a scratch database).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'atlas_app') THEN
    GRANT SELECT, INSERT, UPDATE ON atlas.exec_goals, atlas.exec_plans, atlas.exec_tasks, atlas.exec_artifacts TO atlas_app;
    GRANT SELECT, INSERT ON atlas.exec_events TO atlas_app;
    GRANT USAGE ON SEQUENCE atlas.exec_events_id_seq TO atlas_app;
  END IF;
END $$;
