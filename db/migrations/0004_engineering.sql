-- Atlas Engineering Division (Phase 2): CI incidents, engineering executions and QA results, beside
-- the Executive tables of 0002. Needs 0002 (Executive) first. Additive only.
--
-- Reuses what exists instead of copying it: every engineering job is an atlas.exec_goals row with a
-- fixed plan, every step an atlas.exec_tasks row (and an atlas.tasks row for the Task Center), every
-- runner attempt an atlas.agent_runs row (model, tokens, cost), approvals live in atlas.approvals,
-- phase changes are atlas.exec_events rows, and lessons go to atlas.memory_items (0003). These tables
-- only hold what those have no place for: the GitHub failure itself, the repository's last seen
-- commit, and each attempt's runner, branch, commits, claimed checks, QA report and pull request.

-- Goals Atlas opens itself name their plan template and inputs (the Executive no longer has to
-- match words for them), and the Task Center area their tasks belong to.
ALTER TABLE atlas.exec_goals
  ADD COLUMN template text CHECK (template ~ '^[a-z][a-z0-9-]{1,39}$'),
  ADD COLUMN template_inputs jsonb CHECK (template_inputs IS NULL OR pg_column_size(template_inputs) <= 8192),
  ADD COLUMN area text NOT NULL DEFAULT 'business' CHECK (area IN ('business', 'projects', 'career', 'life', 'finance'));

-- The audit trail is append-only: no update or delete, whoever asks (the site's role already has
-- only SELECT and INSERT; this also stops the owner role doing it by accident).
CREATE FUNCTION atlas.refuse_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'atlas.% is append-only', TG_TABLE_NAME;
END $$;
CREATE TRIGGER exec_events_append_only BEFORE UPDATE OR DELETE ON atlas.exec_events FOR EACH ROW EXECUTE FUNCTION atlas.refuse_change();

