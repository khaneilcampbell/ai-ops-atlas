import type { Actor, SensitiveCategory } from "../tasks/types";
import { AUTONOMY_LEVELS, type AutonomyLevel } from "./types";

// Autonomy levels and per-action authorization. A level never grants anything broad: each action
// is checked by kind, resource, environment, risk and approval. Sensitive categories always need a
// person's approval for that run, at every level. Unknown action kinds are refused (no arbitrary
// commands), and only a person may change a level.

export const ACTION_KINDS = ["read", "summarize", "draft_plan", "create_tasks", "start_step", "routine"] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

export type Risk = "low" | "medium" | "high";

export interface ActionRequest {
  kind: string;
  /** What it touches: a goal id, task id, repository, workflow id... */
  resource: string;
  environment: "atlas" | "external" | "production";
  risk: Risk;
  /** Sensitive categories the action falls under. */
  categories: SensitiveCategory[];
  /** Who asks. Only a person "initiates". */
  actor: Actor;
  /** Categories a person approved for this run. */
  approved?: SensitiveCategory[];
  /** The goal's plan was approved by a person. */
  planApproved?: boolean;
  /** Level 3 only: the allowlisted routine id. */
  routineId?: string;
  /** Level 3 only: how many times the routine already ran today. */
  routineRunsToday?: number;
}

export type Decision = { allowed: true; note: string } | { allowed: false; needsApproval: SensitiveCategory[]; reason: string };

/** Level 3 routines: read-only, no outside change, a daily limit each. Changed only by a pull request. */
export const ROUTINES: Readonly<Record<string, { name: string; perDay: number }>> = {
  "repo-health-check": { name: "Read-only repository health check", perDay: 4 },
  "docs-freshness-check": { name: "Documentation freshness check", perDay: 2 },
  "status-monitor": { name: "Non-destructive status monitoring", perDay: 24 },
  "approved-report": { name: "Approved reporting workflow", perDay: 2 },
};

const isLevel = (n: unknown): n is AutonomyLevel => AUTONOMY_LEVELS.includes(n as AutonomyLevel);

export function authorizeAction(level: AutonomyLevel, a: ActionRequest): Decision {
  const refuse = (reason: string, needsApproval: SensitiveCategory[] = []): Decision => ({ allowed: false, needsApproval, reason });
  if (!isLevel(level)) return refuse("Unknown autonomy level.");
  if (!(ACTION_KINDS as readonly string[]).includes(a.kind)) return refuse(`"${a.kind}" isn't an action Atlas can take.`);
  const person = a.actor.kind === "person";
  const missing = a.categories.filter((c) => !(a.approved ?? []).includes(c));
  // Sensitive work: a person's approval for this run, whatever the level.
  if (missing.length) return refuse(`Needs Khaneil's approval first (${missing.join(", ")}).`, missing);
  if (a.environment === "production" && a.kind !== "read") return refuse("Production changes always need Khaneil's approval and are never started by a level.", ["production_deploy"]);

  switch (a.kind as ActionKind) {
    case "read":
    case "summarize":
      return { allowed: true, note: "Read-only." };
    case "draft_plan":
      if (level < 1) return refuse("Level 0 only observes: plans aren't drafted.");
      return { allowed: true, note: "A plan is a proposal; nothing runs." };
    case "create_tasks":
      if (level < 1) return refuse("Level 0 only observes: no tasks are created.");
      if (!person) return refuse("Only Khaneil can start a plan.");
      if (!a.planApproved) return refuse("Approve the plan first.");
      return { allowed: true, note: "Khaneil started it." };
    case "start_step": {
      if (level < 1) return refuse("Level 0 only observes.");
      if (person) return { allowed: true, note: "Khaneil started it." };
      if (level >= 2 && a.planApproved && a.risk === "low" && a.environment === "atlas") return { allowed: true, note: "Low-risk step of an approved plan (level 2)." };
      return refuse(level >= 2 ? "Only low-risk steps inside Atlas of an approved plan start without Khaneil." : "At level 1 every step waits for Khaneil to start it.");
    }
    case "routine": {
      const r = a.routineId ? ROUTINES[a.routineId] : undefined;
      if (person) return { allowed: true, note: "Khaneil started it." };
      if (level < 3) return refuse("Routines run on their own only at level 3.");
      if (!r) return refuse("Not an allowlisted routine.");
      if (a.risk !== "low" || a.environment !== "atlas") return refuse("Routines must be low-risk and read-only.");
      if ((a.routineRunsToday ?? 0) >= r.perDay) return refuse(`${r.name} already ran ${r.perDay} times today.`);
      return { allowed: true, note: `${r.name} (allowlisted, ${r.perDay} a day).` };
    }
  }
}

/** Changing the owner autonomy level: a person only, and only to a known level. */
export function setLevelProblem(actor: Actor, next: unknown): string | null {
  if (actor.kind !== "person") return `${actor.name} can't change autonomy: only Khaneil can.`;
  if (!isLevel(next)) return "Unknown autonomy level.";
  return null;
}
