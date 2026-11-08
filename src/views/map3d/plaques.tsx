import * as THREE from "three";
import type React from "react";
import { clip, measure, SANS } from "../mapText";

/** One label over the 3D map: where it sits, its size on screen, and what it shows. */
export interface LabelSpec {
  id: string;
  key: string;
  pos: THREE.Vector3;
  w: number;
  h: number;
  priority: number;
  node: React.ReactNode;
  className: string;
  onClick?: () => void;
  title?: string;
}

/**
 * The one nameplate style for every building and place on the map. Sizes match
 * `.m3-plaque.compact` in app.css: 11px medium text on a 16px line, 4px by 9px padding,
 * a 1px border, and an 8px status dot 7px after the name.
 */
export const PLAQUE = {
  font: 11,
  weight: 500,
  /** Rendered height in CSS pixels: 16px line + 2 x 4px padding + 2 x 1px border. */
  height: 26,
  /** Horizontal padding, border and a little slack for font rounding. */
  pad: 24,
  /** Status dot plus its gap. */
  dot: 15,
  /** Longest name shown before it ends in an ellipsis. */
  maxText: 168,
  /** World units between a roof and the tip of its plaque, the same for every building. */
  roofGap: 0.35,
} as const;

export type PlaqueMark = { kind: string; label: string; stale?: boolean };

/** Planned places have no live checks yet; they show the dashed "unverified" dot. */
export const PLANNED: PlaqueMark = { kind: "unverified", label: "Planned · No verified operations" };

export function plaqueWidth(name: string) {
  return Math.ceil(measure(name, PLAQUE.font, SANS, PLAQUE.weight)) + PLAQUE.pad + PLAQUE.dot;
}

export function plaqueName(name: string) {
  return clip(name, PLAQUE.font, PLAQUE.maxText, SANS, PLAQUE.weight);
}

export interface PlaqueInput {
  id: string;
  /** The key hover reports for this label (usually the same as select). */
  key?: string;
  /** The key that is selected when the plaque is clicked. */
  select: string;
  name: string;
  /** Where the plaque points: the middle of the roof, at its highest point. */
  x: number;
  roof: number;
  z: number;
  priority: number;
  mark: PlaqueMark;
  title: string;
  /** Current selection and hover, for the shared selected and hover looks. */
  selKey: string | null;
  hover: string | null;
  /** Overrides the selected/hover look, for callers that track a wider selection. */
  state?: "selected" | "hover" | "";
  dim?: boolean;
  onSelect: (key: string) => void;
}

/** Builds a building nameplate with the shared size, height above the roof, look and status dot. */
export function buildingPlaque(p: PlaqueInput): LabelSpec {
  const key = p.key ?? p.select;
  const name = plaqueName(p.name);
  const state = p.state ?? (p.selKey === p.select ? "selected" : p.hover === key ? "hover" : "");
  return {
    id: p.id,
    key,
    pos: new THREE.Vector3(p.x, p.roof + PLAQUE.roofGap, p.z),
    w: plaqueWidth(name),
    h: PLAQUE.height,
    priority: state === "selected" ? 0 : state === "hover" ? Math.min(p.priority, 0.5) : p.priority,
    className: `m3-plaque compact${state ? ` ${state}` : ""}${p.dim ? " dim" : ""}`,
    onClick: () => p.onSelect(p.select),
    title: p.title,
    node: (
      <div className="t">
        {name}
        <b className={`hm hm-${p.mark.kind}${p.mark.stale ? " stale" : ""}`} title={p.mark.label} aria-label={p.mark.label} />
      </div>
    ),
  };
}
