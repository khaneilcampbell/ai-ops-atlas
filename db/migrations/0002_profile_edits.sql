-- Profile edits: display text Khaneil changes in Atlas (an agent's name, job title, description,
-- intro and communication style) instead of asking for a pull request. The catalog files stay the
-- defaults; a row here is shown on top of them on every tab. Display text only: nothing here
-- changes how an agent runs, what it can reach, or its status. Agents and n8n never write here
-- (the data API allows it only through Cloudflare Access), and every change is logged.

CREATE TABLE atlas.profile_edits (
  entity_type text NOT NULL DEFAULT 'agent' CHECK (entity_type IN ('agent')),
  entity_id text NOT NULL CHECK (entity_id ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  field text NOT NULL CHECK (field IN ('display_name', 'title', 'summary', 'intro', 'voice')),
  value text NOT NULL CHECK (char_length(value) BETWEEN 1 AND 600),
  updated_by text NOT NULL CHECK (char_length(updated_by) <= 200),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_type, entity_id, field)
);
CREATE TRIGGER profile_edits_touch BEFORE UPDATE ON atlas.profile_edits FOR EACH ROW EXECUTE FUNCTION atlas.touch_row();

-- Every save and every undo, with the text before and after (after null = back to the repository
-- text). Append-only for the site's role.
CREATE TABLE atlas.profile_edit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL DEFAULT 'agent' CHECK (entity_type IN ('agent')),
  entity_id text NOT NULL CHECK (entity_id ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  field text NOT NULL CHECK (field IN ('display_name', 'title', 'summary', 'intro', 'voice')),
  before text CHECK (char_length(before) <= 600),
  after text CHECK (char_length(after) <= 600),
  actor text NOT NULL CHECK (char_length(actor) <= 200),
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX profile_edit_log_at ON atlas.profile_edit_log (at DESC);
CREATE INDEX profile_edit_log_entity ON atlas.profile_edit_log (entity_type, entity_id, at DESC);

-- The site's role (db/roles.sql) may save and remove edits, and add log lines, but never rewrite
-- or delete the log. Skipped where the role doesn't exist yet (roles.sql grants it then).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'atlas_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON atlas.profile_edits TO atlas_app;
    GRANT SELECT, INSERT ON atlas.profile_edit_log TO atlas_app;
  END IF;
END;
$$;
