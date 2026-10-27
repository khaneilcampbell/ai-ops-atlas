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
  name: string;
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
  observe?: { githubWorkflow?: string };
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
