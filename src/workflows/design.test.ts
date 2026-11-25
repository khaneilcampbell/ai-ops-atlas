import { describe, expect, it } from "vitest";
import { catalog } from "../catalog";
import { memoryBackend } from "../tasks/store";
import { BENJAIRE_LAUNCH, BENJAIRE_LAUNCH_GOAL } from "./benjaireLaunch";
import { addStep, availableOutputs, draftDefinition, draftFromDefinition, draftProblems, moveStep, previewDraft, removeStep, toggleHandoff, updateStep, type WorkflowDraft } from "./design";
import { DraftStore } from "./drafts";
import { topoOrder } from "./graph";

const template = BENJAIRE_LAUNCH;
const seed = () => draftFromDefinition(template, BENJAIRE_LAUNCH_GOAL.id).draft;
const agentId = catalog.agents.find((a) => a.status !== "retired")!.id;
const retired = catalog.agents.find((a) => a.status === "retired");
const texts = (d: WorkflowDraft) => draftProblems(d, catalog).map((p) => p.text);

/** The seeded draft with an agent on the two template steps nothing does yet. */
function valid(): WorkflowDraft {
  let d = seed();
  for (const id of ["develop", "quality"]) d = updateStep(d, id, { agentId });
  return d;
}

describe("Design mode drafts from a template", () => {
  it("keeps the workflow's identity and version, and leaves the template untouched", () => {
    const before = JSON.stringify(template);
    const d = seed();
    expect(d.status).toBe("draft");
    expect(d.definitionId).toBe(template.id);
    expect(d.baseVersion).toBe(template.version);
    expect(d.revision).toBe(0);
    expect(JSON.stringify(template)).toBe(before);
  });

  it("is sequential in run order along the go-ahead path, ending in one completion step", () => {
    const { draft, notes } = draftFromDefinition(template, BENJAIRE_LAUNCH_GOAL.id);
    const ids = draft.steps.map((s) => s.id);
    expect(ids).not.toContain("parked");
    expect(ids[0]).toBe("intake");
    expect(ids[ids.length - 1]).toBe("launched");
    expect(draft.steps.filter((s) => s.kind === "outcome")).toHaveLength(1);
    expect(draft.steps.find((s) => s.id === "viability")?.kind).toBe("approval");
    expect(draft.steps.find((s) => s.id === "viability")?.agentId).toBeUndefined();
    expect(notes.join(" ")).toContain("Idea parked");
    // Same relative order as the template's own run order.
    const order = topoOrder(template)!;
    expect(ids).toEqual([...ids].sort((a, b) => order.indexOf(a) - order.indexOf(b)));
  });

  it("links an input to the earlier output with the same name as a handoff", () => {
    const d = seed();
    const viability = d.steps.find((s) => s.id === "viability")!;
    expect(viability.handoffs).toEqual([{ fromStepId: "scoring", output: "Ranked ideas with scores" }]);
    expect(viability.inputs).not.toContain("Ranked ideas with scores");
  });

  it("links the template's shorter wording to the output it names, and keeps other inputs as they are", () => {
    const scoring = seed().steps.find((s) => s.id === "scoring")!;
    expect(scoring.handoffs).toEqual([
      { fromStepId: "market-research", output: "Idea long list with demand signals" },
      { fromStepId: "customer-research", output: "Personas and buyer pains" },
      { fromStepId: "competitor-analysis", output: "Competitor map with prices" },
    ]);
    expect(scoring.inputs).toEqual([]);
    expect(seed().steps.find((s) => s.id === "market-research")!.inputs).toEqual(["The goal", "Web search (at most 5 searches a run)"]);
  });

  it("names exactly what the seeded template still lacks: an agent for development and quality", () => {
    const problems = draftProblems(seed(), catalog);
    expect(problems.map((p) => p.stepId).sort()).toEqual(["develop", "quality"]);
    expect(draftProblems(valid(), catalog)).toEqual([]);
  });
});

