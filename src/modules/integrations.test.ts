import { existsSync } from "node:fs";
import { expect, it } from "vitest";
import { MODULE_TYPE_LIST } from "./catalog";
import { INTEGRATION_IDS, INTEGRATION_SOURCE, INTEGRATIONS, integrationLabel } from "./integrations";

it("describes each integration exactly once, with client code that exists", () => {
  expect(INTEGRATION_SOURCE.map((c) => c.id).sort()).toEqual([...INTEGRATION_IDS].sort());
  for (const c of INTEGRATION_SOURCE) expect(existsSync(c.client), `${c.id}: ${c.client}`).toBe(true);
});

it("gives every connector a module names a contract", () => {
  for (const t of MODULE_TYPE_LIST) for (const c of t.connectors) expect(INTEGRATIONS[c], `${t.id} → ${c}`).toBeDefined();
});

it("keeps credentials out of the web view and every integration read-only", () => {
  for (const c of INTEGRATION_SOURCE) {
    expect(c.access).toBe("read");
    expect(["desktop-keychain", "site-server", "none"]).toContain(c.credentials.desktop);
    expect(["desktop-keychain", "site-server", "none"]).toContain(c.credentials.web);
  }
  expect(integrationLabel("github")).toBe("GitHub");
  expect(integrationLabel("unknown-source")).toBe("unknown-source");
});
