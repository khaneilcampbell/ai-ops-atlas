import { describe, expect, it } from "vitest";
import { catalog } from "../../catalog";
import { identityFor } from "./identity";

describe("identityFor", () => {
  const of = (id: string) => identityFor(catalog.projects.find((p) => p.id === id)!);

  it("gives the first three headquarters their reference identities", () => {
    expect(of("github-profile")).toMatchObject({ symbol: "github", style: "tech" });
    expect(of("ai-ops-atlas")).toMatchObject({ symbol: "atlas", style: "timber", landmark: true });
    expect(of("soc-lab")).toMatchObject({ symbol: "shield", style: "secure" });
  });

  it("derives the rest from catalog metadata", () => {
    expect(of("portfolio-site").symbol).toBe("globe");
    expect(of("career-optimizer").symbol).toBe("briefcase");
    expect(of("commerce-pipeline").symbol).toBe("nodes");
    expect(of("intelligence-hub").symbol).toBe("book");
    expect(of("service-desk").symbol).toBe("chart");
    expect(of("benjaire-site")).toMatchObject({ symbol: "monogram", style: "classic" });
    expect(of("benjaire-ops").symbol).toBe("chart");
    expect(of("benjaire-strategy").symbol).toBe("compass");
  });

  it("has exactly one landmark, and a fallback for unknown projects", () => {
    expect(catalog.projects.filter((p) => identityFor(p).landmark)).toHaveLength(1);
    expect(identityFor({ id: "x", name: "Something new", repository: "me/x", tags: [] }).symbol).toBe("sparkles");
  });
});
