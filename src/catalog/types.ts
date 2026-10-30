import type { RegistryManifest } from "../registry/types";
import type { DistrictId } from "./taxonomy";

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
  /** Physical workplace; project/repository ownership remains unchanged. */
  officeFloor?: number;
  workplace?: {building:string;floor:number;room:string};
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
  observe?: { githubWorkflow?: string; atlasIntel?: boolean; atlasIntelRuns?: "repository" | "ecosystem"; agentFeed?: boolean };
  /** When Atlas should raise an alert for this agent. Absent means it is not watched. */
  alerts?: AlertRules;
  /** Hand-maintained registry profile (atlas/v2). Absent on atlas/v1 agents. */
  registry?: RegistryManifest;
  projectId: string;
  repository: string;
}

/** A manifest's `alerts` block: what counts as an alert for an unattended agent. */
export interface AlertRules {
  /** A failed run raises an alert. */
  failures: boolean;
  /** No report for this long (ms) means the agent has gone silent. Null for agents that only run
   *  when something happens (a form post), where a quiet stretch is normal. */
  reportWithinMs: number | null;
  /** Set when the agent is off on purpose (its host is gone): no alerts, shown as not running. */
  notRunning: string | null;
}

/** Kinds of relationship the map draws between buildings. */
export const CONNECTION_TYPES = ["github", "agent", "n8n", "dependency"] as const;
export type ConnectionType = (typeof CONNECTION_TYPES)[number];

/** A relationship a manifest states outright, from this project to another project or agent. */
export interface DeclaredConnection {
  /** Project id or agent id. */
  to: string;
  type: ConnectionType;
  /** Which way data or control flows; left out when it is not known. */
  direction?: "outbound" | "inbound";
  /** What the relationship is and how it was verified. */
  note: string;
}

export interface Project {
  id: string;
  name: string;
  summary: string;
  status: Status;
  /** Default repository for agent source paths and existing integrations. */
  repository: string;
  /** Additional linked resources; building identity is always project.id. */
  repositories?: string[];
  tags: string[];
  /** Infrastructure district declared in the manifest; Atlas infers one when this is absent. */
  district?: DistrictId;
  links: Link[];
  agentIds: string[];
  /** Relationships the manifest declares; empty when none. */
  connections?: DeclaredConnection[];
  /** Manifest file name, for citing evidence. */
  file?: string;
}

export interface Catalog {
  projects: Project[];
  agents: Agent[];
}

export interface ManifestIssue {
  file: string;
  message: string;
}