describe("Design mode edits", () => {
  it("adds steps with stable unique ids after the selected step, never after completion", () => {
    let d = valid();
    const a = addStep(d, "agent", "scoring");
    d = a.draft;
    expect(a.id).toBe("step-1");
    expect(d.steps[d.steps.findIndex((s) => s.id === "scoring") + 1].id).toBe("step-1");
    const b = addStep(d, "agent", "launched");
    expect(b.id).toBe("step-2");
    expect(b.draft.steps[b.draft.steps.length - 1].id).toBe("launched");
    const c = addStep(b.draft, "approval", null);
    expect(c.id).toBe("approval-1");
    expect(c.draft.steps[c.draft.steps.length - 2].id).toBe("approval-1");
    expect(new Set(c.draft.steps.map((s) => s.id)).size).toBe(c.draft.steps.length);
    expect(c.draft.steps.map((s) => s.stage)).toEqual(c.draft.steps.map((_, i) => i + 1));
  });

  it("removes and reorders steps, but never moves or removes the completion step", () => {
    const d = valid();
    expect(removeStep(d, "launched")).toBe(d);
    expect(moveStep(d, "monitor", 1)).toBe(d);
    expect(moveStep(d, "launched", -1)).toBe(d);
    const moved = moveStep(d, "customer-research", -1);
    expect(moved.steps.map((s) => s.id).slice(1, 3)).toEqual(["customer-research", "market-research"]);
    expect(removeStep(d, "brief").steps.some((s) => s.id === "brief")).toBe(false);
  });

  it("does not change the draft it was given", () => {
    const d = valid();
    const before = JSON.stringify(d);
    updateStep(d, "brief", { title: "Changed" });
    addStep(d, "approval", "brief");
    moveStep(d, "brief", -1);
    removeStep(d, "brief");
    expect(JSON.stringify(d)).toBe(before);
  });
});

describe("Design mode handoffs", () => {
  it("offers only earlier steps' outputs and toggles them on and off", () => {
    const d = valid();
    const options = availableOutputs(d, "planning");
    const at = (id: string) => d.steps.findIndex((s) => s.id === id);
    expect(options.every((o) => at(o.fromStepId) < at("planning"))).toBe(true);
    const brief = options.find((o) => o.fromStepId === "brief")!;
    const on = toggleHandoff(updateStep(d, "planning", { handoffs: [] }), "planning", brief);
    expect(on.steps.find((s) => s.id === "planning")!.handoffs).toContainEqual(brief);
    const off = toggleHandoff(on, "planning", brief);
    expect(off.steps.find((s) => s.id === "planning")!.handoffs).not.toContainEqual(brief);
  });

  it("flags a handoff whose output was renamed, whose step was removed or that now comes later", () => {
    const d = valid();
    const brief = d.steps.find((s) => s.id === "brief")!;
    const linked = updateStep(d, "planning", { handoffs: [{ fromStepId: "brief", output: brief.outputs[0] }] });
    expect(texts(linked)).toEqual([]);
    const onlyPlanning = (d: WorkflowDraft) =>
      draftProblems(d, catalog)
        .filter((p) => p.stepId === "planning")
        .map((p) => p.text);
    expect(onlyPlanning(updateStep(linked, "brief", { outputs: ["Something else"] }))).toEqual([expect.stringContaining("doesn't produce")]);
    expect(onlyPlanning(removeStep(linked, "brief"))).toEqual([expect.stringContaining("isn't in the workflow")]);
    expect(onlyPlanning(moveStep(linked, "brief", 1))).toEqual([expect.stringContaining("comes later")]);
  });

  it("labels each arrow with how many handoffs reach the next step", () => {
    const def = draftDefinition(valid());
    expect(def.id).toBe(template.id);
    expect(def.edges).toHaveLength(def.nodes.length - 1);
    expect(def.edges.find((e) => e.to === "viability")?.label).toBe("1 handoff");
    expect(def.edges.find((e) => e.to === "approve-launch")?.label).toBe("2 handoffs");
    expect(topoOrder(def)).toEqual(def.nodes.map((n) => n.id));
  });
});

