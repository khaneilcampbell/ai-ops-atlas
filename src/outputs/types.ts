import type { RunMode } from "../workflows/types";

// Agent Output Studio: what each step of a workflow run produced, as cards a person can read.
// Nothing here is stored. Live outputs are derived on demand from the run's real execution
// records (Task Center tasks, the execution ledger's validated handoffs, agent intelligence);
// simulated ones come from fixed sample data and say so. Large documents stay behind their
// https artifact link and are never copied into an output.

export type OutputType = "text" | "markdown" | "table" | "chart" | "json" | "document" | "code" | "image" | "link" | "error";
export const OUTPUT_TYPES: readonly OutputType[] = ["text", "markdown", "table", "chart", "json", "document", "code", "image", "link", "error"];

/** The Studio's toolbar groups. Errors are kept apart from successful outputs. */
export type OutputCategory = "research" | "analytics" | "decisions" | "documents" | "engineering" | "errors";
export const OUTPUT_CATEGORIES: readonly OutputCategory[] = ["research", "analytics", "decisions", "documents", "engineering", "errors"];
export const CATEGORY_LABEL: Record<OutputCategory, string> = {
  research: "Research",
  analytics: "Analytics",
  decisions: "Decisions",
  documents: "Documents",
  engineering: "Engineering",
  errors: "Errors",
};

/** verified: a complete output that passed its schema on the step's finished task. Never set for partial, person-entered or simulated data. */
export type VerificationStatus = "verified" | "unverified" | "simulated";
export const VERIFICATION_LABEL: Record<VerificationStatus, string> = { verified: "Verified", unverified: "Unverified", simulated: "Simulated" };

/** Where the output is in its life: still being made, made in part, done, failed, or not obtainable. */
export type OutputState = "loading" | "partial" | "complete" | "failed" | "missing" | "unconfigured";
export const STATE_LABEL: Record<OutputState, string> = {
  loading: "Working",
  partial: "Partial",
  complete: "Complete",
  failed: "Failed",
  missing: "Missing",
  unconfigured: "Not set up",
};

export interface TableData {
  columns: string[];
  rows: (string | number)[][];
}
export interface ChartData {
  /** Bars, in order. Values are finite numbers taken from the record, never filled in. */
  series: { label: string; value: number }[];
  unit?: string;
  /** Scale top. Defaults to the largest value. */
  max?: number;
}
export interface DocumentData {
  sections: { heading: string; body: string }[];
}
export interface CodeData {
  language: string;
  code: string;
}
export interface ErrorData {
  message: string;
  attempt?: number;
}

/** A validated https artifact the output points at. */
export interface OutputArtifact {
  id: string;
  label: string;
  url: string;
  kind: string;
}

/** Execution intelligence already recorded for the step. Every field is optional: absent means not recorded. */
export interface OutputIntel {
  model?: string;
  tier?: number;
  memory?: string[];
  tools?: string[];
  tokens?: number;
  estimatedUsd?: number;
  billedUsd?: number;
  score?: number | null;
  flags?: string[];
  feedback?: { rating: number; note: string; by: string };
}

export interface AgentOutput {
  id: string;
  workflowRunId: string;
  taskId: string;
  agentId: string;
  nodeId: string;

  type: OutputType;
  title: string;
  summary?: string;

  /** Id of the artifact behind this output, when there is one. */
  artifactRef?: string;
  artifact?: OutputArtifact;
  structuredData?: unknown;

  createdAt: string;
  verificationStatus: VerificationStatus;
  sourceRefs?: string[];

  mode: RunMode;
  category: OutputCategory;
  state: OutputState;
  /** Task attempt that produced it; null when the output isn't tied to one attempt. */
  attempt: number | null;
  /** False for outputs of an earlier attempt of the same step. */
  latest: boolean;
  intel?: OutputIntel;
}
