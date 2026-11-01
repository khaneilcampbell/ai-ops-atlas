import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MapSelect } from "./MapSelect";

const GROUPS = ["district", "tag"] as const;
const LABEL = { district: "By district", tag: "By tag" };

describe("MapSelect", () => {
  it("shows the chosen option on its face and keeps a labelled native select with every option", () => {
    const html = renderToStaticMarkup(<MapSelect label="Group projects" value="tag" options={GROUPS} text={(g) => LABEL[g]} onChange={() => {}} />);
    expect(html).toContain('<span class="map-group-value">By tag</span>');
    expect(html).toContain('aria-label="Group projects"');
    expect(html.match(/<option/g)).toHaveLength(2);
    expect(html).not.toContain("short");
  });
  it("adds the phone label and the disabled state", () => {
    const html = renderToStaticMarkup(<MapSelect label="Map view" value="tag" options={GROUPS} text={(g) => LABEL[g]} short={() => "Tag"} disabled onChange={() => {}} />);
    expect(html).toContain('class="map-group disabled"');
    expect(html).toContain('<span class="map-group-value short">Tag</span>');
    expect(html).toContain("disabled");
  });
});
