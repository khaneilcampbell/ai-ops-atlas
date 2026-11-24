import { useEffect, useState } from "react";
import * as THREE from "three";
import type React from "react";
import { measure, SANS } from "../mapText";
import type { LabelSpec } from "./plaques";
import { countText, MARKER, markerAnchor, markerWidth, occupancyText, stackOf, type InsideAgent } from "./occupancy";

/** What the marker needs to know about each agent inside: its name and portrait (registry identity). */
export interface MarkerFace {
  name: string;
  initials: string;
  accent: string;
  portrait: string | null;
}

export interface OccupancyInput {
  building: { key: string; name: string; x: number; roof: number; z: number };
  /** The id of the building's nameplate label, which the marker stacks over. */
  plaqueId?: string;
  agents: readonly InsideAgent[];
  faces: ReadonlyMap<string, MarkerFace>;
  /** Height in CSS pixels of the building's nameplate under the marker. */
  plaqueH: number;
  /** Its nameplate's priority: the marker is placed straight after it. */
  priority: number;
  /** A first tap on a touch screen opened the tooltip (a second tap enters). */
  peeking: boolean;
  /** Enter the building (or open its agents), the existing Inside / selection behaviour. */
  onEnter: () => void;
  /** A first tap on a touch screen: show the tooltip instead of entering. */
  onPeek: () => void;
}

function Face({ face }: { face: MarkerFace }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="occ-face" style={{ background: face.accent }} aria-hidden="true">
      {face.portrait && !failed ? <img src={face.portrait} alt="" draggable={false} onError={() => setFailed(true)} /> : face.initials}
    </span>
  );
}

/**
 * The "agents inside" marker as one of the map's labels (Map3D.tsx draws labels over the canvas):
 * a small dark-glass pill of overlapping portraits and a count, floating just above the building's
 * nameplate. It is a keyboard-focusable button with an accessible name; hover or focus shows the
 * tooltip (building, how many, names and statuses); click, Enter or a second tap enters the building.
 */
export function occupancyMarker(p: OccupancyInput): LabelSpec {
  const faces = p.agents.map((a) => p.faces.get(a.personaId) ?? { name: a.personaId, initials: "?", accent: "#5b6b5e", portrait: null });
  const named = p.agents.map((a, i) => ({ name: faces[i].name, status: a.status }));
  const text = occupancyText(p.building.name, named);
  const { shown, more } = stackOf(faces);
  const count = countText(p.agents.length);
  const at = markerAnchor(p.building, p.plaqueH);
  const onClick = (e?: React.MouseEvent) => {
    // A tap on a touch screen first shows who is inside; the second tap goes in.
    const touch = (e?.nativeEvent as PointerEvent | undefined)?.pointerType === "touch";
    if (touch && !p.peeking) return p.onPeek();
    p.onEnter();
  };
  return {
    id: `occ:${p.building.key}`,
    key: p.building.key,
    pos: new THREE.Vector3(...at.pos),
    lift: at.lift,
    ...(p.plaqueId ? { over: p.plaqueId } : {}),
    w: markerWidth(p.agents.length, measure(count, MARKER.font, SANS, 600)),
    h: MARKER.height,
    priority: p.priority + 0.01,
    className: `m3-occupancy${p.peeking ? " open" : ""}`,
    ariaLabel: `${text.label} ${p.building.key.startsWith("project:") ? "Opens the building's Inside view." : "Opens the building."}`,
    onClick,
    node: (
      <>
        <span className="occ-stack">
          {shown.map((f, i) => (
            <Face key={i} face={f} />
          ))}
          {more > 0 && (
            <span className="occ-face occ-more" aria-hidden="true">
              +{more}
            </span>
          )}
        </span>
        <span className="occ-count" aria-hidden="true">
          {count}
        </span>
        <span className="occ-tip" role="tooltip" aria-hidden="true">
          <b>{p.building.name}</b>
          <span className="occ-tip-count">{text.count}</span>
          <ul>
            {named.map((a, i) => (
              <li key={i}>
                <span>{a.name}</span>
                <em>{a.status}</em>
              </li>
            ))}
          </ul>
          <small>{p.peeking ? "Tap again to look inside" : "Click to look inside"}</small>
        </span>
      </>
    ),
  };
}

/** The wall clock, ticking every `ms` while the page is visible: occupancy changes as segments start and end. */
export function useTick(ms = 10_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState !== "hidden") setNow(Date.now());
    }, ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}
