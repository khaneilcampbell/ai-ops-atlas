import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { catalog } from ".";
import { isAiAgent } from "./roles";
import { isSkill, roleOf } from "./essentialRoles";
import { defineBuildings } from "../buildings/buildingDefinition";
import { WORKSPACE } from "../modules/workspace";
import { CITY_FIGURES } from "../registry/cityFigures";
import { buildScene } from "../views/map3d/scene";
import { layoutMap } from "../views/mapLayout";

// The "Adding an agent" checklist in docs/adding-to-atlas.md, as one test (Khaneil, 2026-11-24:
// "when new agents are created they should be on the map"). Every AI agent that isn't retired must
// be complete everywhere the moment it is added, paused or not, so nothing waits to be noticed when
// it is switched on. Each failure names the agent and the one thing to add.

const PUBLIC = join(__dirname, "../../public");
const agents = catalog.agents.filter((a) => isAiAgent(a) && a.status !== "retired" && !isSkill(a));
const scene = buildScene(layoutMap(catalog));
const desks = new Set([...defineBuildings(scene.towers, catalog.projects, catalog.agents).values()].flatMap((d) => d.desks.map((x) => x.agentId)));
const landmarkAgents = new Set(WORKSPACE.landmarks.flatMap((l) => l.agents ?? []));
const roles = roleOf(catalog.agents);

/** What a new AI agent still lacks, as checklist steps. Empty when it is complete. */
function missing(a: (typeof agents)[number]): string[] {
  const out: string[] = [];
  const identity = a.registry?.identity;
  if (!identity) out.push("registry.identity (name, accent, appearance, portrait) in its catalog entry");
  if (!CITY_FIGURES[a.id]) out.push("a city figure in src/registry/cityFigures.ts");
  if (identity?.portrait?.path && !existsSync(join(PUBLIC, identity.portrait.path))) out.push(`its avatar file public/${identity.portrait.path}`);
  if (!roles.has(a.id)) out.push("a team role in ESSENTIAL_ROLES (src/catalog/essentialRoles.ts)");
  if (!desks.has(a.id) && !a.workplace && !landmarkAgents.has(a.id)) out.push("a place on the map: a desk in its project's building, a `workplace` room, or `agents` on a landmark in workspace.yaml");
  return out;
}

describe("new agent checklist (docs/adding-to-atlas.md)", () => {
  it("gives every AI agent an identity, a city figure, an avatar, a team role and a place on the map", () => {
    const gaps = agents.flatMap((a) => missing(a).map((m) => `${a.id}: add ${m}`));
    expect(gaps).toEqual([]);
  });

  it("gives every automation an owning AI agent, so it shows on that agent's desk and in its role", () => {
    const live = new Set(agents.map((a) => a.id));
    const orphans = catalog.agents
      .filter((a) => !isAiAgent(a) && a.status !== "retired" && !isSkill(a) && !live.has(a.ownedBy ?? ""))
      .map((a) => `${a.id}: set owned_by to a current AI agent`);
    expect(orphans).toEqual([]);
  });
});
