import { describe, expect, it } from "vitest";
import { catalog } from "../catalog";
import type { Catalog } from "../catalog/types";
import { GAP, OFF_MAP_PROJECTS, keepRemovedLots, layoutMap, placeLabels, type Layout } from "./mapLayout";
import { districtHeadings } from "./mapPresentation";

function rects(layout: Layout) {
  return [...layout.districts.map((d) => ({ id: d.project.id, x: d.ox, y: d.oy, w: d.size, h: d.size })), ...layout.parks.map((p, i) => ({ id: `park${i}`, x: p.ox, y: p.oy, w: p.w, h: p.h }))];
}

function overlaps(layout: Layout, gap = 0) {
  const rs = rects(layout);
  const out: string[] = [];
  for (let i = 0; i < rs.length; i++)
    for (let j = i + 1; j < rs.length; j++) {
      const a = rs[i], b = rs[j];
      if (a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap) out.push(`${a.id}/${b.id}`);
    }
  return out;
}

/** A large synthetic catalog, only for exercising the layout. Never shown in the app. */
function bigCatalog(n: number): Catalog {
  const projects = Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    name: `Project ${i}`,
    summary: "",
    status: (["active", "idle", "paused", "attention", "retired"] as const)[i % 5],
    repository: `me/repo-${i}`,
    tags: i % 3 ? [`t${i % 4}`] : [],
    links: [],
    agentIds: [],
  }));
  const agents = projects.flatMap((p, i) =>
    Array.from({ length: i % 13 }, (_, k) => ({
      id: `${p.id}-a${k}`,
      name: `Agent ${k}`,
      purpose: "",
      framework: "CrewAI",
      status: "idle" as const,
      lastRun: null,
      history: [],
      links: [],
      projectId: p.id,
      repository: p.repository,
    })),
  );
  return { projects, agents };
}

describe("layoutMap", () => {
  it("seats every registered agent and automation inside its project building", () => {
    const layout = layoutMap(catalog);
    const housed = layout.districts.flatMap((d) => d.lots.map((l) => l.agent.id));
    const inside = layout.districts.flatMap((d) => d.crew.map((a) => a.id));
    // Off-map projects have no building: Skyline's one agent works in the Atlas Marketplace, and the
    // Service Desk and Career Applications agents stay registered without a tower to sit in.
    const seated = catalog.agents.filter((a) => !OFF_MAP_PROJECTS.has(a.projectId));
    expect([...housed, ...inside].sort()).toEqual(seated.map((a) => a.id).sort());
    expect(housed).toEqual([]);
    expect(inside).toHaveLength(seated.length);
  });

  it("puts a kiosk only for services a manifest names", () => {
    const layout = layoutMap(catalog);
    for (const d of layout.districts)
      for (const k of d.kiosks) {
        expect(k.service.users.length).toBeGreaterThan(0);
        for (const a of k.service.users) expect(a.projectId).toBe(d.project.id);
      }
  });

  it("puts repositories without a manifest in their own lot", () => {
    const layout = layoutMap(catalog, ["me/a", "me/b", "me/c"]);
    const lot = layout.parks.find((p) => p.strays.length);
    expect(lot?.strays.map((s) => s.name)).toEqual(["me/a", "me/b", "me/c"]);
    expect(overlaps(layout)).toEqual([]);
  });

  it("sizes districts by their own agents instead of the largest project", () => {
    const layout = layoutMap(catalog);
    const sizes = new Set(layout.districts.map((d) => d.size));
    expect(sizes.size).toBeGreaterThan(1);
  });

  it("keeps districts apart for hundreds of repositories, in every grouping", () => {
    const big = bigCatalog(300);
    const extra = Array.from({ length: 120 }, (_, i) => `me/stray-${i}`);
    for (const g of ["none", "status", "tag"] as const) {
      const t = performance.now();
      const layout = layoutMap(big, extra, g);
      expect(performance.now() - t).toBeLessThan(200);
      expect(layout.districts).toHaveLength(300);
      expect(overlaps(layout, GAP - 0.01)).toEqual([]);
      // Packed, not strung out: the map stays roughly as wide as it is deep.
      const w = layout.bounds.maxX - layout.bounds.minX;
      const h = layout.bounds.maxY - layout.bounds.minY;
      expect(w / h).toBeLessThan(4);
    }
  });

  it("groups projects into neighborhoods", () => {
    const layout = layoutMap(bigCatalog(20), [], "status");
    expect(layout.neighborhoods.map((n) => n.label)).toEqual(["Needs attention", "Active", "Idle", "Paused", "Retired"]);
    for (const d of layout.districts) expect(d.group).toBe(`s:${d.project.status}`);
  });

  it("is deterministic", () => {
    expect(layoutMap(catalog, ["me/x"], "tag")).toEqual(layoutMap(catalog, ["me/x"], "tag"));
  });
});

