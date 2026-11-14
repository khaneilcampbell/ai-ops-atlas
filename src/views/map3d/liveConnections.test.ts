import { describe, expect, it } from "vitest";
import { catalog } from "../../catalog";
import { ATLAS_PROJECT, endpointKey, liveLandmarkConnections } from "../../lib/connections";
import { landmarkInstances } from "../../modules/instances";
import { serviceKey } from "../../modules/names";
import { layoutMap } from "../mapLayout";
import { landmarkMarksOf, liveLandmarks } from "./landmarkMarks";
import { anchorsOf } from "./Map3D";
import { buildScene } from "./scene";

// Khaneil, 2026-11-12: whenever a building goes live it shows its connection to Atlas Command
// Center, and a building that is not live shows none. Both come from module state alone.
const COMMAND_CENTER = `project:${ATLAS_PROJECT}`;
const instances = landmarkInstances();
const ends = (live: ReturnType<typeof liveLandmarks>) =>
  liveLandmarkConnections(catalog, live).map((c) => [endpointKey(catalog, c.source), endpointKey(catalog, c.target)]);

describe("live buildings connect to Atlas Command Center", () => {
  it("gives every live building exactly one line to Atlas Command Center, drawable on the map", () => {
    const live = liveLandmarks(instances, () => ({ health: "good", summary: "Live" }));
    expect(live.length).toBeGreaterThan(0);
    const layout = layoutMap(catalog, [], "district");
    const anchors = anchorsOf(buildScene(layout), layout);
    const links = ends(live);
    for (const l of live) {
      const key = serviceKey(l.id);
      expect(links.filter(([a, b]) => a === key && b === COMMAND_CENTER), `${l.name} has no line to Atlas Command Center`).toHaveLength(1);
      expect(anchors.has(key), `${l.name} (${key}) is not on the map`).toBe(true);
      expect(anchors.get(key)).not.toBe(anchors.get(COMMAND_CENTER));
    }
    expect(anchors.has(COMMAND_CENTER)).toBe(true);
  });

  it("connects Growth & Marketing Studio once its live data answers", () => {
    const live = liveLandmarks(instances, (_, type) => (type === "growth-marketing-studio" ? { health: "good", summary: "Live" } : { health: "unknown", summary: "Not verified" }));
    expect(ends(live)).toEqual([["service:benjaire-marketing", COMMAND_CENTER]]);
    expect(instances.find((l) => l.id === "benjaire-marketing")?.name).toBe("Growth & Marketing Studio");
  });

  it("draws no line for a building that is not live, and keeps the line and status dot in step", () => {
    expect(ends(liveLandmarks(instances, () => ({ health: "unknown", summary: "Not verified" })))).toEqual([]);
    const live = liveLandmarks(instances, (l) => (l.id === "benjaire-marketing" ? { health: "bad", summary: "Not reachable" } : { health: "unknown", summary: "" }));
    expect(Object.keys(landmarkMarksOf(live))).toEqual(ends(live).map(([a]) => a));
    expect(liveLandmarkConnections(catalog, live)[0].status).toBe("unhealthy");
  });

  it("skips a planned or switched-off module even when asked about it", () => {
    const off = instances.map((l) => ({ ...l, enabled: false }));
    expect(liveLandmarks(off, () => ({ health: "good", summary: "Live" }))).toEqual([]);
  });
});
