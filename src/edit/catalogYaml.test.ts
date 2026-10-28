import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { editManifest, fieldEdits, readFields } from "./catalogYaml";
import { diff } from "./diff";

const dir = new URL("../../catalog/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".yaml"));
const read = (f: string) => readFileSync(new URL(f, dir), "utf8");

describe("editManifest", () => {
  it("changes only the edited lines in every real manifest", () => {
    for (const f of files) {
      const text = read(f);
      const r = readFields(text, { kind: "project" })!;
      const after = { ...r.fields, status: r.fields.status === "paused" ? "active" : "paused" } as const;
      const out = editManifest(f, text, fieldEdits(r.base, "project", r.fields, after, r.v2));
      const d = diff(text, out.text);
      expect([d.added, d.removed], f).toEqual([1, 1]);
      expect(out.issues, f).toEqual([]);
    }
  });

  it("edits an agent's fields, adding the registry blocks it lacks", () => {
    const f = "benjaire-com.yaml";
    const text = read(f);
    const r = readFields(text, { kind: "agent", id: "benjaire-contact-worker" })!;
    expect(r.fields.title).toBe("Benjaire Contact and Checkout Gateway");
    const after = {
      ...r.fields,
      name: "Contact Worker",
      description: "Validates contact form submissions: Turnstile, rate limit, then forwards valid inquiries to the Benjaire Flow intake.",
      trigger: "",
      schedule: "2026-10-28",
      owner: "KC",
      links: [{ label: "Runbook", url: "https://example.com/runbook" }],
    };
    const out = editManifest(f, text, fieldEdits(r.base, "agent", r.fields, after, r.v2));
    expect(out.issues).toEqual([]);
    const again = readFields(out.text, { kind: "agent", id: "benjaire-contact-worker" })!;
    expect(again.fields).toMatchObject({ name: "Contact Worker", trigger: "", schedule: "2026-10-28", owner: "KC", links: after.links });
    expect(again.fields.description).toBe(after.description);
    // The date-looking schedule is quoted so the app reads it as text.
    expect(out.text).toContain('schedule: "2026-10-28"');
    // Untouched folded text elsewhere stays exactly as written.
    expect(out.text).toContain("  summary: >-\n    Website for Benjaire, an Astro site on Cloudflare Workers with a contact\n");
    const d = diff(text, out.text);
    // name, the two folded lines of purpose, trigger, and the owner line.
    expect(d.removed).toBe(5);
    expect(out.text).toContain("    links:\n      - label: Runbook\n        url: https://example.com/runbook\n");
    expect(out.text).toContain("    purpose: >-\n      Validates contact form submissions: Turnstile, rate limit, then forwards\n");
  });

  it("refuses bad links and empty required fields", () => {
    const text = read("benjaire-com.yaml");
    const r = readFields(text, { kind: "project" })!;
    expect(() => fieldEdits(r.base, "project", r.fields, { ...r.fields, name: " " }, r.v2)).toThrow(/empty/);
    expect(() => fieldEdits(r.base, "project", r.fields, { ...r.fields, links: [{ label: "x", url: "http://x" }] }, r.v2)).toThrow(/https/);
  });

  it("reports a value the catalog validator rejects", () => {
    const text = read("benjaire-com.yaml");
    const out = editManifest("benjaire-com.yaml", text, [{ path: ["project", "status"], value: "sleeping" }]);
    expect(out.issues.map((i) => i.message).join()).toMatch(/status/);
  });
});

describe("diff", () => {
  it("groups changes with context", () => {
    const old = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n");
    const neu = old.replace("line 5", "line five").replace("line 18", "line eighteen");
    const d = diff(old, neu);
    expect([d.added, d.removed, d.hunks.length]).toEqual([2, 2, 2]);
    expect(d.hunks[0].lines[0]).toMatchObject({ kind: "same", oldNo: 2 });
  });
});
