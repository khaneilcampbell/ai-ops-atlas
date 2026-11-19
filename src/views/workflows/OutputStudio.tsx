import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../../components/Icon";
import { formatDateTime } from "../../lib/timezone";
import { assembleReport, type ReportLine, type WorkflowReport } from "../../outputs/report";
import { CATEGORY_LABEL, OUTPUT_CATEGORIES, STATE_LABEL, VERIFICATION_LABEL, type AgentOutput, type VerificationStatus } from "../../outputs/types";
import { filterOutputs, redact, safeUrl, type OutputFilter } from "../../outputs/validate";
import type { Goal, NodeStatus, RunMode, WorkflowDefinition } from "../../workflows/types";
import { OutputBody } from "./OutputRenderers";
import "../../styles/outputs.css";
import { catalog } from "../../catalog";
import { identityFor } from "../../registry/identity";
import { AgentAvatar, AiAgentLabel } from "../../components/AgentIdentity";

// Agent Output Studio: every output of the workflow on screen, grouped and filterable, under the
// Execution canvas. It shares the canvas's one node selection: picking a step highlights its
// outputs here, picking an output selects its step there. It only reads: live outputs come from
// the run's execution records, simulated ones from fixed samples, and the two never mix.

const PAGE = 12;
const TYPE_LABEL: Record<AgentOutput["type"], string> = { text: "Text", markdown: "Findings", table: "Table", chart: "Chart", json: "Data", document: "Document", code: "Code", image: "Image", link: "Link", error: "Error" };

export interface OutputStudioProps {
  mode: RunMode;
  goal: Goal;
  def: WorkflowDefinition;
  outputs: readonly AgentOutput[];
  status: ReadonlyMap<string, NodeStatus>;
  names: (nodeId: string) => string;
  runLabel: string;
  hasRun: boolean;
  selectedNodeId: string | null;
  onSelect: (nodeId: string) => void;
  onOpenTask?: (taskId: string) => void;
}

/** Reuses the previous object for a finished output whose record hasn't changed, so its card doesn't redraw. */
export function useStableOutputs(next: readonly AgentOutput[]): readonly AgentOutput[] {
  const cache = useRef(new Map<string, { key: string; o: AgentOutput }>());
  return useMemo(() => {
    const seen = new Map<string, { key: string; o: AgentOutput }>();
    const res = next.map((o) => {
      const key = `${o.createdAt}|${o.state}|${o.verificationStatus}|${o.latest}|${o.intel ? JSON.stringify(o.intel) : ""}|${o.type === "table" ? JSON.stringify(o.structuredData).length : ""}`;
      const prev = cache.current.get(o.id);
      const keep = prev && prev.key === key && o.state === "complete" ? prev.o : o;
      seen.set(o.id, { key, o: keep });
      return keep;
    });
    cache.current = seen;
    return res;
  }, [next]);
}

