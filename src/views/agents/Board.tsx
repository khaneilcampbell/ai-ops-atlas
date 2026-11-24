import { useMemo, useState } from "react";
import type { Agent } from "../../catalog/types";
import type { Ownership } from "../../catalog/ownership";
import { AgentAvatar } from "../../components/AgentIdentity";
import { boardKpis, buildLanes, chipMatches, isDraft, n8nUrl, recentRuns, runtimeFamily, shortTitle, type Chip, type Lane } from "../../automations/board";
import { identityFor } from "../../registry/identity";
import { runtimeOf, type RegistryEntry } from "../../registry/registry";
import { relative, formatDate } from "../../lib/time";
import { useAtlas } from "../../state";
import "../../styles/board.css";

const OPEN_LANES = 4;

/** Automations Board: every automation under the agent who runs it, and what needs Khaneil first. */
export function Board({ entries, agents, owns, open }: { entries: RegistryEntry[]; agents: readonly Agent[]; owns: Ownership; open: (id: string) => void }) {
  const { setView, select } = useAtlas();
  const [chip, setChip] = useState<Chip>("all");
  const [expanded, setExpanded] = useState<string[]>([]);
  const byId = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  const kpis = useMemo(() => boardKpis(entries), [entries]);
  const lanes = useMemo(() => buildLanes(entries.filter((e) => chipMatches(chip, e)), owns), [entries, owns, chip]);
  const runtimes = useMemo(() => [...new Set(entries.map(runtimeFamily))].sort(), [entries]);
  const failing = entries.filter((e) => e.operational === "failing");
  const drafts = entries.filter(isDraft);
  const openDesk = (id: string) => {
    select({ kind: "agent", id });
    setView("agents");
  };
  const count = (c: Chip) => entries.filter((e) => chipMatches(c, e)).length;
  const chips: { id: Chip; label: string }[] = [
    { id: "all", label: "All" },
    { id: "attention", label: `Needs attention · ${count("attention")}` },
    { id: "drafts", label: `Drafts · ${count("drafts")}` },
    { id: "manual", label: `Manual · ${count("manual")}` },
    ...runtimes.map((r) => ({ id: `runtime:${r}` as Chip, label: r })),
  ];

  return (
    <div className="board">
      <div className="board-kpis">
        <Kpi label="Automations" value={kpis.total} sub={`${owns.owned.size} owning agents, ${owns.orphans.length} with no owner`} />
        <Kpi label="Verified running" value={kpis.verified} sub="Seen running in live data" />
        <Kpi label="Drafts to publish" value={kpis.drafts} sub="Paused until published in n8n" />
        <Kpi label="Failed, last 24h" value={kpis.failed24h} sub={failing[0] ? shortTitle(failing[0].profile.title) : "From loaded runs"} bad={!!kpis.failed24h} />
        <Kpi label="Runs, last 24h" value={kpis.runs24h} sub="From loaded runs" />
      </div>

      <div className="board-chips" role="group" aria-label="Filter automations">
        {chips.map((c) => (
          <button key={c.id} className={chip === c.id ? "on" : ""} aria-pressed={chip === c.id} onClick={() => setChip(c.id)}>
            {c.label}
          </button>
        ))}
      </div>

      <div className="board-grid">
        <div className="board-lanes">
          {lanes.length === 0 && <div className="card empty">No automations match this filter.</div>}
          {lanes.map((l, i) =>
            i < OPEN_LANES || expanded.includes(l.ownerId) ? (
              <LaneCard key={l.ownerId} lane={l} agents={agents} open={open} openDesk={openDesk} />
            ) : (
              <button key={l.ownerId} className="card board-row" onClick={() => setExpanded((x) => [...x, l.ownerId])}>
                <Owner lane={l} agents={agents} size={26} />
                <span className="muted small">{laneCounts(l)}</span>
              </button>
            ),
          )}
        </div>

        <aside className="card board-needs" aria-label="Needs you">
          <div className="board-needs-head">
            <h2>Needs you</h2>
            <span className="count-pill">{failing.length + drafts.length}</span>
          </div>
          {failing.length + drafts.length === 0 && <p className="muted small">Nothing is failing and no drafts are waiting.</p>}
          {failing.map((e) => (
            <Need key={e.profile.id} tone="bad" title={`${shortTitle(e.profile.title)} failed`} detail={e.telemetry.lastAnyRun ? `Last run ${relative(e.telemetry.lastAnyRun.at)}` : "Latest run failed"} url={e.telemetry.lastAnyRun?.url ?? n8nUrl(byId.get(e.profile.id))} action="Open run" onOpen={() => open(e.profile.id)} />
          ))}
          {drafts.map((e) => (
            <Need key={e.profile.id} tone="warn" title={`Publish ${shortTitle(e.profile.title)}`} detail={`Draft in n8n · ${identityFor(e.profile.id, agents).name}`} url={n8nUrl(byId.get(e.profile.id))} action="Open in n8n" onOpen={() => open(e.profile.id)} />
          ))}
        </aside>
      </div>
    </div>
  );
}

