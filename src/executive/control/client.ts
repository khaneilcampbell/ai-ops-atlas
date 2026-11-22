import { useCallback, useEffect, useState } from "react";
import { isHostedWeb, isTauri } from "../../lib/env";
import { TERMINAL_GOAL_STATES, type ExecutiveOverview, type GoalView, type TaskState } from "./types";

// The Executive panel's view of the server engine. Only the hosted web page talks to it, through
// its own site (/api/executive, behind Cloudflare Access). The Mac app shows where to go instead:
// it has no route to the engine, and nothing here calls n8n or a model from the browser.

export type ControlState =
  | { state: "loading" }
  | { state: "off"; message: string }
  | { state: "not-configured"; message: string }
  | { state: "error"; message: string }
  | { state: "ready"; value: ExecutiveOverview };

const EVERY_MS = 60_000;

async function answerOf(r: Response): Promise<Record<string, unknown> & { message?: string }> {
  return ((await r.json().catch(() => null)) as (Record<string, unknown> & { message?: string }) | null) ?? {};
}

export const canControl = (): boolean => isHostedWeb();

export async function fetchControl(fetcher: typeof fetch = fetch, hosted = isHostedWeb(), app = isTauri()): Promise<ControlState> {
  if (app) return { state: "off", message: "The Executive runs on the Atlas web page. Open it there to set goals and follow them." };
  if (!hosted) return { state: "off", message: "The Executive runs on the hosted Atlas web page." };
  const r = await fetcher("/api/executive/overview", { credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(15_000) });
  const body = await answerOf(r);
  if (r.status === 503) return { state: "not-configured", message: body.message ?? "The Executive's database tables aren't set up yet." };
  if (!r.ok) return { state: "error", message: body.message ?? `The site answered ${r.status}.` };
  return { state: "ready", value: body as unknown as ExecutiveOverview };
}

export type ControlAction = "pause" | "resume" | "cancel" | "advance";

async function post(path: string, body: unknown, fetcher: typeof fetch): Promise<{ ok: boolean; message: string }> {
  const r = await fetcher(`/api/executive/${path}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(30_000),
  });
  const answer = await answerOf(r);
  return r.ok ? { ok: true, message: answer.message ?? "Done." } : { ok: false, message: answer.message ?? `The site answered ${r.status}.` };
}

export const submitGoal = (objective: string, budgetUsd: number | null, autonomy: number | null, fetcher: typeof fetch = fetch) =>
  post("goals", { objective, ...(budgetUsd ? { budgetUsd } : {}), ...(autonomy ? { autonomy } : {}) }, fetcher);
export const goalAction = (id: string, action: ControlAction, fetcher: typeof fetch = fetch) => post(`goals/${encodeURIComponent(id)}/${action}`, {}, fetcher);
export const checkNow = (fetcher: typeof fetch = fetch) => post("tick", {}, fetcher);

/** Reads the overview on open, every minute while visible, and after each action. */
export function useExecutiveControl(): { data: ControlState; refresh: () => void } {
  const [data, setData] = useState<ControlState>({ state: "loading" });
  const refresh = useCallback(() => {
    fetchControl()
      .then(setData)
      .catch((e: unknown) => setData({ state: "error", message: e instanceof Error && e.name === "TimeoutError" ? "The site didn't answer within 15 seconds." : e instanceof Error ? e.message : String(e) }));
  }, []);
  useEffect(() => {
    refresh();
    if (!isHostedWeb()) return;
    const t = setInterval(() => document.visibilityState === "visible" && refresh(), EVERY_MS);
    return () => clearInterval(t);
  }, [refresh]);
  return { data, refresh };
}

const RUNNING: ReadonlySet<TaskState> = new Set(["dispatching", "running", "verifying"]);

export interface ControlSummary {
  open: GoalView[];
  closed: GoalView[];
  running: number;
  blocked: number;
  awaitingApproval: number;
  verified: number;
  failed: number;
  spentUsd: number;
  /** One line for the map inspector and the panel header, from stored state only. */
  line: string;
}

/** Pure counts for the panel and the HQ inspector. Same overview in, same numbers out. */
export function summariseControl(o: ExecutiveOverview): ControlSummary {
  const open = o.goals.filter((g) => !TERMINAL_GOAL_STATES.has(g.state));
  const closed = o.goals.filter((g) => TERMINAL_GOAL_STATES.has(g.state));
  const tasks = o.goals.flatMap((g) => g.tasks);
  const running = tasks.filter((t) => RUNNING.has(t.state)).length;
  const blocked = open.filter((g) => g.state === "BLOCKED").length + tasks.filter((t) => t.state === "blocked").length;
  const awaitingApproval = o.approvals.filter((a) => a.status === "pending").length;
  const verified = tasks.filter((t) => t.artifact?.verification?.passed).length;
  const failed = o.goals.filter((g) => g.state === "FAILED").length;
  const spentUsd = Math.round(o.goals.reduce((s, g) => s + g.spentUsd, 0) * 100) / 100;
  const parts = [
    o.emergencyStop ? "Emergency stop is on" : null,
    `${open.length} open ${open.length === 1 ? "goal" : "goals"}`,
    running ? `${running} running` : null,
    awaitingApproval ? `${awaitingApproval} waiting for you` : null,
    blocked ? `${blocked} blocked` : null,
  ].filter(Boolean);
  return { open, closed, running, blocked, awaitingApproval, verified, failed, spentUsd, line: parts.join(" · ") };
}
