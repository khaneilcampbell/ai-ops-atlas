import { lazy, Suspense } from "react";
import { useAtlas } from "../state";
import { AgentsView } from "./Agents";

const CommandCenter = lazy(() => import("../features/agent-command-center/CommandCenter"));

export function AgentsHub() {
  const { view, setView } = useAtlas();
  const command = view === "command";
  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100%" }}>
      <div style={{ padding: "16px 28px 0" }}>
        <div className="seg" role="tablist" aria-label="Agent workspace">
          <button id="agents-command-tab" role="tab" aria-selected={command} aria-controls="agents-workspace-panel" className={command ? "on" : ""} onClick={() => setView("command")}>Command Center</button>
          <button id="agents-registry-tab" role="tab" aria-selected={!command} aria-controls="agents-workspace-panel" className={!command ? "on" : ""} onClick={() => setView("agents")}>Registry</button>
        </div>
      </div>
      <div id="agents-workspace-panel" role="tabpanel" aria-labelledby={command ? "agents-command-tab" : "agents-registry-tab"} style={{ flex: 1, minWidth: 0 }}>
        {command ? <Suspense fallback={<p role="status">Loading Command Center…</p>}><CommandCenter /></Suspense> : <AgentsView />}
      </div>
    </div>
  );
}
