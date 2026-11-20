import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canChangeLibrary, canOpenOnMac, fetchOutput, fetchOutputs, fetchTextPreview, imageSource, libraryAvailability, openOnMac, reconcileReportsOnce, saveOnMac, WEBSITE_SYNC_OFF, type Ask } from "./client";

// The Mac app reads the Library through its Rust shell (src-tauri/src/library.rs) with the website
// sync key. These check what the drawer asks for and how each answer becomes what it shows.
describe("Output Library in the Mac app", () => {
  beforeEach(() => vi.stubGlobal("window", { __TAURI_INTERNALS__: {} }));
  afterEach(() => vi.unstubAllGlobals());

  const recorder = (answer: unknown) => {
    const calls: [string, Record<string, unknown> | undefined][] = [];
    const ask: Ask = async (c, a) => (calls.push([c, a]), typeof answer === "function" ? (answer as (c: string) => unknown)(c) : answer);
    return { calls, ask };
  };

  it("is available, but can't retry or reconcile", async () => {
    expect(libraryAvailability()).toEqual({ ok: true });
    expect(canChangeLibrary()).toBe(false);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await reconcileReportsOnce()).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("asks the Rust shell for the list with the same filters as the web page", async () => {
    const page = { configured: true, storageConnected: true, environment: "production", total: 0, page: 2, pageSize: 20, outputs: [], facets: { agents: [], projects: [] } };
    const { calls, ask } = recorder(page);
    expect(await fetchOutputs({ q: "brief", format: "pdf", page: 2, project: "benjaire", projectAgents: ["a", "b"] }, undefined, ask)).toEqual(page);
    expect(calls[0][0]).toBe("library_list");
    expect(Object.fromEntries(calls[0][1]!.query as [string, string][])).toEqual({ q: "brief", format: "pdf", page: "2", project: "benjaire", projectAgents: "a,b" });
  });

  it("points to website sync when it is off, and keeps the site's own words on errors", async () => {
    await expect(fetchOutput("out_0123456789abcdef0123", undefined, recorder(null).ask)).rejects.toThrow(WEBSITE_SYNC_OFF);
    const refused: Ask = async () => {
      throw "The site refused live updates (401): The sync key doesn't match the site's USAGE_SYNC_TOKEN.";
    };
    await expect(fetchOutput("out_0123456789abcdef0123", undefined, refused)).rejects.toThrow("The site refused the Library (401): The sync key doesn't match");
  });

  it("drops an answer that arrives after the drawer moved on", async () => {
    const ac = new AbortController();
    const ask: Ask = async () => (ac.abort(), { id: "x" });
    await expect(fetchOutput("out_0123456789abcdef0123", ac.signal, ask)).rejects.toThrow("Aborted");
  });

  it("previews text and images from the file bytes", async () => {
    const text = { mime: "text/plain; charset=utf-8", base64: Buffer.from("name,score\nCafé,9\n").toString("base64"), truncatedFrom: 300000 };
    const t = recorder(text);
    expect(await fetchTextPreview("out_0123456789abcdef0123", 3, undefined, t.ask)).toEqual({ text: "name,score\nCafé,9\n", truncatedFrom: 300000 });
    expect(t.calls[0]).toEqual(["library_file", { id: "out_0123456789abcdef0123", version: 3, preview: true }]);

    const png = recorder({ mime: "image/png", base64: "iVBORw0K", truncatedFrom: null });
    expect(await imageSource("out_0123456789abcdef0123", 1, undefined, png.ask)).toBe("data:image/png;base64,iVBORw0K");
    // Anything the site didn't serve as a plain image (SVG is served as a download) isn't drawn.
    await expect(imageSource("out_0123456789abcdef0123", 1, undefined, recorder({ mime: "application/octet-stream", base64: "PHN2Zz4=" }).ask)).rejects.toThrow("downloads instead");
  });

  it("opens safe formats and saves anything", async () => {
    expect(canOpenOnMac("Brief.pdf")).toBe(true);
    expect(canOpenOnMac("Scores.CSV")).toBe(true);
    expect(canOpenOnMac("Page.html")).toBe(false);
    expect(canOpenOnMac("Logo.svg")).toBe(false);
    const open = recorder(null);
    await openOnMac("out_0123456789abcdef0123", 2, "Brief.pdf", open.ask);
    expect(open.calls).toEqual([["library_open", { id: "out_0123456789abcdef0123", version: 2, name: "Brief.pdf" }]]);
    expect(await saveOnMac("out_0123456789abcdef0123", 2, "Page", recorder(true).ask)).toBe(true);
    expect(await saveOnMac("out_0123456789abcdef0123", 2, "Page", recorder(false).ask)).toBe(false);
    const off: Ask = async () => {
      throw WEBSITE_SYNC_OFF;
    };
    await expect(openOnMac("out_0123456789abcdef0123", 2, "Brief.pdf", off)).rejects.toThrow(WEBSITE_SYNC_OFF);
  });
});
