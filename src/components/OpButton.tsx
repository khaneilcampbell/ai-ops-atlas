import { useEffect, useState } from "react";
import { actionsApi } from "../actions/api";
import { CANCELLABLE, opAvailability } from "../actions/ops";
import { runId } from "../actions/rerun";
import { useActions } from "../actions/state";
import type { Group, Op, WorkflowInfo } from "../actions/types";
import type { WorkflowRun } from "../github/types";
import { useAtlas } from "../state";
import { Icon, type IconName } from "./Icon";

type Note = { ok: boolean; text: string } | null;

/**
 * One of the everyday changes (cancel, run, pause, resume, close, reopen, comment). Hidden until
 * the action is switched on in Settings. Pressing it only asks: the desktop app checks GitHub
 * again, shows a native confirmation, asks for Touch ID and logs the attempt before anything is sent.
 */
export function OpButton({
  repo,
  group,
  op,
  label,
  icon,
  disabled,
  onDone,
}: {
  repo: string;
  group: Group;
  op: Op;
  label: string;
  icon: IconName;
  disabled?: boolean;
  onDone?: () => void;
}) {
  const { status } = useActions();
  const { refresh } = useAtlas();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>(null);
  const a = opAvailability(group, repo, status);
  if (!a.show) return null;

  const go = async () => {
    setBusy(true);
    setNote(null);
    try {
      const o = await actionsApi.op(repo, op);
      // A cancelled dialog needs no message; a cancelled Touch ID says why.
      if (o.stage !== "cancelled" || o.reason === "touch_id") setNote({ ok: o.stage === "done", text: o.message });
      if (o.stage === "done" || o.stage === "unknown") {
        void refresh(true);
        onDone?.();
      }
    } catch (e) {
      setNote({ ok: false, text: String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="rerun">
      <button className="btn small" disabled={!a.enabled || busy || disabled} title={a.enabled ? "Asks for confirmation and Touch ID before anything is sent to GitHub" : a.reason} onClick={go}>
        <Icon name={icon} size={12} /> {busy ? "Waiting…" : label}
      </button>
      {note && (
        <span className={`rerun-note small ${note.ok ? "ok" : "bad"}`} role="status">
          {note.text}
        </span>
      )}
    </span>
  );
}

/** "Cancel" for a queued or running workflow run. */
export function CancelRunButton({ repo, run }: { repo: string; run: WorkflowRun }) {
  const id = runId(run);
  if (!CANCELLABLE.includes(run.status) || id === null) return null;
  return <OpButton repo={repo} group="cancel_runs" op={{ kind: "cancel_run", run_id: id }} label="Cancel" icon="close" />;
}

/**
 * Run, pause and resume for an agent's GitHub workflow. Reads the workflow's state from GitHub
 * (read-only) to decide which buttons apply; shows nothing until either action is switched on.
 */
export function WorkflowControls({ repo, workflow }: { repo: string; workflow: string }) {
  const { status } = useActions();
  const run = opAvailability("run_workflows", repo, status);
  const pause = opAvailability("pause_workflows", repo, status);
  const wanted = (run.show && run.enabled) || (pause.show && pause.enabled);
  const [info, setInfo] = useState<WorkflowInfo | "loading" | { error: string } | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!wanted) return;
    let live = true;
    setInfo("loading");
    actionsApi
      .workflowInfo(repo, workflow)
      .then((i) => live && setInfo(i))
      .catch((e) => live && setInfo({ error: String(e) }));
    return () => {
      live = false;
    };
  }, [repo, workflow, wanted, tick]);

  if (!run.show && !pause.show) return null;
  const reload = () => setTick((t) => t + 1);
  const ready = info && info !== "loading" && !("error" in info) ? info : null;
  const active = ready?.state === "active";

  return (
    <div className="workflow-controls">
      <div className="muted small">
        <span className="mono">{workflow}</span>
        {info === "loading" && " · checking GitHub…"}
        {ready && ` · ${active ? "active" : ready.state.replace(/_/g, " ")}`}
        {ready && !ready.dispatchable && run.show && " · can't be started by hand (no workflow_dispatch trigger)"}
        {info && info !== "loading" && "error" in info && ` · ${info.error}`}
        {!wanted && ` · ${(run.show && !run.enabled && run.reason) || (pause.show && !pause.enabled && pause.reason) || ""}`}
      </div>
      <div className="workflow-buttons">
        {ready?.dispatchable && active && <OpButton repo={repo} group="run_workflows" op={{ kind: "run_workflow", workflow }} label="Run workflow" icon="play" onDone={reload} />}
        {ready && active && <OpButton repo={repo} group="pause_workflows" op={{ kind: "pause_workflow", workflow }} label="Pause" icon="pause" onDone={reload} />}
        {ready && !active && <OpButton repo={repo} group="pause_workflows" op={{ kind: "resume_workflow", workflow }} label="Resume" icon="play" onDone={reload} />}
      </div>
    </div>
  );
}
