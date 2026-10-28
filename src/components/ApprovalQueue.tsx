import { useState } from "react";
import { useActions } from "../actions/state";
import { runId } from "../actions/rerun";
import { dismissProposal, useProposals } from "../approvals/state";
import type { Proposal } from "../approvals/proposals";
import { relative } from "../lib/time";
import { useAtlas } from "../state";
import { ExternalLink } from "./bits";
import { Icon } from "./Icon";

/**
 * Actions agents propose, each waiting for KC. Approve hands the action to the desktop app,
 * which re-checks it, asks again in a native dialog and logs it; Dismiss hides it here only.
 */
export function ApprovalQueue({ agentId, compact }: { agentId?: string; compact?: boolean }) {
  const { available, status } = useActions();
  const all = useProposals();
  const items = agentId ? all.filter((p) => p.agentId === agentId) : all;
  if (!available) return compact ? <div className="muted small">Approvals run in the desktop app.</div> : null;
  if (!status?.config.rerun_failed_jobs.enabled) {
    return <div className={compact ? "muted small" : "empty"}>Nothing can be proposed while the re-run action is off. Switch it on in Settings to get proposals.</div>;
  }
  if (items.length === 0) return <div className={compact ? "muted small" : "empty"}>Nothing is waiting for your approval.</div>;
  return (
    <ul className="list approvals">
      {items.map((p) => (
        <ProposalRow key={p.id} p={p} />
      ))}
    </ul>
  );
}

function ProposalRow({ p }: { p: Proposal }) {
  const { rerunFailed } = useActions();
  const { refresh } = useAtlas();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const approve = async () => {
    const id = runId(p.run);
    if (id === null) return;
    setBusy(true);
    setNote(null);
    try {
      const o = await rerunFailed(p.repo, id, p.run.attempt ?? null);
      if (o.stage !== "cancelled") setNote({ ok: o.stage === "started", text: o.message });
      if (o.stage === "started" || o.stage === "unknown") void refresh(true);
    } catch (e) {
      setNote({ ok: false, text: String(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <li>
      <div className="list-row approval">
        <span className="sev medium" aria-hidden />
        <span className="grow">
          <div className="title">{p.title}</div>
          <div className="meta">
            <ExternalLink href={p.run.url}>{p.detail}</ExternalLink> · {relative(p.at)}
          </div>
          {note && (
            <div className={`rerun-note small ${note.ok ? "ok" : "bad"}`} role="status">
              {note.text}
            </div>
          )}
        </span>
        <button className="btn small" disabled={busy} onClick={approve} title="Asks again in a native dialog before anything is sent to GitHub">
          <Icon name="check" size={12} /> {busy ? "Waiting…" : "Approve"}
        </button>
        <button className="text-btn small" disabled={busy} onClick={() => dismissProposal(p.id)} title="Hide this proposal. Nothing is sent.">
          Dismiss
        </button>
      </div>
    </li>
  );
}
