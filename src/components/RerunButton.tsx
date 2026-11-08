import { useState } from "react";
import { rerunAvailability, runId, RERUN_WINDOW_MS } from "../actions/rerun";
import { useActions } from "../actions/state";
import type { WorkflowRun } from "../github/types";
import { useAtlas } from "../state";
import { Icon } from "./Icon";
import { ExternalLink } from "./bits";
import { isTauri } from "../lib/env";

/**
 * "Re-run failed jobs" for one failed run. Hidden until the action is switched on in
 * Settings. Pressing it only asks: the desktop app checks the run again, shows a native
 * confirmation and logs the attempt before anything reaches GitHub.
 */
export function RerunButton({ repo, run }: { repo: string; run: WorkflowRun }) {
  const { status, rerunFailed } = useActions();
  const { refresh } = useAtlas();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const a = rerunAvailability(run, repo, status);
  // In a browser (the iPhone Home Screen app) Atlas stays read-only: offer GitHub's own
  // Re-run button on the run's page, where the GitHub sign-in on the phone does the writing.
  if (!isTauri()) return <WebRerunLink run={run} />;
  if (!a.show) return null;

  const go = async () => {
    const id = runId(run);
    if (id === null) return;
    setBusy(true);
    setResult(null);
    try {
      const o = await rerunFailed(repo, id, run.attempt ?? null);
      // A cancelled dialog needs no message; everything else says what happened.
      if (o.stage !== "cancelled") setResult({ ok: o.stage === "started", text: o.message });
      if (o.stage === "started" || o.stage === "unknown") void refresh(true);
    } catch (e) {
      setResult({ ok: false, text: String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="rerun">
      <button
        className="btn small"
        disabled={!a.enabled || busy}
        title={a.enabled ? "Asks for confirmation before anything is sent to GitHub" : a.reason}
        onClick={go}
      >
        <Icon name="refresh" size={12} /> {busy ? "Waiting…" : "Re-run failed jobs"}
      </button>
      {result && (
        <span className={`rerun-note small ${result.ok ? "ok" : "bad"}`} role="status">
          {result.text}
        </span>
      )}
    </span>
  );
}

function WebRerunLink({ run }: { run: WorkflowRun }) {
  const failed = run.status === "completed" && (run.conclusion === "failure" || run.conclusion === "timed_out");
  if (!failed || !run.url || Date.now() - Date.parse(run.createdAt) > RERUN_WINDOW_MS) return null;
  return (
    <span className="rerun" title="Opens the run on GitHub. Press Re-run jobs there; Atlas on the web never writes to GitHub.">
      <ExternalLink href={run.url} className="btn small">
        <Icon name="external" size={12} /> Re-run on GitHub
      </ExternalLink>
    </span>
  );
}
