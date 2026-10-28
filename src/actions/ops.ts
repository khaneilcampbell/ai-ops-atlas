import { isSelfRepo } from "./rerun";
import type { ActionSwitch, ActionsStatus, Group } from "./types";

export type OpAvailability = { show: false } | { show: true; enabled: true } | { show: true; enabled: false; reason: string };

const OFF: ActionSwitch = { enabled: false, repos: [] };

export function opSwitch(status: ActionsStatus | null, group: Group): ActionSwitch {
  return status?.config[group] ?? OFF;
}

/**
 * Whether to offer one of the everyday actions on a repository. Nothing is shown until the
 * action is switched on in Settings, so the dashboard looks the same for anyone who never opts in.
 */
export function opAvailability(group: Group, repo: string, status: ActionsStatus | null): OpAvailability {
  const sw = opSwitch(status, group);
  if (!status || !sw.enabled) return { show: false };
  const off = (reason: string): OpAvailability => ({ show: true, enabled: false, reason });
  if (group === "run_workflows" && isSelfRepo(repo)) return off("Atlas doesn't start its own workflows: a run publishes a release");
  if (!sw.repos.some((r) => r.toLowerCase() === repo.toLowerCase())) return off("Not ticked for this repository in Settings");
  if (group === "pull_request_changes") {
    if (!(status.merge_tokens ?? []).includes(repo.toLowerCase())) return off("Save a pull request token for this repository in Settings");
  } else if (!status.token) return off("Add an Actions token in Settings");
  return { show: true, enabled: true };
}

/** Run states GitHub can still cancel. */
export const CANCELLABLE = ["queued", "in_progress", "waiting", "pending", "requested"];

export const GROUPS: { group: Group; label: string; short: string; help: string }[] = [
  { group: "cancel_runs", label: "Cancel runs", short: "Cancel", help: "A Cancel button on queued and running workflow runs." },
  { group: "run_workflows", label: "Run workflows", short: "Run", help: "A Run button for an agent's workflow when its file has a workflow_dispatch trigger. Never offered for Atlas itself." },
  { group: "pause_workflows", label: "Pause and resume", short: "Pause", help: "Turns an agent's workflow off on GitHub, or back on." },
  { group: "pull_request_changes", label: "Close, reopen and comment on PRs", short: "PRs", help: "Uses the repository's pull request token, the same one merges use." },
];
