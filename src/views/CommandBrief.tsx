import { useMemo } from "react";
import { useAlerts } from "../alerts/state";
import { useProposals } from "../approvals/state";
import { overview } from "../business/dashboard";
import { aiCost, monthOf } from "../business/finance";
import { useBusiness } from "../business/store";
import { useLedgers } from "../execution/ledger";
import { runStatus } from "../execution/report";
import { commandBrief, type BriefLine } from "../product/commandCenter";
import { useAtlas } from "../state";
import { useTasks } from "../tasks/store";
import { useRuns } from "../workflows/runs";
import "../styles/command-brief.css";

/**
 * The first thing in Mission Control: eight plain answers about the owner's whole ecosystem, each
 * one a button to the screen that holds the detail. Read-only, from records already on this device
 * (Task Center, workflow runs, approvals, agent alerts, business goals); no polling, no model calls.
 */
export function CommandBrief({ attention }: { attention: number }) {
  const { setView } = useAtlas();
  const tasks = useTasks();
  const runs = useRuns();
  const ledgers = useLedgers();
  const proposals = useProposals().length;
  const alerts = useAlerts().open.length;
  const business = useBusiness();

  const lines = useMemo(() => {
    const now = Date.now();
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const ledgerOf = new Map(ledgers.map((l) => [l.runId, l]));
    const runStatuses = runs.flatMap((r) => {
      const l = ledgerOf.get(r.id);
      return l ? [runStatus(r, byId, l)] : [];
    });
    const period = monthOf(new Date(now));
    const cost = aiCost(tasks, period);
    const goals = overview(business, tasks, runs, { period, product: "", area: "", source: "all", provenance: "real" }, now).goals;
    const count = (v: string) => goals.filter((g) => g.progress.verdict === v).length;
    return commandBrief({
      tasks,
      runStatuses,
      attention: attention + proposals,
      problems: alerts,
      aiCostUsd: cost.tasks ? cost.usd : null,
      costEstimated: cost.estimated,
      goals: { atRisk: count("at_risk"), missed: count("missed"), metUnconfirmed: count("met_unconfirmed"), total: goals.filter((g) => g.progress.verdict !== "cancelled" && g.progress.verdict !== "draft").length },
      now,
    });
  }, [tasks, runs, ledgers, business, attention, proposals, alerts]);

  return (
    <section className="card command-brief" aria-label="Command brief">
      <div className="card-head">
        <h2 className="grow">Command brief</h2>
        <span className="muted small">From Task Center, workflow runs, alerts and business records on this device</span>
      </div>
      <ul>
        {lines.map((l) => (
          <BriefRow key={l.key} l={l} go={() => setView(l.target)} />
        ))}
      </ul>
    </section>
  );
}

function BriefRow({ l, go }: { l: BriefLine; go: () => void }) {
  return (
    <li className={`brief-${l.tone}`}>
      <button className="brief-row" onClick={go}>
        <span className="brief-q">{l.question}</span>
        <span className="brief-a">{l.answer}</span>
      </button>
    </li>
  );
}
