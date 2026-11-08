-- Benjaire dashboard schema v1.
-- Money is stored as integer cents. Timestamps are ISO 8601 UTC strings.
-- No customer names, emails or messages are ever stored here.

-- Manual expenses (Finance module). Soft-deleted so the audit trail holds.
CREATE TABLE expenses (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN ('recurring', 'one_time')),
  cadence       TEXT CHECK (cadence IN ('monthly', 'annual')),
  category      TEXT NOT NULL,
  vendor        TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  amount_cents  INTEGER NOT NULL CHECK (amount_cents > 0),
  currency      TEXT NOT NULL DEFAULT 'USD',
  start_date    TEXT NOT NULL,          -- recurring: first month billed; one_time: date incurred
  end_date      TEXT,                   -- recurring only, inclusive; NULL = ongoing
  product_key   TEXT,                   -- optional link to a product for profitability
  created_at    TEXT NOT NULL,
  created_by    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT,
  CHECK ((kind = 'recurring' AND cadence IS NOT NULL) OR (kind = 'one_time' AND cadence IS NULL AND end_date IS NULL))
);
CREATE INDEX expenses_dates ON expenses (start_date, end_date) WHERE deleted_at IS NULL;

-- Every write and every sensitive read, with a before/after copy.
CREATE TABLE audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         TEXT NOT NULL,
  actor      TEXT NOT NULL,
  action     TEXT NOT NULL,
  entity     TEXT NOT NULL,
  entity_id  TEXT,
  before     TEXT,
  after      TEXT
);
CREATE INDEX audit_log_at ON audit_log (at DESC);

-- One row per collector run, used for freshness labels and the Connections page.
CREATE TABLE sync_runs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  source       TEXT NOT NULL,
  started_at   TEXT NOT NULL,
  finished_at  TEXT,
  status       TEXT NOT NULL CHECK (status IN ('running', 'ok', 'error')),
  error_code   TEXT,
  detail       TEXT
);
CREATE INDEX sync_runs_source ON sync_runs (source, started_at DESC);

-- Daily aggregates so period comparisons survive upstream retention limits.
CREATE TABLE metric_snapshots (
  day           TEXT NOT NULL,          -- YYYY-MM-DD, America/New_York
  source        TEXT NOT NULL,
  metric        TEXT NOT NULL,
  dimension     TEXT NOT NULL DEFAULT '',
  value         REAL NOT NULL,
  unit          TEXT NOT NULL,
  state         TEXT NOT NULL CHECK (state IN ('live', 'delayed', 'estimated', 'manual')),
  collected_at  TEXT NOT NULL,
  PRIMARY KEY (day, source, metric, dimension)
);
