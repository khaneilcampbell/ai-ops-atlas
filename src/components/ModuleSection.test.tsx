import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { catalog } from "../catalog";
import { AtlasContext } from "../state";
import { ModuleSection } from "./ModuleSection";

const render = (selection: unknown, repos: Record<string, unknown> = {}) =>
  renderToStaticMarkup(<AtlasContext.Provider value={{ selection, catalog, repos, setView: () => {} } as never}><ModuleSection /></AtlasContext.Provider>);

it("shows the module behind a building, keeping the building's own name out of the module", () => {
  const html = render({ kind: "project", id: "benjaire-site" });
  expect(html).toContain("Business Operations HQ");
  expect(html).toContain("Partly available");
  expect(html).toContain("planned capabilities, not built yet");
});

it("reports health as not verified when CI has not loaded, and names the source", () => {
  const html = render({ kind: "project", id: "ai-ops-atlas" });
  expect(html).toContain("Not verified");
  expect(html).toContain("GitHub CI on khaneilcampbell/ai-ops-atlas: Not loaded");
  expect(html).toContain("Open Mission →");
});

it("marks a planned landmark module as not live and offers no navigation", () => {
  const html = render({ kind: "service", id: "skyline-stadium" });
  expect(html).toContain("Growth &amp; Marketing Studio");
  expect(html).toContain("Planned · Not connected");
  expect(html).toContain("No telemetry connected");
  expect(html).not.toContain("Open ");
});

it("renders nothing for buildings without a module", () => {
  expect(render({ kind: "project", id: "portfolio-site" })).toBe("");
  expect(render({ kind: "service", id: "financial-park" })).toBe("");
  expect(render(null)).toBe("");
});
