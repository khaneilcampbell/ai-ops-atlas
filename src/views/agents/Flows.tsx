import { useMemo, useState } from "react";
import type { Agent } from "../../catalog/types";
import type { Ownership } from "../../catalog/ownership";
import { isAiAgent } from "../../catalog/roles";
import { AgentAvatar } from "../../components/AgentIdentity";
import { n8nUrl, runtimeFamily, shortTitle } from "../../automations/board";
import { buildFlows, flowLayout, stageOf, STAGES, type Flow } from "../../automations/flows";
import { liveState, statusLabel } from "../../automations/live";
import { identityFor } from "../../registry/identity";
import type { RegistryEntry } from "../../registry/registry";
import { NODE_H, NODE_W } from "../../workflows/graph";
import { relative } from "../../lib/time";
import "../../styles/board.css";

const BOARD_SHOWN = 4;

/** Flows: each owning agent's automations as a diagram joined by recorded handoffs, and a lifecycle board. */
export function Flows({ entries, agents, owns, open }: { entries: RegistryEntry[]; agents: readonly Agent[]; owns: Ownership; open: (id: string) => void }) {
  const flows = useMemo(() => buildFlows(entries, agents, owns), [entries, agents, owns]);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const flow = flows.find((f) => f.ownerId === ownerId) ?? flows[0];
  const [picked, setPicked] = useState<string | null>(null);
  const node = flow?.entries.find((e) => e.profile.id === picked) ?? flow?.entries[0];
  const retired = agents.filter((a) => a.status === "retired" && !isAiAgent(a));
  const byStage = (s: (typeof STAGES)[number]["id"]) => entries.filter((e) => stageOf(e) === s);

  return (
    <div className="flows">
      <div className="flows-main">
        <nav className="card flows-list" aria-label="Flows">
          <div className="eyebrow">Flows</div>
          {flows.map((f) => {
            const id = f.ownerId ? identityFor(f.ownerId, agents) : null;
            return (
              <button key={f.ownerId} className={f === flow ? "on" : ""} aria-current={f === flow || undefined} onClick={() => { setOwnerId(f.ownerId); setPicked(null); }}>
                {id ? <AgentAvatar identity={id} size={26} /> : <i className="flows-noowner" />}
                <span>
                  <b>{id ? `${id.name}` : "No owning agent"}</b>
                  <span className="muted small">{f.entries.length} step{f.entries.length === 1 ? "" : "s"}{f.edges.length ? ` · ${f.edges.length} handoff${f.edges.length === 1 ? "" : "s"}` : ""}</span>
                </span>
              </button>
            );
          })}
        </nav>
        {flow && <Diagram flow={flow} agents={agents} picked={node?.profile.id ?? null} pick={setPicked} />}
        {node && flow && <Step e={node} flow={flow} agents={agents} open={open} pick={setPicked} />}
      </div>

      <section className="card flows-board" aria-label="Lifecycle">
        <div className="flows-board-head">
          <h2>Lifecycle</h2>
          <span className="muted small">Every automation from draft to retired. Read only: publish, pause and retire stay in n8n and the catalog.</span>
        </div>
        <div className="flows-cols">
          {STAGES.map((s) => {
            const items = s.id === "retired" ? retired.map((a) => ({ id: a.id, title: a.name, sub: "Retired in the catalog" })) : byStage(s.id).map((e) => ({ id: e.profile.id, title: shortTitle(e.profile.title), sub: identityFor(e.profile.id, agents).name }));
            return (
              <div key={s.id} className="flows-col">
                <div className="flows-col-head"><b>{s.label}</b><span className="count-pill">{items.length}</span></div>
                <div className="muted small">{s.sub}</div>
                {items.slice(0, BOARD_SHOWN).map((i) => (
                  <button key={i.id} className="flows-card" onClick={() => s.id !== "retired" && open(i.id)} disabled={s.id === "retired"}>
                    <b><i className={`op-dot dot-${s.id === "draft" ? "draft" : s.id === "verified" ? "verified" : "unknown"}`} />{i.title}</b>
                    <span className="muted small">{i.sub}</span>
                  </button>
                ))}
                {items.length > BOARD_SHOWN && <div className="muted small flows-more">+ {items.length - BOARD_SHOWN} more</div>}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function Diagram({ flow, agents, picked, pick }: { flow: Flow; agents: readonly Agent[]; picked: string | null; pick: (id: string) => void }) {
  const lay = useMemo(() => flowLayout(flow), [flow]);
  const name = flow.ownerId ? identityFor(flow.ownerId, agents).name : "No owning agent";
  const gates = new Set(flow.edges.filter((e) => e.gate).map((e) => `${e.from}>${e.to}`));
  return (
    <div className="card flows-canvas">
      <div className="flows-canvas-head">
        <h2>{name}</h2>
        <span className="muted small">{flow.edges.length ? `${flow.edges.length} recorded handoff${flow.edges.length === 1 ? "" : "s"}` : "No handoffs recorded between these automations yet"}</span>
      </div>
      <div className="flows-scroll">
        <div className="flows-stage" style={{ width: lay.width, height: lay.height }}>
          <svg width={lay.width} height={lay.height} aria-hidden>
            <defs>
              <marker id="flows-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" className="flows-arrow" /></marker>
            </defs>
            {lay.edges.map((e) => (
              <g key={e.edge.id} className={gates.has(e.edge.id) ? "gate" : ""}>
                <path d={e.d} markerEnd="url(#flows-arrow)" />
                {gates.has(e.edge.id) && <text x={e.lx} y={e.ly} textAnchor="middle">You approve</text>}
              </g>
            ))}
          </svg>
          {lay.nodes.map((p) => {
            const e = flow.entries.find((x) => x.profile.id === p.node.id)!;
            const s = liveState(e);
            return (
              <button key={p.node.id} className={`flows-node st-${s} ${p.node.id === picked ? "on" : ""}`} style={{ left: p.x, top: p.y, width: NODE_W, height: NODE_H }} onClick={() => pick(p.node.id)} aria-pressed={p.node.id === picked}>
                <b><i className={`op-dot dot-${s === "unverified" ? "unknown" : s}`} />{shortTitle(e.profile.title)}</b>
                <span className="muted small">{runtimeFamily(e)} · {e.profile.execution.trigger ?? "Trigger not documented"}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="flows-legend muted small"><span>→ hands off to</span><span className="gold">→ waits for your approval</span><span>Only handoffs recorded in the catalog are drawn</span></div>
    </div>
  );
}

function Step({ e, flow, agents, open, pick }: { e: RegistryEntry; flow: Flow; agents: readonly Agent[]; open: (id: string) => void; pick: (id: string) => void }) {
  const id = identityFor(e.profile.id, agents);
  const n8n = n8nUrl(agents.find((a) => a.id === e.profile.id));
  const title = (x: string) => shortTitle(flow.entries.find((f) => f.profile.id === x)?.profile.title ?? x);
  const into = flow.edges.filter((h) => h.from === e.profile.id).map((h) => h.to);
  const from = flow.edges.filter((h) => h.to === e.profile.id).map((h) => h.from);
  const s = liveState(e);
  return (
    <aside className="card flows-step" aria-label={`${e.profile.title} step`}>
      <div className="eyebrow">Selected step</div>
      <h2>{shortTitle(e.profile.title)}</h2>
      <div className="lv-pills">
        <span className={`lv-pill lp-${s}`}><i className={`op-dot dot-${s === "unverified" ? "unknown" : s}`} />{statusLabel(e)}</span>
        <span className="lv-pill">{runtimeFamily(e)}</span>
      </div>
      <dl className="flows-rows">
        <div><dt>Owner</dt><dd>{id.name}</dd></div>
        <div><dt>Trigger</dt><dd>{e.profile.execution.trigger ?? "Not documented"}</dd></div>
        <div><dt>Fed by</dt><dd>{from.length ? from.map((x) => <button key={x} className="text-btn inline" onClick={() => pick(x)}>{title(x)}</button>) : "Nothing recorded"}</dd></div>
        <div><dt>Hands off to</dt><dd>{into.length ? into.map((x) => <button key={x} className="text-btn inline" onClick={() => pick(x)}>{title(x)}</button>) : "Nothing recorded"}</dd></div>
        <div><dt>Last run</dt><dd>{e.telemetry.lastAnyRun ? relative(e.telemetry.lastAnyRun.at) : "Never seen"}</dd></div>
        <div><dt>Risk</dt><dd>{e.profile.governance.risk ?? "Not documented"}</dd></div>
      </dl>
      <div className="live-actions">
        {n8n && <a className="btn primary" href={n8n} target="_blank" rel="noreferrer">Open in n8n</a>}
        <button className="btn" onClick={() => open(e.profile.id)}>Full details</button>
      </div>
    </aside>
  );
}