export function OutputStudio({ mode, goal, def, outputs, status, names, runLabel, hasRun, selectedNodeId, onSelect, onOpenTask }: OutputStudioProps) {
  const [filter, setFilter] = useState<OutputFilter>("all");
  const [history, setHistory] = useState(false);
  const [onlyStep, setOnlyStep] = useState(false);
  const [report, setReport] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const listRef = useRef<HTMLDivElement>(null);

  const titleOf = useMemo(() => new Map(def.nodes.map((n) => [n.id, n.title])), [def]);
  // Who produced it: the registry agent, or Khaneil for decisions and approvals.
  const agentOf = useMemo(() => {
    const m = new Map(def.nodes.map((n) => [n.id, n.agentId ? names(n.id) : n.kind === "decision" || n.kind === "approval" ? "Khaneil" : "No agent"]));
    return (id: string) => m.get(id) ?? id;
  }, [def, names]);
  const latestCount = outputs.filter((o) => o.latest).length;
  const counts = useMemo(() => Object.fromEntries(OUTPUT_CATEGORIES.map((c) => [c, filterOutputs(outputs, c, { history }).length])), [outputs, history]);
  const shown = useMemo(() => filterOutputs(outputs, filter, { history, nodeId: onlyStep ? selectedNodeId : null }), [outputs, filter, history, onlyStep, selectedNodeId]);
  // Failures stay apart from successful outputs.
  const good = filter === "errors" ? [] : shown.filter((o) => o.category !== "errors");
  const bad = filter === "all" || filter === "errors" ? shown.filter((o) => o.category === "errors") : [];
  const page = good.slice(0, limit);

  // A step picked on the canvas: bring its first output into view inside the list, not the page.
  useEffect(() => {
    if (!selectedNodeId || report) return;
    const idx = good.findIndex((o) => o.nodeId === selectedNodeId);
    if (idx >= limit) setLimit(Math.ceil((idx + 1) / PAGE) * PAGE);
    const box = listRef.current;
    const el = box?.querySelector<HTMLElement>(`[data-node="${CSS.escape(selectedNodeId)}"]`);
    if (box && el) box.scrollTo({ top: Math.max(0, el.offsetTop - box.offsetTop - 8), behavior: "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNodeId, report]);

  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const rep = useMemo(() => (report ? assembleReport(goal, def, outputs, status, names, mode) : null), [report, goal, def, outputs, status, names, mode]);
  const selectedHasOutputs = !!selectedNodeId && outputs.some((o) => o.nodeId === selectedNodeId && (history || o.latest));

  return (
    <section className="card os-studio" aria-label="Agent Output Studio">
      <div className="os-head">
        <div className="grow">
          <h2>Agent Output Studio</h2>
          <div className="os-meta">{[def.name, `${latestCount} output${latestCount === 1 ? "" : "s"}`, runLabel].join(" · ")}</div>
        </div>
        <span className={`chip${mode === "simulation" ? " wf-chip-sim" : " os-chip-live"}`}>{mode === "simulation" ? "Simulated" : "Live"}</span>
      </div>
      {mode === "simulation" ? (
        <div className="wf-banner sim os-banner">Simulated outputs: fixed illustrative samples, not research, sales or real results. Nothing is called.</div>
      ) : (
        <p className="muted small os-note">Live outputs come only from this run's Task Center records and validated handoffs. Verified means a complete output that passed its step's schema; everything else says unverified.</p>
      )}

      <div className="os-toolbar">
        <div className="os-filters" role="tablist" aria-label="Output type">
          <button role="tab" aria-selected={filter === "all" && !report} className={filter === "all" && !report ? "on" : ""} onClick={() => (setFilter("all"), setReport(false), setLimit(PAGE))}>
            All outputs <span className="os-count">{outputs.filter((o) => history || o.latest).length}</span>
          </button>
          {OUTPUT_CATEGORIES.map((c) => (
            <button key={c} role="tab" aria-selected={filter === c && !report} className={`${filter === c && !report ? "on" : ""}${c === "errors" && counts[c] ? " bad" : ""}`} onClick={() => (setFilter(c), setReport(false), setLimit(PAGE))}>
              {CATEGORY_LABEL[c]} <span className="os-count">{counts[c]}</span>
            </button>
          ))}
          <button role="tab" aria-selected={report} className={`os-report-tab${report ? " on" : ""}`} onClick={() => setReport(true)}>
            <Icon name="flow" size={12} /> Workflow report
          </button>
        </div>
        {!report && (
          <div className="os-opts">
            <label className="wf-check">
              <input type="checkbox" checked={history} onChange={(e) => setHistory(e.target.checked)} /> Earlier attempts
            </label>
            {selectedNodeId && (
              <label className="wf-check">
                <input type="checkbox" checked={onlyStep} onChange={(e) => setOnlyStep(e.target.checked)} /> Only {titleOf.get(selectedNodeId) ?? "selected step"}
              </label>
            )}
          </div>
        )}
      </div>

      {selectedNodeId && !report && (
        <div className="os-selected muted small">
          Selected step: <b>{titleOf.get(selectedNodeId)}</b> · {agentOf(selectedNodeId)} · {selectedHasOutputs ? "its outputs are highlighted" : "no outputs from this step yet"}
        </div>
      )}

      {rep ? (
        <ReportView r={rep} titleOf={titleOf} onSelect={onSelect} />
      ) : (
        <div className="os-list" ref={listRef}>
          {page.length === 0 && bad.length === 0 && (
            <p className="muted small os-empty">
              {mode === "simulation" ? "Press Next step in the simulation to see what each step hands over." : !hasRun ? "Start a live run to see its outputs here." : filter === "all" ? "No outputs recorded yet. They appear as steps report back to the Task Center." : `No ${CATEGORY_LABEL[filter as keyof typeof CATEGORY_LABEL].toLowerCase()} outputs yet.`}
            </p>
          )}
          {page.length > 0 && (
            <div className="os-grid">
              {page.map((o) => (
                <OutputCard key={o.id} o={o} step={titleOf.get(o.nodeId) ?? o.nodeId} agent={agentOf(o.nodeId)} on={o.nodeId === selectedNodeId} open={open.has(o.id)} onToggle={toggle} onSelect={onSelect} onOpenTask={mode === "live" ? onOpenTask : undefined} />
              ))}
            </div>
          )}
          {good.length > limit && (
            <button className="btn small os-more" onClick={() => setLimit((l) => l + PAGE)}>
              Show {Math.min(PAGE, good.length - limit)} more
            </button>
          )}
          {bad.length > 0 && (
            <>
              <div className="section-title os-errors-title">Failures and missing outputs</div>
              <div className="os-grid">
                {bad.map((o) => (
                  <OutputCard key={o.id} o={o} step={titleOf.get(o.nodeId) ?? o.nodeId} agent={agentOf(o.nodeId)} on={o.nodeId === selectedNodeId} open={open.has(o.id)} onToggle={toggle} onSelect={onSelect} onOpenTask={mode === "live" ? onOpenTask : undefined} />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}

const VTONE: Record<VerificationStatus, string> = { verified: "good", unverified: "warn", simulated: "sim" };

interface CardProps {
  o: AgentOutput;
  step: string;
  agent: string;
  on: boolean;
  open: boolean;
  onToggle: (id: string) => void;
  onSelect: (nodeId: string) => void;
  onOpenTask?: (taskId: string) => void;
}

const OutputCard = memo(function OutputCard({ o, step, agent, on, open, onToggle, onSelect, onOpenTask }: CardProps) {
  // Results are attributed to the agent that produced them; a catalog agent shows its identity.
  const identity = o.agentId && catalog.agents.some((a) => a.id === o.agentId) ? identityFor(o.agentId, catalog.agents) : null;
  return (
    <article className={`os-card${on ? " on" : ""}${o.category === "errors" ? " is-error" : ""}${o.latest ? "" : " is-old"}`} data-node={o.nodeId} data-output={o.id}>
      <button className="os-card-head" onClick={() => onSelect(o.nodeId)} aria-pressed={on} title="Show this step on the canvas">
        <span className="os-card-title">{redact(o.title)}</span>
        <span className="os-card-sub">
          {identity ? (
            <>
              <AgentAvatar identity={identity} size={18} /> {identity.name} <AiAgentLabel /> · {step}
            </>
          ) : (
            <>
              {agent} · {step}
            </>
          )}
        </span>
      </button>
      <div className="os-badges">
        <span className={`os-badge v-${VTONE[o.verificationStatus]}`}>{VERIFICATION_LABEL[o.verificationStatus]}</span>
        {o.state !== "complete" && <span className={`os-badge s-${o.state}`}>{STATE_LABEL[o.state]}</span>}
        <span className="os-badge">{TYPE_LABEL[o.type]}</span>
        {!o.latest && <span className="os-badge">Earlier attempt</span>}
      </div>
      {o.summary && <p className="os-summary">{redact(o.summary)}</p>}
      <div className="os-preview">{open ? <OutputBody o={o} /> : <OutputBody o={o} compact />}</div>
      {open && <Meta o={o} step={step} agent={agent} />}
      <div className="os-card-actions">
        <button className="text-btn small" onClick={() => onToggle(o.id)} aria-expanded={open}>
          {open ? "Less" : "Details"}
        </button>
        {onOpenTask && !o.taskId.startsWith("none:") && (
          <button className="text-btn small" onClick={() => onOpenTask(o.taskId)}>
            Open task
          </button>
        )}
      </div>
    </article>
  );
});

function Meta({ o, step, agent }: { o: AgentOutput; step: string; agent: string }) {
  const i = o.intel;
  const sources = (o.sourceRefs ?? []).slice(0, 20);
  return (
    <dl className="os-facts">
      <div>
        <dt>From</dt>
        <dd>
          {agent} <span className="muted">({o.agentId})</span> · {step}
          {(() => {
            const idn = o.agentId && catalog.agents.some((a) => a.id === o.agentId) ? identityFor(o.agentId, catalog.agents) : null;
            return idn && idn.kind !== "none" ? <div className="muted small">{idn.name}, {idn.role}{idn.via ? `, via ${idn.via}` : ""} (AI agent)</div> : null;
          })()}
        </dd>
      </div>
      <div>
        <dt>Record</dt>
        <dd>
          {o.mode === "simulation" ? "Simulation sample" : `Task ${o.taskId}`}
          {o.attempt !== null && ` · attempt ${o.attempt}`} · {o.mode === "simulation" ? "no real time" : formatDateTime(o.createdAt)}
        </dd>
      </div>
      {sources.length > 0 && (
        <div>
          <dt>Sources</dt>
          <dd>
            {sources.map((s) => (
              <div key={s} className="os-src">
                {safeUrl(s) ? new URL(s).host + new URL(s).pathname.slice(0, 40) : redact(s)}
              </div>
            ))}
          </dd>
        </div>
      )}
      {i?.model && (
        <div>
          <dt>Model</dt>
          <dd>
            {i.model}
            {i.tier !== undefined && ` · tier ${i.tier}`}
          </dd>
        </div>
      )}
      {(i?.tokens !== undefined || i?.estimatedUsd !== undefined || i?.billedUsd !== undefined) && (
        <div>
          <dt>Usage</dt>
          <dd>
            {i?.tokens !== undefined && `${i.tokens.toLocaleString()} tokens`}
            {i?.estimatedUsd !== undefined && ` · $${i.estimatedUsd.toFixed(3)} estimated`}
            {i?.billedUsd !== undefined && ` · $${i.billedUsd.toFixed(3)} billed`}
          </dd>
        </div>
      )}
      {i?.score !== undefined && (
        <div>
          <dt>Evaluation</dt>
          <dd>
            {i.score === null ? "Not measurable yet" : `${i.score} of 100`}
            {i.flags?.length ? ` · ${i.flags.join("; ")}` : ""}
          </dd>
        </div>
      )}
      {i?.feedback && (
        <div>
          <dt>Feedback</dt>
          <dd>
            {i.feedback.rating}/5 from {i.feedback.by}
            {i.feedback.note && `: ${redact(i.feedback.note)}`}
          </dd>
        </div>
      )}
      {i?.memory?.length ? (
        <div>
          <dt>Memory used</dt>
          <dd>{i.memory.join(" · ")}</dd>
        </div>
      ) : null}
      {i?.tools?.length ? (
        <div>
          <dt>Tools</dt>
          <dd>{i.tools.join(" · ")}</dd>
        </div>
      ) : null}
      {!i && o.mode === "live" && (
        <div>
          <dt>Intelligence</dt>
          <dd className="muted">No model, usage or evaluation recorded for this step.</dd>
        </div>
      )}
    </dl>
  );
}

function Lines({ items, titleOf, onSelect, empty }: { items: ReportLine[]; titleOf: ReadonlyMap<string, string>; onSelect: (id: string) => void; empty: string }) {
  if (!items.length) return <p className="muted small">{empty}</p>;
  return (
    <ul className="os-rep-list">
      {items.map((l, k) => (
        <li key={k}>
          <span className={`os-badge v-${VTONE[l.verification]}`}>{VERIFICATION_LABEL[l.verification]}</span> {redact(l.text)}{" "}
          <button className="text-btn small" onClick={() => onSelect(l.nodeId)}>
            {titleOf.get(l.nodeId)}
          </button>
        </li>
      ))}
    </ul>
  );
}

function ReportView({ r, titleOf, onSelect }: { r: WorkflowReport; titleOf: ReadonlyMap<string, string>; onSelect: (id: string) => void }) {
  const L = (items: ReportLine[], empty: string) => <Lines items={items} titleOf={titleOf} onSelect={onSelect} empty={empty} />;
  return (
    <div className="os-report">
      <p className="muted small">
        Assembled from the outputs above, without a model. {r.counts.verified} verified · {r.counts.unverified} unverified · {r.counts.simulated} simulated.
        {r.mode === "simulation" && " Every line is a simulated sample."}
      </p>
      <div className="os-rep-grid">
        <section>
          <h3>Business goal</h3>
          <p>
            <b>{r.goal}</b>
          </p>
          <p className="muted small">{r.objective}</p>
          <h3>Participating agents</h3>
          <p className="small">{r.agents.map((a) => a.name).join(" · ")}</p>
          <h3>Completed stages</h3>
          <p className="small">{r.completedStages.length ? r.completedStages.map((s) => `Stage ${s}`).join(" · ") : "None yet."}</p>
        </section>
        <section>
          <h3>Key findings</h3>
          {L(r.findings, "No findings yet.")}
          <h3>Product recommendation</h3>
          {L(r.recommendation, "No recommendation yet.")}
        </section>
        <section>
          <h3>Decisions and approvals</h3>
          {L(r.decisions, "No decisions recorded yet.")}
          <h3>Final deliverables</h3>
          {L(r.deliverables, "No deliverables yet.")}
        </section>
        <section>
          <h3>Evidence references</h3>
          {r.evidence.length ? (
            <ul className="os-rep-list">
              {r.evidence.map((e) => (
                <li key={e.ref}>
                  <span className={`os-badge v-${VTONE[e.verification]}`}>{VERIFICATION_LABEL[e.verification]}</span> {safeUrl(e.ref) ? new URL(e.ref).host : redact(e.ref)} · {titleOf.get(e.nodeId)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">No evidence links recorded.</p>
          )}
          <h3>Failures and limitations</h3>
          {L(r.failures, "None.")}
          <h3>Next actions</h3>
          {r.nextActions.length ? (
            <ul className="os-rep-list">
              {r.nextActions.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          ) : (
            <p className="muted small">Nothing left to do.</p>
          )}
        </section>
      </div>
    </div>
  );
}
