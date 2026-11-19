import { beforeEach, describe, expect, it } from "vitest";
import { catalog } from ".";
import { identityFor } from "../registry/identity";
import { toProfile } from "../registry/profile";
import { parseProfileEditWrite } from "../data/profileEdits";
import { applyProfileEdits, editableFields, repositoryText, resetProfileEditsForTests } from "./profileEdits";
import type { Agent } from "./types";

const fresh = (): Agent[] => structuredClone(catalog.agents);
const persona = (agents: Agent[]) => agents.find((a) => a.registry?.identity)!;
const plain = (agents: Agent[]) => agents.find((a) => !a.registry?.identity)!;

beforeEach(() => resetProfileEditsForTests());

describe("profile edits over the catalog", () => {
  it("shows edited name, title, description, intro and voice wherever identities and profiles are read", () => {
    const agents = fresh();
    const a = persona(agents);
    const edited = applyProfileEdits(agents, [
      { entity_id: a.id, field: "display_name", value: "Ama Mensah" },
      { entity_id: a.id, field: "title", value: "Repo Health Lead" },
      { entity_id: a.id, field: "summary", value: "Reads one repository and reports its health." },
      { entity_id: a.id, field: "intro", value: "Hi, I'm Ama." },
      { entity_id: a.id, field: "voice", value: "Plain and short." },
    ]);
    expect([...edited.get(a.id)!].sort()).toEqual(["display_name", "intro", "summary", "title", "voice"]);
    const idn = identityFor(a.id, agents);
    expect(idn).toMatchObject({ name: "Ama Mensah", role: "Repo Health Lead", intro: "Hi, I'm Ama.", voice: "Plain and short.", initials: "AM" });
    expect(toProfile(a, undefined)).toMatchObject({ title: "Repo Health Lead", summary: "Reads one repository and reports its health.", displayName: "Ama Mensah" });
  });

  it("puts the repository text back when an edit is removed", () => {
    const agents = fresh();
    const a = persona(agents);
    const original = { name: a.name, display: a.registry!.identity!.displayName };
    applyProfileEdits(agents, [{ entity_id: a.id, field: "title", value: "Temporary" }, { entity_id: a.id, field: "display_name", value: "Temp Name" }]);
    expect(a.name).toBe("Temporary");
    expect(repositoryText(a, "title")).toBe(original.name);
    const edited = applyProfileEdits(agents, []);
    expect(edited.size).toBe(0);
    expect(a.name).toBe(original.name);
    expect(a.registry!.identity!.displayName).toBe(original.display);
  });

  it("ignores unknown agents and persona fields on agents without a persona", () => {
    const agents = fresh();
    const b = plain(agents);
    expect(editableFields(b)).toEqual(["title", "summary"]);
    const edited = applyProfileEdits(agents, [
      { entity_id: "no-such-agent", field: "title", value: "Ghost" },
      { entity_id: b.id, field: "display_name", value: "Should not show" },
    ]);
    expect(edited.size).toBe(0);
    expect(b.registry?.identity).toBeUndefined();
  });

  it("never touches status, trigger, permissions, links or ids", () => {
    const agents = fresh();
    const a = persona(agents);
    const before = JSON.stringify({ id: a.id, status: a.status, trigger: a.trigger, permissions: a.permissions, links: a.links, history: a.history, registry: { ...a.registry, identity: undefined, summary: undefined } });
    applyProfileEdits(agents, [{ entity_id: a.id, field: "title", value: "New title" }, { entity_id: a.id, field: "summary", value: "New summary" }]);
    expect(JSON.stringify({ id: a.id, status: a.status, trigger: a.trigger, permissions: a.permissions, links: a.links, history: a.history, registry: { ...a.registry, identity: undefined, summary: undefined } })).toBe(before);
  });
});

describe("parseProfileEditWrite", () => {
  it("accepts display text and tidies it", () => {
    expect(parseProfileEditWrite({ entityId: "repo-intelligence", field: "title", value: " Repo\n Lead " })).toEqual({ ok: true, value: { entityId: "repo-intelligence", field: "title", value: "Repo Lead", expectedVersion: undefined } });
    expect(parseProfileEditWrite({ entityId: "repo-intelligence", field: "intro", value: null, expectedVersion: 3 })).toMatchObject({ ok: true, value: { value: null, expectedVersion: 3 } });
  });
  it("refuses anything that isn't an allowed display field", () => {
    for (const body of [
      { entityId: "repo-intelligence", field: "status", value: "active" },
      { entityId: "repo-intelligence", field: "permissions", value: "all" },
      { entityId: "../etc", field: "title", value: "x" },
      { entityId: "repo-intelligence", field: "title", value: "" },
      { entityId: "repo-intelligence", field: "voice", value: "x".repeat(201) },
      { entityId: "repo-intelligence", field: "title", value: "bad\u0007bell" },
      { entityId: "repo-intelligence", field: "title", value: 5 },
      [],
    ])
      expect(parseProfileEditWrite(body).ok).toBe(false);
  });
});