CREATE TABLE atlas.eng_repo_state (
  repo text PRIMARY KEY CHECK (repo ~ '^[a-z0-9_.-]+/[a-z0-9_.-]+$'),
  default_branch text NOT NULL CHECK (char_length(default_branch) <= 200),
  last_seen_sha text CHECK (last_seen_sha ~ '^[0-9a-f]{40}$'),
  last_run_id bigint,
  last_checked_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE atlas.eng_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repo text NOT NULL CHECK (repo ~ '^[a-z0-9_.-]+/[a-z0-9_.-]+$'),
  workflow_name text NOT NULL CHECK (char_length(workflow_name) BETWEEN 1 AND 120),
  workflow_path text CHECK (char_length(workflow_path) <= 200),
  run_id bigint NOT NULL CHECK (run_id > 0),
  run_attempt integer NOT NULL DEFAULT 1 CHECK (run_attempt >= 1),
  run_url text CHECK (run_url ~ '^https://github\.com/'),
  head_sha text NOT NULL CHECK (head_sha ~ '^[0-9a-f]{40}$'),
  branch text NOT NULL CHECK (char_length(branch) <= 200),
  category text NOT NULL CHECK (category IN ('lint', 'typecheck', 'test', 'build', 'visual', 'rust', 'security', 'release', 'infrastructure', 'unknown')),
  supported boolean NOT NULL,
  failed_jobs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (pg_column_size(failed_jobs) <= 16384),
  status text NOT NULL CHECK (status IN ('detected', 'assigned', 'awaiting_approval', 'repairing', 'pr_open', 'resolved', 'escalated', 'failed', 'ignored')),
  decision text CHECK (char_length(decision) <= 1000),
  -- fixture: a clearly labelled local test event, never shown as a real repair.
  source text NOT NULL CHECK (source IN ('webhook', 'reconcile', 'fixture')),
  dedupe_key text NOT NULL UNIQUE CHECK (dedupe_key ~ '^[A-Za-z0-9._:-]{3,160}$'),
  exec_goal_id uuid REFERENCES atlas.exec_goals (id) ON DELETE SET NULL,
  owner_task_id uuid REFERENCES atlas.tasks (id) ON DELETE SET NULL,
  resolved_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- One open engineering job per repository: two jobs can't write over each other.
CREATE UNIQUE INDEX eng_incidents_one_open ON atlas.eng_incidents (repo) WHERE status IN ('assigned', 'awaiting_approval', 'repairing');
CREATE INDEX eng_incidents_recent ON atlas.eng_incidents (created_at DESC);

CREATE TABLE atlas.eng_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exec_goal_id uuid NOT NULL REFERENCES atlas.exec_goals (id) ON DELETE CASCADE,
  exec_task_id uuid NOT NULL REFERENCES atlas.exec_tasks (id) ON DELETE CASCADE,
  attempt integer NOT NULL CHECK (attempt >= 1),
  repair_iteration smallint NOT NULL DEFAULT 0 CHECK (repair_iteration BETWEEN 0 AND 2),
  incident_id uuid REFERENCES atlas.eng_incidents (id) ON DELETE SET NULL,
  repo text NOT NULL CHECK (repo ~ '^[a-z0-9_.-]+/[a-z0-9_.-]+$'),
  phase text NOT NULL DEFAULT 'TASK_ASSIGNED' CHECK (phase IN ('TASK_ASSIGNED', 'CONTEXT_COLLECTED', 'IMPLEMENTATION_PLANNED', 'POLICY_CHECKED', 'WORKSPACE_PREPARED', 'CODE_MODIFIED',
    'VALIDATION_STARTED', 'VALIDATION_COMPLETED', 'QA_REVIEW_REQUESTED', 'PR_READY', 'BLOCKED', 'FAILED', 'CANCELLED', 'AWAITING_APPROVAL')),
  runner text NOT NULL DEFAULT 'github-actions' CHECK (char_length(runner) <= 60),
  runner_run_id text CHECK (runner_run_id ~ '^[0-9]{1,20}$'),
  runner_url text CHECK (runner_url ~ '^https://github\.com/'),
  base_sha text NOT NULL CHECK (base_sha ~ '^[0-9a-f]{40}$'),
  head_sha text CHECK (head_sha ~ '^[0-9a-f]{40}$'),
  branch text CHECK (branch ~ '^atlas-eng/[0-9a-f]{8}-a[0-9]{1,2}$'),
  model text CHECK (char_length(model) <= 80),
  input_tokens integer CHECK (input_tokens >= 0),
  output_tokens integer CHECK (output_tokens >= 0),
  cost_usd numeric(10, 4) NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
  turns integer CHECK (turns >= 0),
  files_changed jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (pg_column_size(files_changed) <= 16384),
  -- What the runner said about its checks: kept, shown as a claim, never used as QA evidence.
  claimed_validation jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Claude's own account of the fix: a model-written hypothesis, never a verified fact.
  hypothesis text CHECK (char_length(hypothesis) <= 1500),
  qa_outcome text CHECK (qa_outcome IN ('PASS', 'FAIL', 'BLOCKED', 'NEEDS_REVIEW')),
  qa_report jsonb CHECK (qa_report IS NULL OR pg_column_size(qa_report) <= 16384),
  qa_at timestamptz,
  pr_url text CHECK (pr_url ~ '^https://github\.com/[^/]+/[^/]+/pull/[0-9]+$'),
  pr_number integer CHECK (pr_number > 0),
  failure_category text CHECK (failure_category ~ '^[a-z0-9][a-z0-9_.-]{0,59}$'),
  error text CHECK (char_length(error) <= 1000),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (exec_task_id, attempt)
);
CREATE INDEX eng_executions_goal ON atlas.eng_executions (exec_goal_id, created_at);
CREATE INDEX eng_executions_recent ON atlas.eng_executions (updated_at DESC);

CREATE TRIGGER eng_incidents_touch BEFORE UPDATE ON atlas.eng_incidents FOR EACH ROW EXECUTE FUNCTION atlas.touch_row();
CREATE TRIGGER eng_executions_touch BEFORE UPDATE ON atlas.eng_executions FOR EACH ROW EXECUTE FUNCTION atlas.touch_row();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'atlas_app') THEN
    GRANT SELECT, INSERT, UPDATE ON atlas.eng_repo_state, atlas.eng_incidents, atlas.eng_executions TO atlas_app;
  END IF;
END $$;
