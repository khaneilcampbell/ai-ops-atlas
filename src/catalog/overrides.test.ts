import { describe, expect, it } from "vitest";
import { applyOverrides } from "./overrides";
import type { Agent, Catalog } from "./types";

const agent: Agent = {
  id: "site-ci",
  name: "Site CI",
  purpose: "Builds the site",
  framework: "GitHub Actions",
  status: "active",
  lastRun: null,
  history: [],
  links: [],
  registry: { governance: { autonomy: 1, risk: "low" } },
  projectId: "site",
  repository: "me/site",
};
const catalog: Catalog = { projects: [], agents: [agent] };

describe("local catalog edits", () => {
  it("leaves the catalog alone without edits", () => {
    expect(applyOverrides(catalog, {})).toBe(catalog);
  });

  it("lays name, owner, note and autonomy over the manifest and keeps the manifest name", () => {
    const [a] = applyOverrides(catalog, { "site-ci": { name: "Site guard", owner: "KC", note: "Watch on Fridays", autonomy: 2 } }).agents;
    expect(a.name).toBe("Site guard");
    expect(a.originalName).toBe("Site CI");
    expect(a.localNote).toBe("Watch on Fridays");
    expect(a.registry?.governance).toEqual({ autonomy: 2, risk: "low", credentialOwner: "KC" });
  });

  it("ignores fields left blank and levels out of range", () => {
    const [a] = applyOverrides(catalog, { "site-ci": { note: "x", autonomy: 9 } }).agents;
    expect(a.name).toBe("Site CI");
    expect(a.originalName).toBeUndefined();
    expect(a.registry?.governance?.autonomy).toBe(1);
  });
});