describe("placeLabels", () => {
  it("hides lower-priority labels that would overlap", () => {
    const shown = placeLabels([
      { id: "agent", x: 10, top: 0, bottom: 20, w: 80, priority: 6 },
      { id: "repo", x: 0, top: 0, bottom: 20, w: 80, priority: 3 },
      { id: "far", x: 400, top: 0, bottom: 20, w: 80, priority: 6 },
    ]);
    expect([...shown.keys()].sort()).toEqual(["far", "repo"]);
  });

  it("moves a label to an alternative spot before hiding it", () => {
    const shown = placeLabels([
      { id: "repo", x: 0, top: 0, bottom: 20, w: 80, priority: 3 },
      { id: "agent", x: 10, top: 0, bottom: 20, w: 80, priority: 6, alts: [-10, 40] },
    ]);
    expect(shown.get("agent")).toBe(40);
  });
});

describe("walkways", () => {
  it("connects every island in the default map to the street grid", () => {
    const layout = layoutMap(catalog);
    const linked = new Set(layout.walks.flatMap((w) => [w.from, w.to]));
    for (const d of layout.districts) expect(linked.has(d.project.id)).toBe(true);
    for (const w of layout.walks) expect(w.b.gx - w.a.gx + w.b.gy - w.a.gy).toBeGreaterThan(0);
  });
});

describe("district grouping", () => {
  const layout = layoutMap(catalog, [], "district");

  it("places the five districts in their fixed order without overlaps", () => {
    expect(layout.neighborhoods.map((n) => n.label)).toEqual(["AI Operations", "Business Operations", "AI Engineering", "Security & Infrastructure", "Career & Portfolio"]);
    expect(overlaps(layout, GAP - 0.01)).toEqual([]);
  });

  it("joins every district with walkways, so roads and bridges reach all of them", () => {
    const ids = layout.districts.map((d) => d.project.id);
    const seen = new Set([ids[0]]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const w of layout.walks)
        if (seen.has(w.from) !== seen.has(w.to)) {
          seen.add(w.from);
          seen.add(w.to);
          grew = true;
        }
    }
    expect(ids.filter((id) => !seen.has(id))).toEqual([]);
  });
});

it("does not draw a second building for a registered repository left in discovery cache", () => {
  const name="khaneilcampbell/service-desk-intelligence";
  const layout=layoutMap(catalog,[name]);
  expect(layout.parks.flatMap(p=>p.strays).some(s=>s.name===name)).toBe(false);
  // Service Desk stays registered but has no building (removed 2026-11-09): its land is a vacant lot.
  expect(layout.districts.filter(d=>d.project.id==="service-desk")).toHaveLength(0);
  expect(layout.parks.filter(p=>p.id==="park:vacant:service-desk")).toHaveLength(1);
});

