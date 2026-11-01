import { describe, expect, it } from "vitest";
import { groupLabels } from "./groupLabels";

describe("groupLabels", () => {
  it("names tag and status groups the same way as districts, count in the tooltip only", () => {
    const tags = groupLabels([{ key: "t:claude", label: "claude", count: 1 }, { key: "t:", label: "Untagged", count: 2 }]);
    expect(tags.map((l) => l.text)).toEqual(["CLAUDE", "UNTAGGED"]);
    expect(tags[0]).toMatchObject({ title: "claude tag · 1 project", district: false });
    const districts = groupLabels([{ key: "d:ai-operations", label: "AI Operations", count: 3 }, { key: "d:ai-engineering", label: "AI Engineering", count: 2 }]);
    expect(districts[0]).toMatchObject({ text: "AI OPERATIONS", title: "AI Operations district · 3 projects", district: true });
    expect(groupLabels([{ key: "s:active", label: "Active", count: 4 }, { key: "s:idle", label: "Idle", count: 1 }])[1].title).toBe("Idle status group · 1 project");
  });
  it("draws nothing for a single group or no grouping", () => {
    expect(groupLabels([{ key: "all", label: "", count: 9 }])).toEqual([]);
    expect(groupLabels([{ key: "s:active", label: "Active", count: 9 }])).toEqual([]);
  });
});
