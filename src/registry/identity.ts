import type { Agent } from "../catalog/types";
import type { AgentIdentityManifest } from "./types";

// Agent identities: the persona (name, portrait, accent) Atlas shows with an agent. Display only.
// The agent's id, tasks, permissions, workflows and history never change, and every place that
// shows an identity also says it is an AI agent. Agents show their initials in their accent circle:
// the illustrated avatars were removed on Khaneil's ask (2026-11-19). A portrait record, if one is
// ever added back, points at public/agents/<id>.webp; nothing here ever generates one.

/** The fixed style every avatar prompt carries, so the team reads as one illustrated set. */
export const PORTRAIT_HOUSE_STYLE =
  "Head and shoulders, centered, facing slightly to the side, friendly calm expression. Clean modern editorial illustration style: simple geometric shapes, smooth solid color fills, subtle soft shading, no outlines, minimal facial detail (simple eyes and smile).";

/**
 * The exact prompt for an agent's illustrated avatar (prompt_version 2), from its fixed appearance
 * and accent. Avatars are drawn, never photos: Khaneil chose illustrations over real-looking faces.
 */
export function portraitPrompt(appearance: string, accent: string): string {
  return `Flat vector illustrated avatar of a fictional character: ${appearance.replace(/\.\s*$/, "")}. ${PORTRAIT_HOUSE_STYLE} Solid circular background in ${accent} on a plain warm off-white square. Clearly an illustration, not a photo. No text, no logos.`;
}

/** Neutral accent for entries without an identity (retired agents, unowned automations). */
export const NEUTRAL_ACCENT = "#6B7280";

export interface ResolvedIdentity {
  /** The agent this was resolved for (stable id). */
  agentId: string;
  /** Whose identity is shown: the agent itself, or its owner or lead agent. */
  personaId: string;
  /** Persona name, such as "Daniel Okafor", or the agent's own name when it has no identity. */
  name: string;
  /** The functional role of the persona (its registry title). */
  role: string;
  accent: string;
  /** URL of the portrait under the app's base path, or null to show initials. */
  portrait: string | null;
  initials: string;
  intro: string | null;
  voice: string | null;
  /**
   * How the shown persona relates to the agent:
   * own: the agent's own identity; owner: an automation shown under its owning agent;
   * skill: a skill shown under its lead agent; none: no identity, initials of the agent's name.
   */
  kind: "own" | "owner" | "skill" | "none";
  /** The automation or skill name to show after "via", for owner and skill kinds. */
  via: string | null;
  retired: boolean;
}

export function initialsOf(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s-]/gu, " ").split(/[\s-]+/).filter(Boolean);
  if (!words.length) return "?";
  const first = words[0][0] ?? "";
  const last = words.length > 1 ? (words[words.length - 1][0] ?? "") : (words[0][1] ?? "");
  return (first + last).toUpperCase();
}

/** Public URL for a stored portrait path, under Vite's base (the Mac app and the web page differ). */
export function portraitUrl(path: string | undefined, base: string = import.meta.env?.BASE_URL ?? "/"): string | null {
  if (!path) return null;
  return `${base.endsWith("/") ? base : `${base}/`}${path}`;
}

const isSkill = (a: Pick<Agent, "framework">) => /\bagent skill$/i.test(a.framework.trim());

function own(agent: Agent, idn: AgentIdentityManifest, base?: string): ResolvedIdentity {
  return {
    agentId: agent.id,
    personaId: agent.id,
    name: idn.displayName,
    role: agent.name,
    accent: idn.accent ?? NEUTRAL_ACCENT,
    portrait: portraitUrl(idn.portrait?.path, base),
    initials: initialsOf(idn.displayName),
    intro: idn.intro ?? null,
    voice: idn.voice ?? null,
    kind: "own",
    via: null,
    retired: agent.status === "retired",
  };
}

/**
 * The identity Atlas shows for an agent id. In order: the agent's own `registry.identity`; for an
 * automation with `owned_by`, its owner's identity "via" the automation; for an n8n Agent skill,
 * the lead agent it depends on; otherwise the agent's own name on initials. Unknown ids (an agent
 * removed from the catalog) fall back to the name saved with the work.
 */
export function identityFor(agentId: string, agents: readonly Agent[], savedName?: string, base?: string): ResolvedIdentity {
  const byId = new Map(agents.map((a) => [a.id, a]));
  const agent = byId.get(agentId);
  if (!agent) {
    const name = savedName ?? agentId;
    return { agentId, personaId: agentId, name, role: "No longer in the catalog", accent: NEUTRAL_ACCENT, portrait: null, initials: initialsOf(name), intro: null, voice: null, kind: "none", via: null, retired: true };
  }
  const mine = agent.registry?.identity;
  if (mine) return own(agent, mine, base);

  const lead = isSkill(agent) ? (agent.registry?.responsibilities?.dependencies ?? []).map((d) => byId.get(d)).find((d) => d?.registry?.identity) : undefined;
  const owner = agent.ownedBy ? byId.get(agent.ownedBy) : undefined;
  const persona = owner?.registry?.identity ? owner : lead;
  if (persona?.registry?.identity) {
    return { ...own(persona, persona.registry.identity, base), agentId: agent.id, kind: persona === owner ? "owner" : "skill", via: agent.name, retired: agent.status === "retired" };
  }
  return {
    agentId: agent.id,
    personaId: agent.id,
    name: agent.name,
    role: agent.originalName && agent.originalName !== agent.name ? agent.originalName : agent.framework,
    accent: NEUTRAL_ACCENT,
    portrait: null,
    initials: initialsOf(agent.name),
    intro: null,
    voice: null,
    kind: "none",
    via: null,
    retired: agent.status === "retired",
  };
}

/** Every agent that carries its own identity, for lists and the Agent Factory's name check. */
export function identities(agents: readonly Agent[], base?: string): ResolvedIdentity[] {
  return agents.filter((a) => a.registry?.identity).map((a) => own(a, a.registry!.identity!, base));
}
