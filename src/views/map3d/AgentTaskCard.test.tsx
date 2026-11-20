import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { freeTimeAvailability, freeTimeSentNote } from "../../routine/freeTime";
import type { Segment } from "../../routine/routine";
import { AgentTaskCard, type AgentTaskCardProps } from "./AgentTaskCard";
import { FreeTimePicker } from "./FreeTimePicker";

const identity = { agentId: "a1", personaId: "a1", name: "Elijah Brooks", role: "Development Hub Lead", accent: "#c9a96e", portrait: null, initials: "EB", intro: null, voice: null, kind: "agent", via: null } as unknown as AgentTaskCardProps["identity"];
const card = (over: Partial<AgentTaskCardProps> = {}) =>
  renderToStaticMarkup(
    <AgentTaskCard personaId="a1" identity={identity} status="unknown" workLabel="Development Hub" ops={undefined} seg={null} place="" now={0} source="none" fetchedAt={null} following={false} hasOffice held={false} onClose={() => {}} onFollow={() => {}} onViewOffice={() => {}} onOpenRun={() => {}} onProfile={() => {}} {...over} />,
  );
const free = { t0: 0, t1: 1, phase: null, activity: "relaxing" } as unknown as Segment;

describe("Free time on the map's agent card", () => {
  it("is on every agent's card, closed until pressed", () => {
    const html = card();
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain(">Free time</button>");
    expect(html).not.toContain("ca-freetime");
    expect(card({ held: true, hasOffice: false })).toContain(">Free time</button>");
  });
  it("offers the places for a free agent and says why a busy one can't go", () => {
    const ok = renderToStaticMarkup(<FreeTimePicker name="Elijah Brooks" availability={freeTimeAvailability(free, false)} onPick={() => {}} />);
    expect(ok).toContain("Where should Elijah Brooks go?");
    expect(ok).toContain(">Ferris wheel</button>");
    const busy = renderToStaticMarkup(<FreeTimePicker name="Elijah Brooks" availability={freeTimeAvailability({ ...free, phase: "work" } as unknown as Segment, false)} onPick={() => {}} />);
    expect(busy).toContain("Busy with work right now");
    expect(busy).not.toContain("Ferris wheel");
  });
  it("says only the map changes once sent", () => {
    expect(freeTimeSentNote("Elijah Brooks", "yacht")).toBe("Elijah Brooks is off to a yacht ride. Only the map changes: runs, schedules and permissions stay as they are, and a run that comes due still calls Elijah Brooks back.");
  });
});
