import { describe, expect, it } from "vitest";
import { catalog } from "../catalog";
import { CITY_FIGURES, cityFigureFor, type CityFigure } from "./cityFigures";
import { identities } from "./identity";

const HEX = /^#[0-9a-f]{6}$/;
const colours = (f: CityFigure) => [f.skin, f.hair.color, f.hair.streak, f.facialHair?.color, f.facialHair?.moustache, f.glasses, f.earrings, f.necklace, f.top, f.neck?.color, f.stripes, f.jacket, f.trousers, f.shoes].filter((c): c is string => !!c);

describe("city figures", () => {
  it("gives exactly the agents with an identity one figure, keyed by their stable id", () => {
    const ids = identities(catalog.agents).map((i) => i.personaId).sort();
    expect(Object.keys(CITY_FIGURES).sort()).toEqual(ids);
    expect(ids).toHaveLength(19);
  });

  it("uses valid colours and never the avatar's accent circle for skin or clothes", () => {
    for (const i of identities(catalog.agents)) {
      const f = cityFigureFor(i.personaId)!;
      for (const c of colours(f)) expect(c, i.personaId).toMatch(HEX);
      for (const c of [f.skin, f.top, f.jacket, f.trousers].filter(Boolean)) expect(c!.toLowerCase(), i.personaId).not.toBe(i.accent.toLowerCase());
      expect(f.build.height).toBeGreaterThan(0.9);
      expect(f.build.height).toBeLessThan(1.1);
    }
  });

  it("keeps the defining features Khaneil named", () => {
    const samuel = CITY_FIGURES["repo-intelligence"], margaret = CITY_FIGURES["atlas-engineering-review"], yusuf = CITY_FIGURES["agent-operations-lead"];
    expect(samuel).toMatchObject({ hair: { style: "locs" }, top: "#7a1f2e" });
    expect(samuel.glasses).toBeTruthy();
    expect(samuel.facialHair?.style).toBe("short");
    expect(margaret).toMatchObject({ hair: { style: "pixie", color: "#e9e7e3" }, glasses: "#3a2a22", jacket: "#7c7f82", top: "#1c1c1e", neck: { kind: "turtleneck" } });
    expect(yusuf).toMatchObject({ hair: { style: "short", color: "#241d1a" }, facialHair: { style: "full", color: "#8c8782" }, jacket: "#22314f" });
  });

  it("tells look-alikes apart: no two figures share hair style and colour, skin and top", () => {
    const keys = Object.values(CITY_FIGURES).map((f) => `${f.hair.style}|${f.hair.color}|${f.skin}|${f.jacket ?? f.top}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
