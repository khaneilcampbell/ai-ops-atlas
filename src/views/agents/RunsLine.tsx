import { useAtlas } from "../../state";

/** The automations an agent runs, as one plain line. They are fixed steps, not agents, so the Agents
 *  tab never lists them as agent rows (Khaneil, 2026-11-18); the button opens them in Automations. */
export function RunsLine({ agent, steps, as: Tag = "li" }: { agent: string; steps: { id: string; title: string }[]; as?: "li" | "div" }) {
  const { setView, select } = useAtlas();
  if (!steps.length) return null;
  return (
    <Tag className="role-runs muted small" role="note" aria-label={`Automations run by ${agent}`} data-count={steps.length}>
      Runs {steps.length} {steps.length === 1 ? "automation" : "automations"}: {steps.map((s) => s.title).join(", ")}.{" "}
      <button className="text-btn small" onClick={() => { setView("automations"); select({ kind: "agent", id: steps[0].id }); }}>View in Automations</button>
    </Tag>
  );
}