const laneCounts = (l: Lane) => [`${l.automations.length} automation${l.automations.length === 1 ? "" : "s"}`, `${l.live} live`, l.drafts && `${l.drafts} draft${l.drafts === 1 ? "" : "s"}`, l.manual && `${l.manual} manual`, l.failing && `${l.failing} failing`].filter(Boolean).join(" · ");

function Owner({ lane, agents, size }: { lane: Lane; agents: readonly Agent[]; size: number }) {
  if (!lane.ownerId) return <span className="board-owner"><b>No owning agent</b></span>;
  const id = identityFor(lane.ownerId, agents);
  const owner = agents.find((a) => a.id === lane.ownerId);
  return (
    <span className="board-owner">
      <AgentAvatar identity={id} size={size} />
      <span>
        <b>{id.name}</b>
        <span className="muted small">{owner?.name ?? id.role}</span>
      </span>
    </span>
  );
}

function LaneCard({ lane, agents, open, openDesk }: { lane: Lane; agents: readonly Agent[]; open: (id: string) => void; openDesk: (id: string) => void }) {
  const n = lane.automations.length;
  return (
    <section className="card board-lane" aria-label={lane.ownerId ? `Automations run by ${identityFor(lane.ownerId, agents).name}` : "Automations with no owning agent"}>
      <header>
        <Owner lane={lane} agents={agents} size={34} />
        <span className="board-lane-counts">
          <span className="muted small">{laneCounts(lane)}</span>
          <span className="board-health" aria-hidden>
            <i className="ok" style={{ flex: Math.max(0, lane.live - lane.failing) }} />
            <i className="bad" style={{ flex: lane.failing }} />
            <i className="warn" style={{ flex: Math.max(0, n - lane.live) }} />
          </span>
        </span>
        {lane.ownerId && <button className="btn" onClick={() => openDesk(lane.ownerId)}>Open desk</button>}
      </header>
      <div className="board-cards">
        {lane.automations.map((e) => (
          <AutoCard key={e.profile.id} e={e} onClick={() => open(e.profile.id)} />
        ))}
      </div>
    </section>
  );
}

function AutoCard({ e, onClick }: { e: RegistryEntry; onClick: () => void }) {
  const runs = recentRuns(e).reverse();
  const last = e.telemetry.lastAnyRun;
  const tone = isDraft(e) ? "draft" : e.operational;
  return (
    <button className={`board-card tone-${tone}`} onClick={onClick} title={e.profile.title}>
      <span className="board-card-title">
        <i className={`op-dot dot-${tone}`} aria-hidden />
        {shortTitle(e.profile.title)}
      </span>
      <span className="board-card-meta">
        <span className="rt" title={runtimeOf(e)}>{runtimeFamily(e)}</span>
        <span className="muted">{e.profile.execution.trigger ?? "Trigger not documented"}</span>
      </span>
      <span className="board-card-foot">
        <span className={`spark ${runs.length ? "" : "none"}`} aria-label={runs.length ? `${runs.length} recent runs` : "No runs loaded"}>
          {runs.map((r, i) => (
            <i key={i} className={r.result === "failure" ? "bad" : ""} />
          ))}
        </span>
        <span className="muted" title={last ? formatDate(last.at) : undefined}>
          {last ? relative(last.at) : isDraft(e) ? "Draft, not published" : "No verified run"}
        </span>
      </span>
    </button>
  );
}

function Kpi({ label, value, sub, bad }: { label: string; value: number | null; sub: string; bad?: boolean }) {
  return (
    <div className={`card board-kpi ${bad ? "bad" : ""}`}>
      <div className="eyebrow">{label}</div>
      <div className="num">{value ?? <span className="na">Not loaded yet</span>}</div>
      <div className="sub">{sub}</div>
    </div>
  );
}

function Need({ tone, title, detail, url, action, onOpen }: { tone: "bad" | "warn"; title: string; detail: string; url: string | null; action: string; onOpen: () => void }) {
  return (
    <div className={`board-need ${tone}`}>
      <i aria-hidden>{tone === "bad" ? "!" : "↑"}</i>
      <span>
        <button className="text-btn" onClick={onOpen}>{title}</button>
        <span className="muted small">{detail}</span>
        {url && (
          <a className="btn" href={url} target="_blank" rel="noreferrer">
            {action}
          </a>
        )}
      </span>
    </div>
  );
}
