import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { catalog } from "../catalog";
import { AtlasContext } from "../state";
import { ModuleSection } from "./ModuleSection";

// No Atlas Intelligence on this device: the lists read telemetry as unavailable.
vi.mock("../intel/state", () => ({ useIntel: () => ({ telemetry: null }) }));

const noop = () => {};
const render = (selection: unknown, repos: Record<string, unknown> = {}) =>
  renderToStaticMarkup(<AtlasContext.Provider value={{ selection, catalog, repos, uncataloged: [], settings: { refreshMinutes: 30 }, setView: noop, select: noop, setFilters: noop, clearFilters: noop } as never}><ModuleSection /></AtlasContext.Provider>);

it("shows the module behind a building, keeping the building's own name out of the module", () => {
  const html = render({ kind: "project", id: "benjaire-site" });
  expect(html).toContain("Business Operations HQ");
  expect(html).toContain("Partly available");
  expect(html).toContain("planned capabilities, not built yet");
});

it("reports health as not verified when CI has not loaded, and names the source", () => {
  const html = render({ kind: "project", id: "ai-ops-atlas" });
  expect(html).toContain("Not verified");
  expect(html).toContain("Checking GitHub CI");
  expect(html).toContain('data-state="loading"');
  expect(html).toContain("Open Mission →");
});

it("shows the publishing pipeline in the Product Marketplace, with stages switched off on purpose as not running", () => {
  const html = render({ kind: "service", id: "atlas-marketplace" });
  expect(html).toContain("Commerce &amp; Product Marketplace");
  expect(html).toContain('aria-label="Publishing pipeline"');
  expect(html).toContain("not running");
  expect(html).not.toContain("No commerce agents");
});

it("reads Product Marketplace health from its operating agent's live reports, never CI alone", () => {
  const html = render({ kind: "service", id: "atlas-marketplace" });
  expect(html).toContain('aria-label="Live feed"');
  expect(html).toContain("Marketplace Steward");
  expect(html).not.toContain("Healthy");
});

it("shows site traffic and research briefs in the Growth & Marketing Studio, loading until data arrives", () => {
  const html = render({ kind: "service", id: "benjaire-marketing" });
  expect(html).toContain("Growth &amp; Marketing Studio");
  expect(html).toContain('aria-label="Site traffic"');
  expect(html).toContain("Site traffic · Loading");
  expect(html).toContain('aria-label="Product research briefs"');
  expect(html).not.toContain("0 page views");
  // Its health comes from its own sources, never the "no telemetry" line or a guessed green.
  expect(html).not.toContain("No telemetry connected");
  expect(html).toContain("Checking the site");
  expect(html).not.toContain("Healthy");
});

it("shows the model inventory and cost per model in the Model Intelligence Lab", () => {
  const html = render({ kind: "service", id: "airport-building:cargo" });
  expect(html).toContain("Model Intelligence Lab");
  expect(html).toContain('aria-label="Model inventory"');
  expect(html).toContain('aria-label="Cost per model"');
  expect(html).not.toContain("$0.00 known");
});

it("renders nothing for buildings without a module", () => {
  expect(render({ kind: "project", id: "portfolio-site" })).toBe("");
  expect(render({ kind: "service", id: "financial-park" })).toBe("");
  expect(render(null)).toBe("");
});

it("lists the building's linked assets and the agents landmark's whole roster", () => {
  expect(render({ kind: "project", id: "ai-ops-atlas" })).toMatch(/Linked assets.*\d+ repositor.*\d+ agents?.*\d+ automations?/);
  const agents = render({ kind: "project", id: "intelligence-hub" });
  expect(agents).toContain("Agent Operations Center");
  expect(agents).toMatch(/\d+ agents/);
  expect(agents).toContain("Recent executions");
});

it("opens the Agents directory scoped to a project building, and unscoped from a landmark", () => {
  expect(render({ kind: "project", id: "intelligence-hub" })).toContain("filtered to Agent Operations Center");
  expect(render({ kind: "service", id: "benjaire-marketing" })).not.toContain("filtered to");
});

it("shows connected signals in the Observability Center and the document inventory in the Knowledge Repository", () => {
  const ops = render({ kind: "service", id: "airport-building:operations" });
  expect(ops).toContain("Observability Center");
  expect(ops).toContain('aria-label="Connected signals"');
  expect(ops).toContain("GitHub");
  expect(ops).toContain("3 planned capabilities");
  const docs = render({ kind: "service", id: "financial:financial-planning" });
  expect(docs).toContain("Knowledge Repository");
  expect(docs).toContain('aria-label="Document inventory"');
  expect(docs).toContain("github.com/khaneilcampbell/ai-ops-atlas");
  expect(docs).toContain("Open Repositories →");
});
