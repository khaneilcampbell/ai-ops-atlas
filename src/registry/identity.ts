import type { Agent } from "../catalog/types";
import type { AgentIdentityManifest } from "./types";

// Agent identities: the persona (name, portrait, accent) Atlas shows with an agent. Display only.
// The agent's id, tasks, permissions, workflows and history never change, and every place that
// shows an identity also says it is an AI agent. Portraits are files in public/agents/, generated
// once and reused; nothing here ever generates one.

/** The fixed style every portrait prompt ends with, so lighting and framing match across the team. */
export const PORTRAIT_HOUSE_STYLE =
  "Head-and-shoulders professional headshot, square crop with a little space above the head, eye level, 85mm lens, shoulders turned slightly, looking at the camera. Relaxed, natural expression with a slight closed-mouth smile. Natural skin texture with visible pores and fine lines, no retouching. Soft, even key light from front left with gentle fill and soft shadow. Plain neutral warm-grey seamless studio background. Smart casual clothing. Calm documentary corporate portrait. No text, no logos, no hands in frame. Avoid glamour styling, heavy makeup, plastic or airbrushed skin, exaggerated expressions, stock-photo poses, crossed arms, dramatic or colored lighting.";

/** The exact prompt for an agent's portrait (prompt_version 1), from its fixed appearance. */
export function portraitPrompt(appearance: string): string {
  return `Photorealistic portrait of a fictional ${appearance.replace(/\.\s*$/, "")}. ${PORTRAIT_HOUSE_STYLE}`;
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
