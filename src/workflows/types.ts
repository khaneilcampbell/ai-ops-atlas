import type { SensitiveCategory, TaskStatus } from "../tasks/types";

// Workflow Intelligence: the shared data model. A WorkflowDefinition is a reusable, versioned plan
// made of nodes and edges. A WorkflowRun is one execution of it and keeps a frozen copy of the
// definition it started from, so history still reads after the template changes.
//
// Nothing here keeps task or agent state of its own. Nodes point at Agent Registry ids (the Atlas
// catalog) and Atlas building ids; a live run points each node at a Task Center task, and every
// status, approval and event is read back from that task.

export const NODE_KINDS = ["agent", "automation", "decision", "approval", "outcome"] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

/** How a node's work is carried out, as far as Atlas can verify it. */
export interface NodeExecution {
  /**
   * `n8n` / `github`: an existing workflow does the work. `owned`: the agent works through the
   * automations it owns. `manual`: a person does it and records it
   * in the Task Center. `none`: nothing is set up, so the node is unconfigured.
   */
  kind: "n8n" | "github" | "owned" | "manual" | "none";
  /** Plain words: where it runs and what Atlas can and can't do with it. */
  note: string;
}

export interface WorkflowNode {
  id: string;
  kind: NodeKind;
  /** The stage of the goal this node belongs to (1-based, shown in the inspector and used for grouping). */
  stage: number;
  title: string;
  summary: string;
  /** Agent Registry id (catalog agent id). Its name and building are read from the registry. */
  agentId?: string;
  /** Atlas building (catalog project id). Only for nodes without an agent; agent nodes use the agent's building. */
  buildingId?: string;
  inputs: string[];
  outputs: string[];
  execution: NodeExecution;
  /** Human approval this node needs before its work can run. Enforced by the Task Center. */
  approval?: { categories: SensitiveCategory[]; reason: string };
  /** Why the step can't run yet. Set when the capability doesn't exist; such a node is shown as unconfigured. */
  unconfigured?: string;
  /** What the registry entry can't prove about this step, said plainly in the inspector. */
  caveat?: string;
}

export interface WorkflowEdge {
  id: string;
  from: string;
  to: string;
  /** For edges out of a decision node: which answer takes this path. */
  branch?: "yes" | "no";
  label?: string;
}

export interface WorkflowDefinition {
  id: string;
  /** Bumped whenever nodes or edges change. Runs keep the version they started from. */
  version: number;
  name: string;
  updatedAt: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface Goal {
  id: string;
  name: string;
  objective: string;
  expectedOutcome: string;
  definitionId: string;
}

export type RunMode = "simulation" | "live";

/**
 * One live execution of a workflow. Only live runs are stored; a simulation is computed from the
 * definition and never saved. `nodeTasks` maps each node to the Task Center task that carries it.
 */
export interface WorkflowRun {
  id: string;
  goalId: string;
  definitionId: string;
  definitionVersion: number;
  /** Frozen copy of the definition at start. Never edited after the run is made. */
  snapshot: WorkflowDefinition;
  mode: "live";
  createdAt: string;
  createdBy: string;
  nodeTasks: Record<string, string>;
  /** Nodes whose task could not be made, with the Task Center's reason. */
  errors: Record<string, string>;
}

/** What a node shows. Task statuses come straight from the Task Center; the rest are workflow-only. */
export type NodeStatus = TaskStatus | "not_started" | "unconfigured" | "skipped" | "no_task";

export const NODE_STATUS_LABEL: Record<NodeStatus, string> = {
  queued: "Queued",
  running: "Running",
  blocked: "Waiting on steps",
  awaiting_approval: "Awaiting approval",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  not_started: "Not started",
  unconfigured: "Unconfigured",
  skipped: "Branch not taken",
  no_task: "Task missing",
};

export type ExecutionEventType = "queued" | "started" | "waiting" | "handoff" | "approval_requested" | "approved" | "rejected" | "completed" | "failed" | "cancelled" | "retry" | "skipped";

/** One timeline entry. Live events are read from Task Center history; simulated ones say so. */
export interface ExecutionEvent {
  id: string;
  nodeId: string;
  at: string;
  type: ExecutionEventType;
  text: string;
  actor?: string;
  simulated: boolean;
  /** For handoffs: the node the work came from. */
  fromNodeId?: string;
}