it("leaves the land of removed towers (Service Desk, Career Applications, Benjaire Dashboard) in every grouping",()=>{
  for(const group of ["none","district","status","tag"] as const){
    const layout=layoutMap(catalog,[],group);
    // The same catalog with the removed projects renamed, so they are still drawn as towers. Career
    // Applications (2026-11-10) and Benjaire Dashboard (2026-11-12) have no manifest any more, so their
    // towers are put back on their old slots.
    const was=(id:string)=>["service-desk","benjaire-ops"].includes(id)?`was-${id}`:id;
    const projects=catalog.projects.map(p=>({...p,id:was(p.id)}));
    projects.splice(projects.findIndex(p=>p.id==="benjaire-site")+1,0,{id:"was-benjaire-ops",name:"Benjaire Dashboard",summary:"",status:"active",repository:"",tags:["benjaire","cloudflare","d1","dashboard"],district:"business-operations",links:[],agentIds:[]});
    projects.splice(projects.findIndex(p=>p.id==="was-benjaire-ops")+1,0,{id:"was-career-optimizer",name:"Career Applications",summary:"",status:"active",repository:"",tags:["claude","career","human-in-the-loop"],district:"career-portfolio",links:[],agentIds:[]});
    const without=layoutMap({projects,agents:catalog.agents.map(a=>({...a,projectId:was(a.projectId)}))},[],group);
    expect(without.districts.filter(d=>d.project.id.startsWith("was-"))).toHaveLength(3);
    expect(layout.districts.map(d=>d.project.id)).not.toContain("service-desk");
    expect(layout.districts.map(d=>d.project.id)).not.toContain("career-optimizer");
    // Benjaire Dashboard's lot keeps its streets (roads to Intelligence Hub run through it): it is
    // laid out as a cleared district, in the same place, with no building.
    expect(layout.districts.map(d=>d.project.id)).not.toContain("benjaire-ops");
    const lot=layout.cleared!.find(d=>d.project.id==="benjaire-ops")!,old=without.districts.find(d=>d.project.id==="was-benjaire-ops")!;
    const oldHub=without.districts.find(d=>d.project.id==="ai-ops-atlas")!;
    const expectedLot=group==="district"?oldHub:old;
    expect([lot.ox,lot.oy,lot.size]).toEqual([expectedLot.ox,expectedLot.oy,expectedLot.size]);
    // Every other building stands exactly where it stood while the two towers were drawn.
    const at=(l:typeof layout)=>Object.fromEntries(l.districts.filter(d=>!d.project.id.startsWith("was-")).map(d=>[d.project.id,[d.ox,d.oy,d.size]]));
    const expected=at(without);
    if(group==="district") {
      expected["ai-ops-atlas"]=[35.725,9.75,10];
      expected["intelligence-hub"]=[37.975,22,10];
    }
    expect(at(layout)).toEqual(expected);
    const lots=layout.parks.filter(p=>p.vacant).map(p=>p.id).sort();
    expect(lots).toEqual(["park:vacant:career-optimizer","park:vacant:service-desk"]);
    // A group left with only a vacant lot gets no heading.
    expect(districtHeadings(layout,group).every(n=>n.count>0)).toBe(true);
  }
});

it("keeps one open lot in every map grouping",()=>{
  for(const group of ["none","district","status","tag"] as const){
    const layout=layoutMap(catalog,[],group);
    expect(layout.parks.filter(p=>!p.strays.length&&!p.vacant)).toHaveLength(1);
    expect(overlaps(layout)).toEqual([]);
  }
});

it("has no Skyline project or district, and no stray for its old repository", () => {
  expect(catalog.projects.some(p => p.id === "skyline")).toBe(false);
  const layout = layoutMap(catalog, ["khaneilcampbell/skyline"]);
  expect(layout.districts.some(d => d.project.id === "skyline")).toBe(false);
  expect(layout.parks.filter(p => !p.strays.length && !p.vacant)).toHaveLength(1);
  expect(layout.parks.flatMap(p => p.strays).some(p => p.name === "khaneilcampbell/skyline")).toBe(false);
});

