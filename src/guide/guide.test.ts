import { describe, expect, it } from "vitest";
import { catalog } from "../catalog";
import { ESSENTIAL_ROLES } from "../catalog/essentialRoles";
import { SECTIONS } from "../lib/sections";
import { PAGE_TABS } from "../views/Agents";
import { guidePlaces, operation, PAGE_TAB_TEXT, PLACE_TEXT, TAB_TEXT } from "./guide";

const ORDER = ["map", "overview", "business", "projects", "agents", "automations", "tasks", "workspace", "intel", "grid", "settings"];

describe("the Atlas guide", () => {
  it("explains every section and every tab, so a new one cannot ship unexplained", () => {
    for (const s of SECTIONS) {
      expect(PLACE_TEXT[s.id]?.what, s.id).toBeTruthy();
      if (s.tabs.length > 1) for (const t of s.tabs) expect(TAB_TEXT[t.view], t.view).toBeTruthy();
    }
    for (const t of PAGE_TABS) expect(PAGE_TAB_TEXT[t.id]?.text, t.id).toBeTruthy();
  });

  it("lists places in Khaneil's order, ending with the Output Library", () => {
    const places = guidePlaces(SECTIONS, ORDER, PAGE_TABS);
    expect(places.map((p) => p.id)).toEqual([...ORDER, "library"]);
    expect(places.find((p) => p.id === "intel")!.tabs[0]).toMatchObject({ id: "guide", label: "Overview" });
  });

  it("shows page tabs only on their page and only once the page has them", () => {
    const tabs = [{ id: "directory", label: "Directory" }, { id: "manage", label: "Manage automations" }];
    const places = guidePlaces(SECTIONS, ["agents", "automations"], tabs);
    expect(places[0].tabs.map((t) => t.id)).toEqual(["directory"]);
    expect(places[1].tabs.map((t) => t.id)).toEqual(["directory", "manage"]);
    // Board is written ahead for an open pull request; it stays hidden until the page lists it.
    expect(places[1].tabs.some((t) => t.id === "board")).toBe(false);
  });

  it("reads the operating structure from the catalog", () => {
    const op = operation(catalog.agents);
    expect(op.coordinator).toBe("Yusuf Demir");
    expect(op.leads).toHaveLength(ESSENTIAL_ROLES.length);
    expect(op.withSkills).toEqual(["Leila Haddad"]);
    expect(op.leads.find((l) => l.lead === "Leila Haddad")!.skills).toBe(5);
    expect(op.leads.reduce((n, l) => n + l.automations, 0) + op.orphans).toBe(op.automations);
  });
});
