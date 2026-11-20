import { describe, expect, it } from "vitest";
import type { View } from "../state";
import { SECTIONS, SIDEBAR_SECTIONS, sectionEntry, sectionOf, tabOf } from "./sections";

const ALL: View[] = ["overview", "workflows", "tasks", "business", "agents", "automations", "repos", "map", "grid", "activity", "intel", "review", "usage", "api-costs", "api-github", "workspace", "settings", "preferences"];

describe("sidebar sections", () => {
  it("lists Projects, Business, Agents, Automations, Intel and Settings with their pages in order", () => {
    expect(SIDEBAR_SECTIONS.map((s) => [s.label, s.tabs.map((t) => t.label)])).toEqual([
      ["Projects", ["Projects"]],
      ["Business", ["Business"]],
      ["Agents", ["Agents"]],
      ["Automations", ["Automations"]],
      ["Intel", ["Intelligence", "Engineering Review", "Repositories", "Activity"]],
      ["Workspace", ["Workspace"]],
      ["API Usage", ["Provider usage", "Claude & GitHub"]],
      ["Settings", ["Connections", "Preferences"]],
    ]);
  });

  it("gives every view exactly one home, so old links and saved views still land", () => {
    for (const v of ALL) expect(sectionOf(v).tabs.some((t) => t.view === tabOf(v))).toBe(true);
    const placed = SECTIONS.flatMap((s) => s.tabs.map((t) => t.view));
    expect(new Set(placed).size).toBe(placed.length);
  });

  it("keeps Task Center and Workflow Intelligence under Mission Control, and Activity under Intel", () => {
    expect(["overview", "tasks", "workflows"].map((v) => sectionOf(v as View).id)).toEqual(["overview", "overview", "overview"]);
    expect(sectionOf("activity").id).toBe("intel");
    expect(tabOf("workflows")).toBe("overview");
  });

  it("maps the old standalone entries to their new parent", () => {
    expect(sectionOf("repos").id).toBe("intel");
    expect(sectionOf("usage").id).toBe("api");
    expect(sectionOf("automations").id).toBe("automations");
    expect(sectionOf("workspace").id).toBe("workspace");
    // Older links to "settings" open Connections, where the GitHub token and keys live.
    expect(SECTIONS.find((s) => s.id === "settings")!.tabs.find((t) => t.view === "settings")!.label).toBe("Connections");
  });

  it("opens the old GitHub requests tab on the combined Claude & GitHub page", () => {
    expect(sectionOf("api-github").id).toBe("api");
    expect(tabOf("api-github")).toBe("api-costs");
  });

  it("falls back to Projects for a view it does not know", () => {
    expect(sectionOf("not-a-view" as View).id).toBe("map");
  });

  it("reopens a section on its last tab, else its first", () => {
    const intel = SECTIONS.find((s) => s.id === "intel")!;
    expect(sectionEntry(intel, {})).toBe("intel");
    expect(sectionEntry(intel, { intel: "repos" })).toBe("repos");
    expect(sectionEntry(intel, { intel: "agents" })).toBe("intel");
  });
});
