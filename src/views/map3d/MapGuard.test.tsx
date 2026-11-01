import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MapGuard, mapFailureMessage } from "./MapGuard";

describe("3D map guard", () => {
  it("names a graphics failure in plain words", () => {
    expect(mapFailureMessage(new Error("Error creating WebGL context."))).toMatch(/graphics/);
    expect(mapFailureMessage(new Error("Cannot read properties of undefined (reading 'x')"))).toBe("Part of the 3D map stopped drawing.");
    expect(mapFailureMessage(undefined)).toBe("Part of the 3D map stopped drawing.");
  });

  it("draws the map while nothing has failed", () => {
    expect(renderToStaticMarkup(<MapGuard onRetry={() => {}}><span>map</span></MapGuard>)).toBe("<span>map</span>");
  });

  it("shows a note with Try again instead of crashing the view", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const g = new MapGuard({ children: null, onRetry: () => {} });
    g.state = MapGuard.getDerivedStateFromError(new Error("boom"));
    const html = renderToStaticMarkup(<>{g.render()}</>);
    expect(html).toContain('role="alert"');
    expect(html).toContain("Try again");
    expect(html).toContain("flat map");
    err.mockRestore();
  });
});
