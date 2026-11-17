import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { catalog } from "../catalog";
import { documentationScore, toProfile } from "./profile";

// Guards the agent profiles filled from production evidence on 2026-11-17, so the workflow can
// move toward autonomy on documented ground: every working entry keeps all 14 profile fields,
// and every runbook link points at a heading that exists.

const project = (id: string) => catalog.projects.find((p) => p.agentIds.includes(id));
const working = catalog.agents.filter((a) => a.status !== "retired" && a.status !== "paused");

// Paused drafts whose configuration Atlas cannot read stay partly "Not documented" rather than guessed.
const UNREADABLE_DRAFTS = ["github-profile-manager"];

describe("agent profile completeness", () => {
  it("keeps every active or on-demand entry fully documented", () => {
    const gaps = working
      .map((a) => ({ id: a.id, s: documentationScore(toProfile(a, project(a.id))) }))
      .filter(({ s }) => s.done < s.total)
      .map(({ id, s }) => `${id}: ${s.missing.join(", ")}`);
    expect(gaps).toEqual([]);
  });

  it("fills every Responsibilities and Goals field the profile shows", () => {
    const gaps: string[] = [];
    for (const a of catalog.agents) {
      if (UNREADABLE_DRAFTS.includes(a.id)) continue;
      const p = toProfile(a, project(a.id));
      const r = p.responsibilities;
      const g = p.goals;
      const miss = [
        !r.tasks.length && "tasks",
        !r.dependencies.length && "dependencies",
        !r.limitations.length && "limitations",
        !g.objective && "objective",
        !g.reviewFrequency && "review frequency",
        !g.kpis.length && "KPIs",
        g.kpis.some((k) => !k.target) && "KPI target",
      ].filter(Boolean);
      if (miss.length) gaps.push(`${a.id}: ${miss.join(", ")}`);
    }
    expect(gaps).toEqual([]);
  });

  it("documents a draft only as far as the evidence goes", () => {
    for (const id of UNREADABLE_DRAFTS) {
      const a = catalog.agents.find((x) => x.id === id)!;
      expect(a.status).toBe("paused");
      expect(a.registry?.mission?.problem).toBeUndefined();
    }
  });

  it("points every runbook link in this repository at a heading that exists", () => {
    const repo = "https://github.com/khaneilcampbell/ai-ops-atlas/blob/main/";
    const slug = (h: string) => h.trim().toLowerCase().replace(/[^\w\s-]/g, "").replace(/\s+/g, "-");
    const broken: string[] = [];
    for (const a of catalog.agents) {
      const link = a.registry?.docs?.runbook;
      if (!link) continue;
      const local = link.startsWith(repo) ? link.slice(repo.length) : link.startsWith("http") ? null : link;
      if (!local) continue;
      const [file, anchor] = local.split("#");
      const path = resolve(__dirname, "../..", file);
      if (!existsSync(path)) { broken.push(`${a.id}: ${file} missing`); continue; }
      if (!anchor) continue;
      const headings = readFileSync(path, "utf8").split("\n").filter((l) => /^#{1,6} /.test(l)).map((l) => slug(l.replace(/^#+ /, "")));
      if (!headings.includes(anchor)) broken.push(`${a.id}: #${anchor} not in ${file}`);
    }
    expect(broken).toEqual([]);
  });
});
