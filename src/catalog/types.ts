import type { RegistryManifest } from "../registry/types";

/** Manifest versions. atlas/v2 adds the optional per-agent `registry` block. */
export const SCHEMAS = ["atlas/v1", "atlas/v2"] as const;

export const STATUSES = ["active", "idle", "paused", "attention", "retired"] as const;
export type Status = (typeof STATUSES)[number];

export interface Link {
  label: string;
  url: string;
}

export interface HistoryEntry {
  at: string;
  event: string;
}

export interface Agent {
  id: string;
  /** Display name: the registry title when one is set, otherwise the manifest name. */
  name: string;
  /** The manifest `name`, kept when a registry title replaces it for display. */
  originalName?: string;
  purpose: string;
  framework: string;
  model?: string;
  runtime?: string;
  status: Status;
  trigger?: string;
  source?: string;
  lastRun: string | null;
  /** What the agent can do, as declared in its manifest. Empty when not declared. */
  capabilities?: string[];
  /** Access it holds, such as "Shopify Admin API: write products". Empty when not declared. */
  permissions?: string[];
  history: HistoryEntry[];
  links: Link[];
  /** Read-only live sources the app may consult for this agent. */
  observe?: { githubWorkflow?: string; atlasIntel?: boolean };
  /** Hand-maintained registry profile (atlas/v2). Absent on atlas/v1 agents. */
  registry?: RegistryManifest;
  projectId: string;
  repository: string;
}

export interface Project {
  id: string;
  name: string;
  summary: string;
  status: Status;
  repository: string;
  tags: string[];
  links: Link[];
  agentIds: string[];
}

export interface Catalog {
  projects: Project[];
  agents: Agent[];
}

export interface ManifestIssue {
  file: string;
  message: string;
}
