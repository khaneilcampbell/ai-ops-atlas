import type { ReactNode } from "react";
import { OPERATIONAL_LABEL } from "../../registry/telemetry";
import { AUTONOMY_INFO, CLASSIFICATION_INFO, type AutonomyLevel, type Classification, type Operational, type Risk } from "../../registry/types";

/** Explicit unavailable state. Use it instead of leaving a blank or guessing. */
export type Missing = "documented" | "verified" | "connected" | "set";
const MISSING_LABEL: Record<Missing, string> = { documented: "Not documented", verified: "Not verified", connected: "Not connected", set: "Not set" };

export function NA({ kind = "documented" }: { kind?: Missing }) {
  return <span className="na">{MISSING_LABEL[kind]}</span>;
}

export function orNA(v: ReactNode | null | undefined, kind: Missing = "documented") {
  return v === null || v === undefined || v === "" ? <NA kind={kind} /> : v;
}

export const CLASS_COLOR: Record<Classification, string> = {
  A: "#3f6b4a",
  B: "#6e8a5b",
  C: "#8a7a52",
  D: "#5b6f84",
  E: "#7a6a86",
  F: "#a9b4a0",
  unclassified: "#a9b4a0",
};

export function ClassBadge({ c, long }: { c: Classification; long?: boolean }) {
  const info = CLASSIFICATION_INFO[c];
  return (
    <span className="class-badge" title={`${info.label}: ${info.description}`}>
      <i style={{ background: CLASS_COLOR[c] }}>{c === "unclassified" ? "?" : c}</i>
      {long ? info.label : info.short}
    </span>
  );
}

export function OperationalPill({ op }: { op: Operational }) {
  return <span className={`op-pill op-${op}`}>{OPERATIONAL_LABEL[op]}</span>;
}

export function RiskPill({ risk }: { risk: Risk | null }) {
  if (!risk) return <span className="risk-pill risk-none">Risk not set</span>;
  return <span className={`risk-pill risk-${risk}`}>{risk[0].toUpperCase() + risk.slice(1)} risk</span>;
}

export function AutonomyMeter({ level }: { level: AutonomyLevel | null }) {
  if (level === null) return <NA />;
  return (
    <span className="autonomy" title={AUTONOMY_INFO[level].description}>
      <span className="autonomy-steps" aria-hidden>
        {[0, 1, 2, 3, 4].map((l) => (
          <i key={l} className={l <= level ? "on" : ""} />
        ))}
      </span>
      Level {level} · {AUTONOMY_INFO[level].label}
    </span>
  );
}

/** A labelled list that shows an explicit "Not documented" state when empty. */
export function ListField({ title, items, missing = "documented" }: { title: string; items: string[]; missing?: Missing }) {
  return (
    <div className="reg-field">
      <div className="section-title">{title}</div>
      {items.length ? (
        <ul className="reg-list">
          {items.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      ) : (
        <NA kind={missing} />
      )}
    </div>
  );
}
