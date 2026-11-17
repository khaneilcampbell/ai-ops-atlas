import type { OpsEventType, OpsPolicy } from "./types";

// The approved recovery playbooks. A small, fixed registry changed only by a pull request. Every
// entry is read-only or touches only this device's own non-production records: none deletes data,
// rotates credentials, changes infrastructure, deploys, spends money, publishes or messages anyone.
// Those actions are not playbooks at all; they stay with Khaneil and their own approval gates.

/** What a playbook's adapter may touch. Anything else is refused by authorizeRecovery. */
export type SideEffect = "none" | "local";
export const ALLOWED_SIDE_EFFECTS: readonly SideEffect[] = ["none", "local"];

export type AdapterId = "status-refresh" | "execution-reconcile" | "task-retry" | "cache-rebuild" | "integration-recheck";

export interface Playbook {
  id: string;
  name: string;
  description: string;
  applies: readonly OpsEventType[];
  adapter: AdapterId;
  preconditions: readonly string[];
  /** The tool permissions it needs. A policy never grants more than these. */
  permissions: readonly string[];
  sideEffect: SideEffect;
  /** Bounded retries with exponential backoff (execution/policy backoffMs). */
  retry: { max: number };
  timeoutMs: number;
  verification: readonly string[];
  rollback: string;
  /** Who can start it: Khaneil at any level; Atlas only under an enabled policy at level 3. */
  approval: string;
  /** The allowlisted level 3 routine in executive/autonomy.ts ROUTINES. */
  routineId: string;
}

const OWNER_OR_L3 = "Khaneil can run it at any time. Atlas runs it on its own only when Khaneil enabled its policy and autonomy is level 3.";

export const PLAYBOOKS: readonly Playbook[] = [
  {
    id: "refresh-status",
    name: "Refresh stale read-only service status",
    description: "Reads the n8n run summary and GitHub security counts again through the site's read-only routes.",
    applies: ["integration.stale", "service.unhealthy"],
    adapter: "status-refresh",
    preconditions: ["The signal is stale or failing", "The site route is set up (not 'not set up')"],
    permissions: ["status.read"],
    sideEffect: "none",
    retry: { max: 3 },
    timeoutMs: 30_000,
    verification: ["The signal answers again with a newer timestamp"],
    rollback: "Nothing to roll back: it only reads.",
    approval: OWNER_OR_L3,
    routineId: "recovery-refresh-status",
  },
  {
    id: "reconcile-execution",
    name: "Reconcile an uncertain workflow execution",
    description: "Asks the outside system (n8n or GitHub) what happened to a run past its timeout. Never re-sends it and never treats a timeout as stopped.",
    applies: ["task.stalled"],
    adapter: "execution-reconcile",
    preconditions: ["The task's attempt is past its timeout or marked unknown", "The step belongs to a live workflow run"],
    permissions: ["status.read"],
    sideEffect: "none",
    retry: { max: 2 },
    timeoutMs: 60_000,
    verification: ["The attempt reaches a known state (succeeded, failed or confirmed running)"],
    rollback: "Nothing to roll back: it only asks. If the answer stays unknown, Khaneil records whether it ran.",
    approval: OWNER_OR_L3,
    routineId: "recovery-reconcile-execution",
  },
  {
    id: "retry-readonly-task",
    name: "Retry a verified idempotent read-only task",
    description: "Puts a failed task back in the queue, but only when its executor changes nothing outside Atlas and dedupes repeats, and no earlier attempt is unaccounted for.",
    applies: ["task.failed"],
    adapter: "task-retry",
    preconditions: ["The executor is read-only and idempotent", "No attempt is still unknown", "Attempts are left under the task's limit", "The failure looks transient"],
    permissions: ["tasks.retry"],
    sideEffect: "local",
    retry: { max: 2 },
    timeoutMs: 10_000,
    verification: ["The retried task completes"],
    rollback: "Cancel the queued task in the Task Center.",
    approval: OWNER_OR_L3,
    routineId: "recovery-retry-readonly",
  },
  {
    id: "rebuild-local-cache",
    name: "Rebuild the local repository cache",
    description: "Re-reads every tracked repository from GitHub and replaces this device's cached copy. Production data is never touched.",
    applies: ["integration.failing", "repo.health_changed"],
    adapter: "cache-rebuild",
    preconditions: ["The GitHub signal is failing or stale", "GitHub's hourly API budget isn't used up"],
    permissions: ["status.read"],
    sideEffect: "local",
    retry: { max: 2 },
    timeoutMs: 120_000,
    verification: ["Repositories load again on the next read"],
    rollback: "Nothing to roll back: the cache refills from GitHub on the next refresh.",
    approval: OWNER_OR_L3,
    routineId: "recovery-rebuild-cache",
  },
  {
    id: "recheck-integration",
    name: "Recheck an integration after a transient failure",
    description: "Asks one failing integration (n8n, GitHub security) to answer again after a timeout, rate limit or network error.",
    applies: ["integration.failing", "workflow.failed"],
    adapter: "integration-recheck",
    preconditions: ["The last failure looks transient (timeout, 429, 5xx, network)"],
    permissions: ["status.read"],
    sideEffect: "none",
    retry: { max: 3 },
    timeoutMs: 30_000,
    verification: ["The integration answers live on the next read"],
    rollback: "Nothing to roll back: it only reads.",
    approval: OWNER_OR_L3,
    routineId: "recovery-recheck-integration",
  },
];

export const playbook = (id: string) => PLAYBOOKS.find((p) => p.id === id);

/** The first approved playbook for an event type, or undefined (Atlas then recommends, never improvises). */
export const playbookFor = (types: readonly OpsEventType[]) => PLAYBOOKS.find((p) => types.some((t) => p.applies.includes(t)));

/** Default policies: every playbook off until Khaneil enables it. Conservative limits. */
export function defaultPolicies(): Record<string, OpsPolicy> {
  return Object.fromEntries(PLAYBOOKS.map((p) => [p.id, { playbookId: p.id, enabled: false, projects: ["*"], maxRetries: p.retry.max, perHour: 6, modelBudgetUsd: 0 } satisfies OpsPolicy]));
}
