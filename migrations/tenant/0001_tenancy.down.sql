-- Rollback for 0001_tenancy.sql. Removes ONLY the tenancy tables from the separate TENANT database.
-- The atlas-live (LIVE) database and every device's own storage are untouched by both directions.
-- Export a backup first: npx wrangler d1 export atlas-tenant --remote --output=atlas-tenant-backup.sql
DROP TRIGGER IF EXISTS audit_events_no_delete;
DROP TRIGGER IF EXISTS audit_events_no_update;
DROP TRIGGER IF EXISTS usage_events_no_delete;
DROP TRIGGER IF EXISTS usage_events_no_update;
DROP TABLE IF EXISTS audit_events;
DROP TABLE IF EXISTS tenant_dispatch;
DROP TABLE IF EXISTS execution_leases;
DROP TABLE IF EXISTS quota_counters;
DROP TABLE IF EXISTS usage_events;
DROP TABLE IF EXISTS org_integrations;
DROP TABLE IF EXISTS resource_refs;
DROP TABLE IF EXISTS resources;
DROP TABLE IF EXISTS agent_templates;
DROP TABLE IF EXISTS workspaces;
DROP TABLE IF EXISTS memberships;
DROP TABLE IF EXISTS organizations;
DROP TABLE IF EXISTS schema_version;