it("adds no kiosk for an agent that is off on purpose, so a draft doesn't move the city", () => {
  const draft = catalog.agents.find(a => a.id === "career-execution");
  expect(draft?.alerts?.notRunning).toBeTruthy();
  const without: Catalog = { ...catalog, agents: catalog.agents.filter(a => a !== draft) };
  const where = (l: Layout) => rects(l).map(r => `${r.id}:${r.x},${r.y},${r.w},${r.h}`).sort();
  expect(where(layoutMap(catalog, [], "district"))).toEqual(where(layoutMap(without, [], "district")));
});

describe("keepRemovedLots", () => {
  it("keeps the city in place when a removed tower's repository is deleted on GitHub", () => {
    const where = (l: Layout) => rects(l).map(r => `${r.id}:${r.x},${r.y}`).sort();
    const full = layoutMap(catalog, [], "district");
    // What the live catalog does with a deleted repository: its project and agents drop out.
    const live: Catalog = { ...catalog, projects: catalog.projects.filter(p => p.id !== "service-desk"), agents: catalog.agents.filter(a => a.projectId !== "service-desk") };
    expect(where(layoutMap(live, [], "district"))).not.toEqual(where(full));
    expect(where(layoutMap(keepRemovedLots(live, catalog), [], "district"))).toEqual(where(full));
  });
  it("keeps Career Applications' lot where it was after its manifest is removed", () => {
    // career-application-system was deleted on GitHub and its catalog file removed (2026-11-10).
    expect(catalog.projects.some(p => p.id === "career-optimizer" || p.repository === "khaneilcampbell/career-application-system")).toBe(false);
    expect(catalog.agents.some(a => a.projectId === "career-optimizer")).toBe(false);
    const lot = layoutMap(catalog, [], "district").parks.find(p => p.id === "park:vacant:career-optimizer");
    expect(lot && [lot.ox, lot.oy, lot.w, lot.h]).toEqual([9.75, 22, 5, 5]);
  });
  it("leaves a catalog alone when nothing was dropped", () => {
    expect(keepRemovedLots(catalog, catalog)).toBe(catalog);
  });
});

describe("group names follow their buildings", () => {
  // Command Center and Operations move after packing (#363, #375); their group names must move with them.
  const l = layoutMap(catalog, [], "district");
  const inside = (x: number, y: number, d: { ox: number; oy: number; size: number }) => x > d.ox && x < d.ox + d.size && y > d.oy && y < d.oy + d.size;
  for (const n of l.neighborhoods.filter((n) => l.districts.some((d) => d.group === n.key))) {
    it(`${n.label} stands on its own district and nobody else's`, () => {
      const own = l.districts.filter((d) => d.group === n.key);
      for (const d of own) {
        expect(d.ox).toBeGreaterThanOrEqual(n.ox - 1e-9);
        expect(d.oy).toBeGreaterThanOrEqual(n.oy - 1e-9);
        expect(d.ox + d.size).toBeLessThanOrEqual(n.ox + n.w + 1e-9);
        expect(d.oy + d.size).toBeLessThanOrEqual(n.oy + n.h + 1e-9);
      }
      const a = n.anchor!;
      expect(own.some((d) => a.x > d.ox && a.x < d.ox + d.size && a.y === d.oy)).toBe(true);
      // The 3D name sits 1.2 behind that edge, in the street: never on another district or a cleared lot.
      for (const d of [...l.districts, ...(l.cleared ?? [])]) expect(inside(a.x, a.y - 1.2, d)).toBe(false);
    });
  }
  it("AI Engineering is named at the Operations tower, not its old cleared lot", () => {
    const n = l.neighborhoods.find((n) => n.label === "AI Engineering")!;
    const hub = l.districts.find((d) => d.project.id === "intelligence-hub")!;
    expect(n.anchor).toEqual({ x: hub.ox + hub.size / 2, y: hub.oy });
  });
});
