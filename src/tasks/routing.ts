import type { AgentProfile } from "./registry";
import type { TaskSource } from "./types";

// Routing picks an agent and building for a task by fixed rules, without a model. It is an
// interface so a planner can replace it later. Routing only suggests: whether the agent may run
// the work is still checked when the task starts (lifecycle.startProblem), whatever routed it.

export interface RouteInput {
  title: string;
  description?: string;
  source: TaskSource;
  buildingId?: string;
  /** A capability the work needs, such as "triage" or "deploy". */
  capability?: string;
  /** An agent the event already names (an n8n workflow's owner). Wins when it can take work. */
  agentId?: string;
}

export interface RouteDecision {
  agentId: string;
  buildingId: string;
  /** Plain words on why this agent was picked. */
  reason: string;
}

export interface Router {
  route(input: RouteInput, agents: readonly AgentProfile[]): RouteDecision | null;
}

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3);

/**
 * The default router:
 * 1. an agent the event names, if it can take work;
 * 2. otherwise agents in the task's building (or anywhere) whose declared capabilities match the
 *    capability asked for, or share the most words with the title;
 * 3. ties go to the agent id that sorts first, so the same input always gives the same answer.
 */
export const ruleRouter: Router = {
  route(input, agents) {
    const open = agents.filter((a) => !a.unavailable);
    if (input.agentId) {
      const named = open.find((a) => a.id === input.agentId);
      if (named) return { agentId: named.id, buildingId: named.buildingId, reason: "Named by the event that made the task." };
    }
    const pool = input.buildingId ? open.filter((a) => a.buildingId === input.buildingId) : open;
    const need = input.capability?.toLowerCase();
    const terms = new Set(words(`${input.title} ${input.description ?? ""}`));
    let best: { a: AgentProfile; score: number } | null = null;
    for (const a of [...pool].sort((x, y) => x.id.localeCompare(y.id))) {
      const caps = a.capabilities.map((c) => c.toLowerCase());
      let score = 0;
      if (need) score += caps.some((c) => c.includes(need)) ? 10 : 0;
      for (const c of caps) for (const w of words(c)) if (terms.has(w)) score++;
      if (score > 0 && (!best || score > best.score)) best = { a, score };
    }
    if (!best) return null;
    return { agentId: best.a.id, buildingId: best.a.buildingId, reason: need && best.score >= 10 ? `Declares the "${input.capability}" capability.` : "Its declared capabilities match the task's words best." };
  },
};
