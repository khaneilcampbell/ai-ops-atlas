import { describe, expect, it } from "vitest";
import { catalog } from "../catalog";
import { documentCount, documentInventory, projectDocuments } from "./docs";

describe("document inventory", () => {
  it("lists every project's repository page, with manifest links after it and nothing twice", () => {
    const groups = documentInventory(catalog, {});
    expect(groups.map((g) => g.projectId)).toEqual(catalog.projects.map((p) => p.id));
    for (const g of groups) {
      expect(g.documents[0]).toMatchObject({ kind: "repository", source: "GitHub", updated: null });
      expect(new Set(g.documents.map((d) => d.url.toLowerCase())).size).toBe(g.documents.length);
    }
    expect(documentCount(groups)).toBeGreaterThanOrEqual(catalog.projects.length);
    const soc = groups.find((g) => g.projectId === "soc-lab")!;
    expect(soc.documents.map((d) => d.label)).toContain("Project docs");
  });

  it("adds the website a repository declares on GitHub and the push time, once a snapshot exists", () => {
    const p = catalog.projects.find((x) => x.id === "benjaire-site")!;
    const snap = { kind: "ok" as const, stale: false, data: { homepage: "https://benjaire.com/", pushedAt: "2026-11-10T12:00:00Z" } as never };
    const docs = projectDocuments(p, catalog, { [p.repository]: snap }).documents;
    expect(docs[0]).toMatchObject({ kind: "repository", updated: "2026-11-10T12:00:00Z" });
    // The manifest's "Live site" link points at the same place, so the website appears once.
    expect(docs.filter((d) => d.url.replace(/\/$/, "") === "https://benjaire.com")).toHaveLength(1);
    expect(docs.find((d) => d.url.replace(/\/$/, "") === "https://benjaire.com")).toMatchObject({ kind: "website", source: "GitHub" });
  });
});
