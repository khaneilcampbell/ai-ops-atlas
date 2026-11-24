import { ESSENTIAL_ROLES } from "../catalog/essentialRoles";
import { ownership } from "../catalog/ownership";
import { directoryItems, isAiAgent } from "../catalog/roles";
import type { Agent } from "../catalog/types";
import type { Section } from "../lib/sections";
import { identityFor } from "../registry/identity";

// Intel → Overview: a guide to Atlas. Where things are comes from SECTIONS and the Agents and
// Automations page tabs; who does what comes from the catalog. Only the sentences below are written by
// hand, keyed by section, view or tab id, so a new tab, role, agent or automation shows up here on its
// own and guide.test.ts fails when a tab has no sentence yet.

export interface PlaceText { what: string; how: string }

/** One entry per section in SECTIONS, plus the Output Library (a drawer, not a page). */
export const PLACE_TEXT: Record<string, PlaceText> = {
  map: { what: "The city. Each district is an area of your work, each building is a project or a tool, and agents sit at desks inside.", how: "Drag to move, scroll or pinch to zoom, tap a building for its card. Inside shows the offices; View and Group change what the map highlights." },
  projects: { what: "Every project in the catalog as a searchable list.", how: "Search or filter, then open a project for its repositories, agents, automations and CI." },
  overview: { what: "Mission Control: what needs you today, failures, approvals waiting and what ran.", how: "Start here each day. The badge counts items that need your attention." },
  business: { what: "The business side: Benjaire revenue, products, inquiries and finance in one place.", how: "Open it from the top switch to check sales, the shop and spend caps." },
  tasks: { what: "The Task Center: work you give agents and the plans the Agent Operations Lead makes from your goals.", how: "Create a task, pick an agent, and follow it from planned to done. Nothing that sends or spends runs without your OK." },
  agents: { what: "Every AI agent, grouped under one lead per role, with its persona, status and history.", how: "Open an agent for what it does, its automations, its last runs and its reports." },
  automations: { what: "The fixed workflows (n8n and GitHub) that agents own and run.", how: "Check what ran, what failed and which agent owns each one. Listed here does not mean switched on." },
  workspace: { what: "The Hub: your workspace setup, buildings, modules and the tools each building uses.", how: "Use it to see how buildings, modules and agents are wired together." },
  intel: { what: "What Atlas knows: this guide, project data, engineering reviews, repositories, activity and API spend.", how: "Use the tabs above. Everything here is read-only." },
  grid: { what: "All projects as a grid of cards, for a quick health check across everything.", how: "Scan for red or amber, then open the card." },
  settings: { what: "Connections (GitHub, website sync, n8n) and your preferences such as time zone and map navigation.", how: "Connect a service once here; every tab then reads from it." },
  library: { what: "The Output Library: every report and file your agents produced.", how: "Open it from the Library button on the map toolbar, or inside the Knowledge & Research Center." },
};

/** One sentence per tab of a section that has more than one tab. */
export const TAB_TEXT: Record<string, string> = {
  guide: "This guide.",
  intel: "Every project with its agents, automations, repositories and CI.",
  review: "Senior engineering reviews of the repositories, with recommendations you can hand to Claude.",
  repos: "Each repository's CI, pull requests and recent pushes.",
  activity: "A timeline of commits, CI runs, agent runs and catalog changes.",
  "intel-api": "Claude spend against its budget and GitHub requests against the hourly limit.",
  settings: "Connect GitHub, website sync and n8n.",
  preferences: "Time zone, map navigation, performance and other personal settings.",
};

/** Agents and Automations page tabs. Tabs from pull requests not yet on main are written ahead and
 *  appear only once the page lists them. `on` says which page shows the tab. */
