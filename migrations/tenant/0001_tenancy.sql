-- Atlas tenancy schema, version 1. For a NEW, separate D1 database bound as TENANT.
-- Never applied automatically: see docs/multi-tenancy.md for the staged apply, backup and rollback.
-- It does not touch the existing atlas-live (LIVE) database.
--
-- SQLite has no row-level security, so isolation is enforced three ways:
--   1. every tenant table's primary key starts with org_id, and the server binds org_id from the
--      verified membership, never from the request;
--   2. composite foreign keys (org_id, ...) make a cross-organization reference impossible to store;
--   3. usage and audit events are append-only (triggers refuse UPDATE and DELETE).
-- D1 enforces foreign keys by default.

CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  owner_user_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'suspended', 'deleted')),
  settings TEXT NOT NULL DEFAULT '{}',
  protected INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memberships (
  org_id TEXT NOT NULL REFERENCES organizations(id),
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'operator', 'viewer')),
  status TEXT NOT NULL CHECK (status IN ('active', 'removed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (org_id, user_id)
);
CREATE INDEX IF NOT EXISTS memberships_user ON memberships(user_id, status);

CREATE TABLE IF NOT EXISTS workspaces (
  org_id TEXT NOT NULL REFERENCES organizations(id),
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  settings TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (org_id, id)
);

-- Shared agent templates. Read by every organization, written only by a platform admin.
CREATE TABLE IF NOT EXISTS agent_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  body TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Every organization-owned record: projects (buildings), agents, workflows, tasks, runs, memory,
-- artifacts, business and customer records. Ids are kept exactly as they were on the device.
CREATE TABLE IF NOT EXISTS resources (
  org_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('project', 'agent', 'workflow', 'task', 'workflow_run', 'memory', 'artifact', 'business_record', 'customer_record')),
  id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  template_id TEXT REFERENCES agent_templates(id),
  body TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (org_id, kind, id),
  FOREIGN KEY (org_id, workspace_id) REFERENCES workspaces(org_id, id)
);
CREATE INDEX IF NOT EXISTS resources_ws ON resources(org_id, workspace_id, kind);

-- References between records (task -> agent, task -> dependency, run -> workflow, memory -> project).
-- Both ends carry the same org_id, so the database itself refuses a reference into another organization.
CREATE TABLE IF NOT EXISTS resource_refs (
  org_id TEXT NOT NULL,
  from_kind TEXT NOT NULL,
  from_id TEXT NOT NULL,
  rel TEXT NOT NULL,
  to_kind TEXT NOT NULL,
  to_id TEXT NOT NULL,
  PRIMARY KEY (org_id, from_kind, from_id, rel, to_kind, to_id),
  FOREIGN KEY (org_id, from_kind, from_id) REFERENCES resources(org_id, kind, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, to_kind, to_id) REFERENCES resources(org_id, kind, id)
);
CREATE INDEX IF NOT EXISTS resource_refs_to ON resource_refs(org_id, to_kind, to_id);

-- Organization-scoped integration credentials, AES-GCM encrypted with the site's TENANT_VAULT_KEY.
-- The organization and integration ids are the cipher's additional data, so a ciphertext copied to
-- another organization does not decrypt. The plaintext never leaves the server.
CREATE TABLE IF NOT EXISTS org_integrations (
  org_id TEXT NOT NULL REFERENCES organizations(id),
  id TEXT NOT NULL,
  provider TEXT NOT NULL,
  label TEXT NOT NULL,
  scopes TEXT NOT NULL DEFAULT '[]',
  ciphertext TEXT,
  iv TEXT,
  key_version INTEGER NOT NULL DEFAULT 1,
  fingerprint TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
  last_check_at TEXT,
  last_check TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  rotated_at TEXT,
  PRIMARY KEY (org_id, id)
);

-- Append-only usage events. measurement says whether the quantity was metered by a provider or estimated.
CREATE TABLE IF NOT EXISTS usage_events (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  resource_type TEXT NOT NULL,
  quantity REAL NOT NULL CHECK (quantity >= 0),
  unit TEXT NOT NULL,
  measurement TEXT NOT NULL CHECK (measurement IN ('metered', 'estimated')),
  at TEXT NOT NULL,
  provider_ref TEXT,
  correlation_id TEXT,
  dedup_key TEXT NOT NULL,
  UNIQUE (org_id, dedup_key)
);
CREATE INDEX IF NOT EXISTS usage_period ON usage_events(org_id, at);
CREATE TRIGGER IF NOT EXISTS usage_events_no_update BEFORE UPDATE ON usage_events BEGIN SELECT RAISE(ABORT, 'usage_events is append-only'); END;
CREATE TRIGGER IF NOT EXISTS usage_events_no_delete BEFORE DELETE ON usage_events BEGIN SELECT RAISE(ABORT, 'usage_events is append-only'); END;

-- Counters for daily and monthly quotas, raised with one conditional statement so concurrent
-- requests can't push past the limit.
CREATE TABLE IF NOT EXISTS quota_counters (
  org_id TEXT NOT NULL REFERENCES organizations(id),
  metric TEXT NOT NULL,
  period TEXT NOT NULL,
  used REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (org_id, metric, period)
);

-- One row per execution in flight, for the concurrent-execution limit. Leases expire so a lost
-- callback can't hold a slot forever.
CREATE TABLE IF NOT EXISTS execution_leases (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  dispatch_id TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS execution_leases_org ON execution_leases(org_id, expires_at);

-- Every dispatch carries its trusted tenant context. Callbacks look the organization up here; an
-- organization id in a callback body is never believed.
CREATE TABLE IF NOT EXISTS tenant_dispatch (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 1,
  state TEXT NOT NULL CHECK (state IN ('dispatched', 'succeeded', 'failed', 'cancelled')),
  requested_by TEXT NOT NULL,
  callback_key_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  task_kind TEXT NOT NULL DEFAULT 'task' CHECK (task_kind = 'task'),
  agent_kind TEXT NOT NULL DEFAULT 'agent' CHECK (agent_kind = 'agent'),
  workflow_kind TEXT NOT NULL DEFAULT 'workflow' CHECK (workflow_kind = 'workflow'),
  FOREIGN KEY (org_id, workspace_id) REFERENCES workspaces(org_id, id),
  FOREIGN KEY (org_id, task_kind, task_id) REFERENCES resources(org_id, kind, id),
  FOREIGN KEY (org_id, agent_kind, agent_id) REFERENCES resources(org_id, kind, id),
  FOREIGN KEY (org_id, workflow_kind, workflow_id) REFERENCES resources(org_id, kind, id)
);
CREATE INDEX IF NOT EXISTS tenant_dispatch_org ON tenant_dispatch(org_id, created_at);

-- Append-only audit log: membership changes, administrative actions, refused access.
CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  org_id TEXT,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('allowed', 'denied', 'error')),
  correlation_id TEXT,
  detail TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS audit_org ON audit_events(org_id, at);
CREATE TRIGGER IF NOT EXISTS audit_events_no_update BEFORE UPDATE ON audit_events BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_events_no_delete BEFORE DELETE ON audit_events BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;

INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
