import { isAiAgent } from "./roles";
import { tierOf, type Decided } from "./organization";
import { TIER_INFO } from "./taxonomy";
import type { Agent, Catalog } from "./types";
import type { TriggerType } from "../registry/types";

// Each AI agent's job: a role, an owner, a home, a workplace, a shift, a budget and the output it
// owes at the end of the day. Everything is read from the agent's manifest or worked out by the
// fixed rules below, and every field says which (see docs/agent-workdays.md). No model is involved,
// and nothing here starts an agent: the workday on the map is a simulation of the job as written.

/** Agents live in Circa, the twin-tower residence in the Financial District (KC, 2026-11-01). */
export const AGENT_RESIDENCE = { id: "circa", name: "Circa", towers: ["West", "East"], firstFloor: 12, floors: 20, unitsPerFloor: 4 } as const;

/** A simulated day on the map, in seconds. Shift hours below are hours of this day. */
export const SIM_DAY_SECONDS = 720;
export const SIM_HOUR_SECONDS = SIM_DAY_SECONDS / 24;

/** Default shift per trigger type, in hours of the simulated day: [start, end). */
export const SHIFT_BY_TRIGGER: Record<TriggerType | "unknown", [number, number]> = {
  scheduled: [8, 16],
  manual: [9, 17],
  event: [10, 18],
  continuous: [7, 19],
  unknown: [9, 17],
};

/** Why an agent has no workday on the map. */
export type OffDuty = "planned" | "paused" | "retired";

export interface AgentJob {
  agentId: string;
  title: string;
  /** Tier label, such as "Specialized Agent". */
  role: Decided<string>;
  /** The person accountable for the agent's work and spend. */
  owner: Decided<string>;
  home: { building: string; unit: string; label: string };
  /** Where it works: its project's headquarters, or a declared workplace such as an OpenAI suite. */
  work: { kind: "headquarters" | "workplace"; projectId: string; building: string; label: string };
  /** Shift in hours of the simulated day, plus the schedule as the manifest writes it. */
  shift: Decided<{ start: number; end: number }> & { declared: string | null };
  budget: Decided<string>;
  /** The one thing the agent should hand over at the end of its day. */
  output: Decided<string>;
  /** Set when the agent has no workday yet, with the reason; it stays home. */
  offDuty: OffDuty | null;
}

const declared = <T,>(value: T, reason: string): Decided<T> => ({ value, provenance: "declared", reason });
const inferred = <T,>(value: T, reason: string): Decided<T> => ({ value, provenance: "inferred", reason });

/** Stable 0..1 from a string, so a shift offset never changes between runs. */
function unit01(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10007) / 10007;
}

/** "KC (macOS Keychain)" → KC. Credential holders that are not people fall back to the catalog owner. */
export function ownerOf(a: Agent): Decided<string> {
  const raw = a.registry?.governance?.credentialOwner?.trim();
  const name = raw?.split(" (")[0].trim();
  if (name && /^[A-Z][A-Za-z.' -]{0,40}$/.test(name) && !/^(None|GitHub|No|Not)\b/.test(name)) return declared(name, "governance.credential_owner in the manifest");
  return inferred("KC", raw ? `credential holder is "${raw}", not a person; every catalog project belongs to KC` : "no credential owner written; every catalog project belongs to KC");
}

function shiftOf(a: Agent): AgentJob["shift"] {
  const trigger = a.registry?.execution?.triggerType;
  const schedule = a.registry?.execution?.schedule ?? null;
  const [start, end] = SHIFT_BY_TRIGGER[trigger ?? "unknown"];
  // Up to an hour earlier or later, so agents with the same shift don't all leave home at once.
  const shift = Math.round((unit01(a.id) - 0.5) * 4) / 2;
  const reason = trigger ? `${trigger} trigger, default ${start}:00 to ${end}:00, staggered ${shift >= 0 ? "+" : ""}${shift} h` : `no trigger type written, default ${start}:00 to ${end}:00`;
  return { ...inferred({ start: start + shift, end: end + shift }, reason), declared: schedule };
}

/**
 * Apartment for each agent, in id order so the same catalog always gives the same homes:
 * West tower first, four units a floor from floor 12 up, then the East tower.
 */
export function apartments(ids: string[]): Map<string, AgentJob["home"]> {
  const R = AGENT_RESIDENCE, perTower = R.floors * R.unitsPerFloor, out = new Map<string, AgentJob["home"]>();
  [...ids].sort().forEach((id, i) => {
    const tower = R.towers[Math.floor(i / perTower) % R.towers.length], k = i % perTower;
    const unit = `${R.firstFloor + Math.floor(k / R.unitsPerFloor)}${"ABCD"[k % R.unitsPerFloor]}`;
    out.set(id, { building: R.id, unit, label: `${R.name} ${tower}, apartment ${unit}` });
  });
  return out;
}

/** The job of every AI agent in the catalog (types A, B and F), in catalog order. Automations have no job card. */
export function agentJobs(catalog: Catalog): AgentJob[] {
  const agents = catalog.agents.filter(isAiAgent);
  const homes = apartments(agents.map((a) => a.id));
  return agents.map((a) => {
    const project = catalog.projects.find((p) => p.id === a.projectId);
    const tier = tierOf(a, catalog);
    const budget = a.registry?.cost?.budget?.trim();
    const output = a.registry?.responsibilities?.outputs?.[0]?.trim();
    const type = a.registry?.classification?.type;
    const offDuty: OffDuty | null = type === "F" ? "planned" : a.status === "retired" ? "retired" : a.status === "paused" ? "paused" : null;
    return {
      agentId: a.id,
      title: a.name,
      role: { ...tier, value: TIER_INFO[tier.value].label },
      owner: ownerOf(a),
      home: homes.get(a.id)!,
      work: a.workplace
        ? { kind: "workplace", projectId: a.projectId, building: a.workplace.building, label: `${a.workplace.building}, floor ${a.workplace.floor}, suite ${a.workplace.room}` }
        : { kind: "headquarters", projectId: a.projectId, building: a.projectId, label: `${project?.name ?? a.projectId} headquarters${a.officeFloor ? `, floor ${a.officeFloor}` : ""}` },
      shift: shiftOf(a),
      budget: budget ? declared(budget, "registry.cost.budget in the manifest") : inferred("Not documented", "no budget written in the manifest"),
      output: output ? declared(output, "first of registry.responsibilities.outputs") : inferred("Not documented", "no outputs written in the manifest"),
      offDuty,
    };
  });
}

/** "9:30" for 9.5 hours. */
export function clock(hours: number) {
  const h = ((Math.floor(hours) % 24) + 24) % 24, m = Math.round((hours - Math.floor(hours)) * 60);
  return `${h}:${String(m).padStart(2, "0")}`;
}