export const PAGE_TAB_TEXT: Record<string, { text: string; on: "agents" | "automations" | "both" }> = {
  team: { text: "The team at a glance: each lead, their role and what they are doing.", on: "agents" },
  roster: { text: "Every agent in one sortable list.", on: "agents" },
  review: { text: "A read-only review of the agent portfolio; any Claude brief waits for your approval.", on: "agents" },
  board: { text: "Automations grouped by the agent that owns them.", on: "automations" },
  live: { text: "What is running or ran recently.", on: "automations" },
  flows: { text: "How automations hand work to each other.", on: "automations" },
  directory: { text: "The full list, with filters, grouping and a detail panel.", on: "both" },
  portfolio: { text: "Coverage by category and how much is verified from live data.", on: "both" },
  goals: { text: "Each agent's goals and how it is performing against them.", on: "both" },
  manage: { text: "Switch managed GitHub workflows on or off, with your approval.", on: "automations" },
};

export interface GuideTab { id: string; label: string; text: string }
export interface GuidePlace { id: string; label: string; what: string; how: string; open?: string; tabs: GuideTab[] }

/** The places in the order Khaneil sees them: top switch, then the sidebar, then the Library. */
export function guidePlaces(sections: Section[], order: string[], pageTabs: { id: string; label: string }[]): GuidePlace[] {
  const byId = new Map(sections.map((s) => [s.id, s]));
  const places: GuidePlace[] = order.map((id) => byId.get(id)).filter((s): s is Section => !!s).map((s) => {
    const page = s.id === "agents" || s.id === "automations" ? s.id : null;
    const tabs = page
      ? pageTabs.filter((t) => PAGE_TAB_TEXT[t.id] && (PAGE_TAB_TEXT[t.id].on === "both" || PAGE_TAB_TEXT[t.id].on === page)).map((t) => ({ id: t.id, label: t.label, text: PAGE_TAB_TEXT[t.id].text }))
      : s.tabs.length > 1 ? s.tabs.map((t) => ({ id: t.view, label: t.label, text: TAB_TEXT[t.view] ?? "" })) : [];
    return { id: s.id, label: s.label, ...PLACE_TEXT[s.id], open: s.tabs[0].view, tabs };
  });
  return [...places, { id: "library", label: "Output Library", ...PLACE_TEXT.library, tabs: [] }];
}

export interface GuideLead { roleId: string; role: string; purpose: string; lead: string; agentId: string; skills: number; automations: number; helpers: number }
export interface Operation { coordinator: string; leads: GuideLead[]; withSkills: string[]; agents: number; automations: number; orphans: number }

/** The role whose lead coordinates the others: goals into plans, the registry and new-agent proposals. */
export const COORDINATOR_ROLE = "agent-operations-lead";

const isSkill = (a: Pick<Agent, "framework">) => /\bagent skill$/i.test(a.framework.trim());

/** How the operation is organised, read from the catalog: the coordinator, one lead per role, the
 *  skills that run inside a lead's run, the automations each lead owns and the helpers in each role. */
export function operation(agents: Agent[]): Operation {
  const owns = ownership({ agents });
  const current = agents.filter((a) => a.status !== "retired");
  const ids = new Set(current.map((a) => a.id));
  const leads = ESSENTIAL_ROLES.map((r) => {
    const [anchor, ...rest] = r.agents.filter((id) => ids.has(id));
    const members = rest.map((id) => current.find((a) => a.id === id)!);
    // A lead's skills are listed apart from its agents in ESSENTIAL_ROLES (r.skills).
    const skills = (r.skills ?? []).filter((id) => ids.has(id)).length + members.filter(isSkill).length;
    return {
      roleId: r.id, role: r.name, purpose: r.purpose, agentId: anchor ?? r.id,
      lead: anchor ? identityFor(anchor, agents).name : r.name,
      skills,
      helpers: members.filter((a) => isAiAgent(a) && !isSkill(a)).length,
      automations: r.agents.reduce((n, id) => n + (owns.owned.get(id)?.length ?? 0), 0),
    };
  });
  return {
    coordinator: leads.find((l) => l.roleId === COORDINATOR_ROLE)?.lead ?? "the Atlas Operations Lead",
    leads,
    withSkills: leads.filter((l) => l.skills > 0).map((l) => l.lead),
    agents: directoryItems(agents, "agents").length,
    automations: directoryItems(agents, "automations").length,
    orphans: owns.orphans.length,
  };
}