describe("Design mode validation", () => {
  it("needs a valid, active agent on every agent step", () => {
    expect(texts(updateStep(valid(), "brief", { agentId: undefined }))).toEqual([expect.stringContaining("needs an agent")]);
    expect(texts(updateStep(valid(), "brief", { agentId: "no-such-agent" }))).toEqual([expect.stringContaining("isn't in the Atlas catalog")]);
    if (retired) expect(texts(updateStep(valid(), "brief", { agentId: retired.id }))).toEqual([expect.stringContaining("retired")]);
  });

  it("doesn't need an agent on an approval, and refuses one", () => {
    const d = addStep(valid(), "approval", "brief");
    expect(texts(d.draft)).toEqual([]);
    expect(texts(updateStep(d.draft, d.id, { agentId }))).toEqual([expect.stringContaining("Approvals are made by Khaneil")]);
  });

  it("needs stable unique ids", () => {
    const d = valid();
    expect(texts(updateStep(d, "brief", { id: "planning" } as never))).toEqual([]); // ids can't be edited
    const dup = { ...d, steps: d.steps.map((s) => (s.id === "brief" ? { ...s, id: "planning" } : s)) };
    expect(texts(dup)).toContain('Two steps share the id "planning".');
    const bad = { ...d, steps: d.steps.map((s) => (s.id === "brief" ? { ...s, id: "Product Brief" } : s)) };
    expect(texts(bad)[0]).toContain("isn't a stable id");
  });

  it("needs a start with an agent step and one completion step at the end", () => {
    const d = valid();
    expect(texts({ ...d, steps: [] })).toEqual(["The workflow has no steps."]);
    const startsWithApproval = moveStep(moveStep(d, "viability", -1), "viability", -1);
    const first = addStep(d, "approval", null).draft;
    const approvalFirst = { ...first, steps: [first.steps.find((s) => s.kind === "approval" && s.id.startsWith("approval-"))!, ...first.steps.filter((s) => !s.id.startsWith("approval-"))] };
    expect(texts(approvalFirst)).toContain("The workflow must start with an agent step.");
    expect(texts({ ...d, steps: d.steps.filter((s) => s.kind !== "outcome") })).toContain("The workflow needs one completion step, at the end.");
    expect(startsWithApproval.steps.length).toBe(d.steps.length);
  });

  it("refuses an approval with nothing after it and two approvals in a row", () => {
    const d = valid();
    const end = addStep(d, "approval", "monitor");
    expect(texts(end.draft).join(" ")).toContain("nothing left to approve");
    const twice = addStep(d, "approval", "approve-scope");
    expect(texts(twice.draft).join(" ")).toContain("Two approvals in a row");
  });

  it("needs instructions and an output on agent steps", () => {
    const d = addStep(valid(), "agent", "brief");
    const withAgent = updateStep(d.draft, d.id, { agentId });
    expect(texts(withAgent)).toEqual([expect.stringContaining("should do"), expect.stringContaining("produces")]);
    expect(texts(updateStep(withAgent, d.id, { instructions: "Write it", outputs: ["Notes"] }))).toEqual([]);
  });
});

describe("Design mode preview", () => {
  it("is not ready while anything is invalid, and says what to fix", () => {
    const p = previewDraft(seed(), catalog);
    expect(p.ready).toBe(false);
    expect(p.problems.length).toBeGreaterThan(0);
  });

  it("describes every step in order when ready, without claiming anything ran", () => {
    const d = valid();
    const p = previewDraft(d, catalog);
    expect(p.ready).toBe(true);
    expect(p.lines.map((l) => l.stepId)).toEqual(d.steps.map((s) => s.id));
    expect(p.lines.find((l) => l.stepId === "approve-scope")?.text).toContain("Waits for Khaneil to approve");
    expect(p.lines.find((l) => l.stepId === "viability")?.text).toContain("Waits for Khaneil");
    expect(p.lines.find((l) => l.stepId === "launched")?.text).toContain("completes");
    expect(p.lines.find((l) => l.stepId === "scoring")?.text).toMatch(/If it fails: pause for review/);
    expect(p.lines.map((l) => l.text).join(" ")).not.toMatch(/\b(completed|succeeded|ran)\b/);
  });
});

describe("Draft store", () => {
  it("saves numbered revisions per workflow and never writes the template", () => {
    const backend = memoryBackend();
    const store = new DraftStore(backend);
    const first = store.save(valid(), "2026-11-25T12:00:00Z");
    expect(first.error).toBeNull();
    expect(first.draft?.revision).toBe(1);
    expect(first.draft?.savedAt).toBe("2026-11-25T12:00:00Z");
    const second = store.save(updateStep(first.draft!, "brief", { title: "Brief v2" }), "2026-11-25T12:05:00Z");
    expect(second.draft?.revision).toBe(2);
    // A fresh store on the same storage reads it back.
    const again = new DraftStore(backend).get(template.id)!;
    expect(again.revision).toBe(2);
    expect(again.steps.find((s) => s.id === "brief")?.title).toBe("Brief v2");
    expect(again.definitionId).toBe(template.id);
    expect(template.nodes.find((n) => n.id === "brief")?.title).toBe("Product brief");
  });

  it("drops a draft on discard and ignores damaged or mismatched records", () => {
    const backend = memoryBackend(JSON.stringify({ version: 1, drafts: { other: { ...valid(), definitionId: "x" }, broken: { status: "draft" } } }));
    const store = new DraftStore(backend);
    expect(store.all()).toEqual({});
    store.save(valid());
    expect(store.discard(template.id)).toBeNull();
    expect(new DraftStore(backend).get(template.id)).toBeUndefined();
    expect(new DraftStore(memoryBackend("not json")).all()).toEqual({});
  });

  it("reports a full or unavailable storage instead of throwing", () => {
    const store = new DraftStore({
      read: () => null,
      write: () => {
        throw new Error("full");
      },
    });
    const r = store.save(valid());
    expect(r.draft).toBeNull();
    expect(r.error).toContain("Couldn't save the draft");
  });
});
