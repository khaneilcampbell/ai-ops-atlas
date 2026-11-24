import { ESSENTIAL_ROLES, isArchived, isInactive, placement, roleActivity, roleDirectory, isSkill, type Activity } from "../../catalog/essentialRoles";
import { isAiAgent } from "../../catalog/roles";
import type { Agent, Project } from "../../catalog/types";
import type { Operational } from "../../registry/types";

// The Agents > Team view (2026-11-24): the 8 essential roles drawn as an org chart. Presentation
// only: every number comes from the catalog and observed runs, never a made-up metric.

type Entry = { operational: Operational; lastVerifiedAt: string | null };

export interface TeamRole {
  id: string;
  name: string;
  purpose: string;
  lead: string;
  /** The role's other AI agents, in role order. */
  members: string[];
  /** Names of skills that run inside the lead agent; part of the lead, not agents. */
  skills: string[];
  aiAgents: number;
  automations: number;
  building: string | null;
  activity: Activity;
  /** One line on the role's health, from observed runs only. */
  health: { tone: "good" | "bad" | "unknown"; label: string };
}

export interface NeedsYou {
  kind: "failing" | "inactive" | "draft";
  id: string;
  /** Agent whose desk the item belongs to: the entry itself, or an automation's owner. */
  agent: string;
  title: string;
  detail: string;
  link: { label: string; url: string } | null;
}

export interface Team {
  coordinator: TeamRole;
  roles: TeamRole[];
  needs: NeedsYou[];
  lifecycle: { active: string[]; inactive: string[]; archived: number };
  counts: { aiAgents: number; skills: number; unassigned: number; automations: number; inactive: number; archived: number };
}

export function roleHealth(a: Activity): TeamRole["health"] {
  if (a.failing) return { tone: "bad", label: `${a.failing} failing` };
  if (a.verified) return { tone: "good", label: `${a.verified} verified running` };
  return { tone: "unknown", label: "No verified run" };
}

const isDraft = (a: Pick<Agent, "status" | "trigger">) => a.status === "paused" && /\bdraft\b/i.test(a.trigger ?? "");
const n8nLink = (a: Pick<Agent, "links">) => a.links?.find((l) => /n8n/i.test(l.label)) ?? null;

export function buildTeam(agents: Agent[], projects: Pick<Project, "id" | "name" | "module">[], entries: ReadonlyMap<string, Entry>, now = Date.now()): Team {
  const dir = roleDirectory(agents);
  const byId = new Map(agents.map((a) => [a.id, a]));
  const roles: TeamRole[] = ESSENTIAL_ROLES.map((r) => {
    const all = dir.members.get(r.id) ?? [];
    const lead = byId.get(r.id);
    const activity = roleActivity(all.flatMap((id) => (entries.has(id) ? [entries.get(id)!] : [])), now);
    return {
      id: r.id,
      name: r.name,
      purpose: r.purpose,
      lead: r.id,
      members: r.agents.slice(1).filter((id) => byId.has(id) && !isArchived(byId.get(id)!)),
      skills: (r.skills ?? []).filter((id) => byId.has(id) && !isArchived(byId.get(id)!)).map((id) => byId.get(id)!.name),
      aiAgents: r.agents.filter((id) => byId.has(id) && !isArchived(byId.get(id)!)).length,
      automations: all.filter((id) => !isAiAgent(byId.get(id)!)).length,
      building: lead ? placement(lead, projects).building : null,
      activity,
      health: roleHealth(activity),
    };
  });

  const needs: NeedsYou[] = [];
  for (const a of agents) {
    if (isArchived(a)) continue;
    const agent = isAiAgent(a) ? a.id : (a.ownedBy ?? a.id);
    if (entries.get(a.id)?.operational === "failing") needs.push({ kind: "failing", id: a.id, agent, title: `${a.name} is failing`, detail: "Last run failed", link: n8nLink(a) });
    else if (isDraft(a)) needs.push({ kind: "draft", id: a.id, agent, title: `Publish ${a.name}`, detail: "Draft in n8n, paused until you publish it", link: n8nLink(a) });
    else if (isAiAgent(a) && isInactive(a)) needs.push({ kind: "inactive", id: a.id, agent, title: `${a.name} is inactive`, detail: "Reactivate or archive it", link: null });
  }
  const order = { failing: 0, draft: 1, inactive: 2 };
  needs.sort((x, y) => order[x.kind] - order[y.kind]);

  const ai = agents.filter((a) => isAiAgent(a) && !isSkill(a));
  return {
    coordinator: roles[0],
    roles: roles.slice(1),
    needs,
    lifecycle: {
      active: ai.filter((a) => !isArchived(a) && !isInactive(a)).map((a) => a.id),
      inactive: ai.filter((a) => !isArchived(a) && isInactive(a)).map((a) => a.id),
      archived: dir.counts.archived,
    },
    counts: { aiAgents: dir.counts.aiAgents, skills: dir.counts.skills, unassigned: dir.unassigned.length, automations: dir.counts.automations, inactive: dir.counts.inactive, archived: dir.counts.archived },
  };
}
