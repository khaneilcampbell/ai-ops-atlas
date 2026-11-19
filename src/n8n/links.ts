import type { Agent } from "../catalog/types";

// Pure helpers for reading n8n workflow links off a catalog agent. No React, so the registry can use them.

/** Every n8n workflow id a catalog agent links to (links to …/workflow/<id> on its n8n instance), in link order. */
export function n8nWorkflowIds(agent: Pick<Agent, "links">): string[] {
  const out: string[] = [];
  for (const l of agent.links ?? []) {
    const m = /^https:\/\/[^/]+\/workflow\/([A-Za-z0-9]+)(?:[/?#]|$)/.exec(l.url);
    if (m && /n8n/i.test(new URL(l.url).hostname + l.label) && !out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/** The agent's main n8n workflow: the first one it links to. Its runs set the agent's health. */
export function n8nWorkflowId(agent: Pick<Agent, "links">): string | null {
  return n8nWorkflowIds(agent)[0] ?? null;
}
