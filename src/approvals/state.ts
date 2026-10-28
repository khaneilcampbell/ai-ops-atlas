import { useMemo, useSyncExternalStore } from "react";
import { useActions } from "../actions/state";
import { useAtlas } from "../state";
import { load, save } from "../lib/storage";
import { proposals, type Proposal } from "./proposals";

// Dismissed proposal ids. A per-viewer convenience: a dismissed proposal only hides that one
// run attempt, and nothing is sent anywhere. Capped so the list can't grow without bound.
let dismissed = new Set<string>(load<string[]>("approvalsDismissed", []));
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function dismissProposal(id: string) {
  dismissed = new Set([...dismissed, id]);
  save("approvalsDismissed", [...dismissed].slice(-200));
  listeners.forEach((l) => l());
}

/** Pending proposals, newest first. Empty outside the desktop app or while the action is off. */
export function useProposals(): Proposal[] {
  const { repos } = useAtlas();
  const { status, audit } = useActions();
  const d = useSyncExternalStore(subscribe, () => dismissed);
  return useMemo(() => proposals(repos, status, audit, d), [repos, status, audit, d]);
}
