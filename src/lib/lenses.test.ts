import { describe, expect, it } from "vitest";
import { lensLinks, type LensContext, type LensLink } from "./lenses";

const links: LensLink[] = [
  { id: "repo:site-ci", type: "github", a: "repo:me/site", b: "agent:site-ci", pa: "site", pb: "site" },
  { id: "repo:writer", type: "github", a: "repo:me/site", b: "agent:writer", pa: "site", pb: "site" },
  { id: "sync:site", type: "github", a: "repo:me/site", b: "repo:me/atlas", pa: "site", pb: "atlas" },
  { id: "sync:shop", type: "github", a: "repo:me/shop", b: "repo:me/atlas", pa: "shop", pb: "atlas" },
  { id: "dep:a~b", type: "agent", a: "agent:writer", b: "agent:editor", pa: "site", pb: "site" },
  { id: "dep:c~d", type: "n8n", a: "agent:form", b: "agent:flow", pa: "shop", pb: "shop" },
];
const ctx: LensContext = { showAll: false, types: { github: true, agent: true, n8n: true, dependency: true }, selKey: null, automations: new Set(["site-ci", "form", "flow"]) };
const ids = (l: LensLink[]) => l.map((x) => x.id);

describe("map lenses", () => {
  it("keeps the infrastructure view free of lines at rest", () => {
    expect(lensLinks(links, "infrastructure", ctx)).toEqual([]);
  });

  it("shows a selected building's own connections in the infrastructure view", () => {
    expect(ids(lensLinks(links, "infrastructure", { ...ctx, selKey: "repo:me/shop", selProject: "shop" }))).toEqual(["sync:shop", "dep:c~d"]);
    expect(ids(lensLinks(links, "infrastructure", { ...ctx, selKey: "agent:writer" }))).toEqual(["repo:writer", "dep:a~b"]);
  });

  it("shows every enabled type when Show connections is on", () => {
    expect(ids(lensLinks(links, "infrastructure", { ...ctx, showAll: true, types: { ...ctx.types, github: false } }))).toEqual(["dep:a~b", "dep:c~d"]);
  });

  it("draws agent links in the agent network", () => {
    expect(ids(lensLinks(links, "agents", ctx))).toEqual(["dep:a~b", "dep:c~d"]);
  });

  it("draws hosted automations and n8n flows in the automation flow, not AI agents", () => {
    expect(ids(lensLinks(links, "automations", ctx))).toEqual(["repo:site-ci", "dep:c~d"]);
  });
});
