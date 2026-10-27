import type { Raw, Reader } from "../catalog/reader";
import {
  AUTONOMY_LEVELS,
  CATEGORIES,
  CLASSIFICATIONS,
  CONFIDENCES,
  KPI_KINDS,
  KPI_MEASURES,
  RISK_LEVELS,
  SENSITIVITIES,
  TRIGGER_TYPES,
  type AutonomyLevel,
  type Kpi,
  type RegistryManifest,
} from "./types";

/** Parses an agent's `registry` block (atlas/v2). Unknown values are reported, never guessed. */
export function parseRegistry(r: Reader, value: unknown, path: string): RegistryManifest | undefined {
  const o = r.obj(value, path);
  if (!o) return undefined;
  const sub = (key: string) => (o[key] === undefined || o[key] === null ? null : r.obj(o[key], `${path}.${key}`));
  const out: RegistryManifest = {
    title: r.str(o, "title", path, false),
    suggestedTitle: r.str(o, "suggested_title", path, false),
    summary: r.str(o, "summary", path, false),
    category: r.oneOf(o, "category", path, CATEGORIES),
    subcategory: r.str(o, "subcategory", path, false),
    version: r.str(o, "version", path, false),
  };

  const c = sub("classification");
  if (c) {
    const type = r.oneOf(c, "type", `${path}.classification`, CLASSIFICATIONS);
    if (type) {
      out.classification = {
        type,
        confidence: r.oneOf(c, "confidence", `${path}.classification`, CONFIDENCES) ?? "unverified",
        evidence: r.str(c, "evidence", `${path}.classification`, false),
      };
    } else if (c.type === undefined) r.fail(`${path}.classification.type`, "is required");
  }

  const m = sub("mission");
  if (m) {
    const p = `${path}.mission`;
    out.mission = { purpose: r.str(m, "purpose", p, false), problem: r.str(m, "problem", p, false), outcomes: r.strings(m, "outcomes", p), beneficiaries: r.strings(m, "beneficiaries", p) };
  }

  const resp = sub("responsibilities");
  if (resp) {
    const p = `${path}.responsibilities`;
    out.responsibilities = {
      tasks: r.strings(resp, "tasks", p),
      tools: r.strings(resp, "tools", p),
      inputs: r.strings(resp, "inputs", p),
      outputs: r.strings(resp, "outputs", p),
      dependencies: r.strings(resp, "dependencies", p),
      limitations: r.strings(resp, "limitations", p),
    };
  }

  const g = sub("goals");
  if (g) {
    const p = `${path}.goals`;
    out.goals = {
      objective: r.str(g, "objective", p, false),
      reviewFrequency: r.str(g, "review_frequency", p, false),
      kpis: r.list(g, "kpis", p).flatMap((k, i) => {
        const kp = `${p}.kpis[${i}]`;
        const ko = r.obj(k, kp);
        if (!ko) return [];
        const name = r.str(ko, "name", kp);
        if (!name) return [];
        const tv = ko.target_value;
        if (tv !== undefined && tv !== null && typeof tv !== "number") r.fail(`${kp}.target_value`, "must be a number");
        const kpi: Kpi = {
          name,
          kind: r.oneOf(ko, "kind", kp, KPI_KINDS) ?? "other",
          target: r.str(ko, "target", kp, false) ?? null,
          targetValue: typeof tv === "number" ? tv : null,
          direction: r.oneOf(ko, "direction", kp, ["min", "max"] as const) ?? null,
          basis: r.str(ko, "basis", kp, false) ?? null,
          measure: r.oneOf(ko, "measure", kp, KPI_MEASURES) ?? null,
        };
        if (kpi.targetValue !== null && !kpi.direction) r.fail(`${kp}.direction`, "is required with target_value (min or max)");
        return [kpi];
      }),
    };
  }

  const e = sub("execution");
  if (e) {
    const p = `${path}.execution`;
    out.execution = {
      triggerType: r.oneOf(e, "trigger_type", p, TRIGGER_TYPES),
      schedule: r.str(e, "schedule", p, false),
      environment: r.str(e, "environment", p, false),
      stages: r.strings(e, "stages", p),
    };
  }

  const gov = sub("governance");
  if (gov) {
    const p = `${path}.governance`;
    const a = gov.autonomy;
    let autonomy: AutonomyLevel | undefined;
    if (a !== undefined && a !== null) {
      if ((AUTONOMY_LEVELS as readonly unknown[]).includes(a)) autonomy = a as AutonomyLevel;
      else r.fail(`${p}.autonomy`, "must be a level from 0 to 4");
    }
    out.governance = {
      autonomy,
      autonomyNote: r.str(gov, "autonomy_note", p, false),
      dataSensitivity: r.oneOf(gov, "data_sensitivity", p, SENSITIVITIES),
      approval: r.str(gov, "approval", p, false),
      credentialOwner: r.str(gov, "credential_owner", p, false),
      risk: r.oneOf(gov, "risk", p, RISK_LEVELS),
      auditLog: r.str(gov, "audit_log", p, false),
    };
  }

  const cost = sub("cost");
  if (cost) out.cost = { budget: r.str(cost, "budget", `${path}.cost`, false), notes: r.str(cost, "notes", `${path}.cost`, false) };

  const d = sub("docs");
  if (d) {
    const p = `${path}.docs`;
    out.docs = {
      technical: r.str(d, "technical", p, false),
      runbook: r.str(d, "runbook", p, false),
      knownIssues: r.strings(d, "known_issues", p),
      improvements: r.strings(d, "improvements", p),
      lastReview: r.date(d, "last_review", p),
    };
  }

  warnUnknown(r, o, path, ["title", "suggested_title", "summary", "category", "subcategory", "classification", "version", "mission", "responsibilities", "goals", "execution", "governance", "cost", "docs"]);
  return out;
}

function warnUnknown(r: Reader, o: Raw, path: string, known: string[]) {
  for (const k of Object.keys(o)) if (!known.includes(k)) r.fail(`${path}.${k}`, "is not a registry field");
}
