import { describe, expect, it } from "vitest";
import { catalog } from ".";
import { servicesOf } from "./roles";
import { n8nWorkflowId } from "../n8n/runs";

// Guards for the data behind the dashboard tabs (CLAUDE.md, "Keep the dashboard tabs current").
// They check what the manifests can prove on their own: live workflows the Atlas tabs can match,
// statuses that don't contradict their own trigger text, and tool buildings nobody added by accident.

const live = catalog.agents.filter((a) => a.status !== "retired");

describe("dashboard tab data", () => {
  it("links every n8n workflow automation to its workflow, so the Automations tab can show its runs", () => {
    // n8n Agents (first-class n8n agents, not workflows) have no workflow page to link.
    const workflows = live.filter((a) => /n8n/i.test(a.runtime ?? "") && !/\bagent\b/i.test(a.framework));
    const missing = workflows.filter((a) => !n8nWorkflowId(a)).map((a) => a.id);
    expect(missing, "add a links entry labelled \"n8n workflow\" pointing at …/workflow/<id>").toEqual([]);
  });

  it("never marks an agent active while its own trigger says it is a draft or not switched on", () => {
    const contradictions = live
      .filter((a) => a.status === "active" && /\bdraft\b|not published|once (switched on|published)|not yet (live|published)/i.test(a.trigger ?? ""))
      .map((a) => `${a.id}: ${a.trigger}`);
    expect(contradictions).toEqual([]);
  });

  it("adds a tool building to a district only for the major tools listed here (Khaneil, 2026-11-13)", () => {
    // A new agent gets a desk inside its building and never resizes the district or moves
    // buildings. Naming an outside service in an agent's registry tools puts a tool building in
    // its district, which re-plans the district, so that is a deliberate choice made here.
    const byProject = Object.fromEntries(
      catalog.projects
        .map((p) => [p.id, servicesOf(catalog.agents.filter((a) => a.projectId === p.id)).map((s) => s.id).sort()] as const)
        .filter(([, s]) => s.length),
    );
    expect(byProject).toEqual({
      "benjaire-site": ["cloudflare", "n8n", "stripe"],
      "commerce-pipeline": ["canva", "n8n", "serper", "stripe"],
      "soc-lab": ["splunk"],
    });
  });
});
