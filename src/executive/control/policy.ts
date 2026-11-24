import { type Autonomy } from "./types";

// The autonomy policy, enforced in code before every dispatch. Approvals bind to one exact action:
// the action name, its target, its parameters and the requesting agent are hashed, and the hash is
// stored on the approval. If any of them changes, the hash no longer matches and a new approval is
// needed. Approvals expire. Only Khaneil decides them (the data API refuses agent keys), and an
// agent can never be the reviewer of its own request.

export const APPROVAL_TTL_MS = 48 * 3_600_000;

export interface ActionBinding {
  action: string;
  target: string;
  params: Record<string, string | number | boolean>;
  requestedBy: string;
}

/** Deterministic JSON: keys sorted at every level, so the same action always hashes the same. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v as Record<string, unknown>)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(v);
}

export async function bindingHash(b: ActionBinding): Promise<string> {
  const bytes = new TextEncoder().encode(canonical(b));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export type Authorization = { kind: "allowed"; note: string } | { kind: "needs_approval"; reason: string } | { kind: "refused"; reason: string };

export interface AuthorizeInput {
  goalAutonomy: Autonomy;
  actionLevel: Autonomy;
  estimatedCostUsd: number;
  budgetRemainingUsd: number;
  /** Highest spend level 2 may approve on its own for one task. */
  autoSpendCeilingUsd: number;
}

/** Whether a task may run on its own, needs Khaneil, or can't run at all. */
export function authorizeTask(a: AuthorizeInput): Authorization {
  if (a.estimatedCostUsd > a.budgetRemainingUsd) return { kind: "refused", reason: `It may cost up to $${a.estimatedCostUsd.toFixed(2)} and only $${Math.max(0, a.budgetRemainingUsd).toFixed(2)} of the goal's budget is left.` };
  if (a.actionLevel >= 4) return { kind: "needs_approval", reason: "Level 4 action: Khaneil approves this exact action first." };
  if (a.actionLevel > a.goalAutonomy) return { kind: "needs_approval", reason: `Needs level ${a.actionLevel}; this goal runs at level ${a.goalAutonomy}.` };
  if (a.estimatedCostUsd > a.autoSpendCeilingUsd) return { kind: "needs_approval", reason: `May spend $${a.estimatedCostUsd.toFixed(2)}, above the $${a.autoSpendCeilingUsd.toFixed(2)} that runs without approval.` };
  return { kind: "allowed", note: a.actionLevel === 1 ? "Read-only." : `Level ${a.actionLevel} action inside the goal's level ${a.goalAutonomy}.` };
}

export interface ApprovalRecord {
  status: string;
  reviewer: string | null;
  requestedBy: string;
  expiresAt: string | null;
  /** Hash stored when the request was filed. */
  bindingHash: string | null;
}

export type ApprovalCheck = { ok: true } | { ok: false; state: "pending" | "rejected" | "expired" | "invalid"; reason: string };

/** Is this approval valid for this exact action, now? */
export async function checkApproval(r: ApprovalRecord, binding: ActionBinding, now: number): Promise<ApprovalCheck> {
  if (r.status === "rejected" || r.status === "cancelled") return { ok: false, state: "rejected", reason: "Khaneil rejected it." };
  if (r.status === "expired" || (r.expiresAt && Date.parse(r.expiresAt) <= now)) return { ok: false, state: "expired", reason: "The approval request expired." };
  if (r.status === "pending") return { ok: false, state: "pending", reason: "Waiting for Khaneil." };
  if (r.status !== "approved") return { ok: false, state: "invalid", reason: `Unknown approval state ${r.status}.` };
  if (!r.reviewer || r.reviewer === r.requestedBy || r.reviewer === binding.requestedBy) return { ok: false, state: "invalid", reason: "An agent can't approve its own request." };
  if (!r.bindingHash || r.bindingHash !== (await bindingHash(binding))) return { ok: false, state: "invalid", reason: "The action changed after it was approved; it needs a new approval." };
  return { ok: true };
}
