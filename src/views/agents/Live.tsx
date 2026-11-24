import { useEffect, useMemo, useRef, useState } from "react";
import type { Agent } from "../../catalog/types";
import { AgentAvatar } from "../../components/AgentIdentity";
import { n8nUrl, recentRuns, runtimeFamily, shortTitle } from "../../automations/board";
import { lastError, liveCounts, liveState, sortLive, statusLabel, todayRuns, type LiveSort, type LiveState } from "../../automations/live";
import { identityFor } from "../../registry/identity";
import type { RegistryEntry } from "../../registry/registry";
import { relative, formatDate } from "../../lib/time";
import { formatTime, useTimeZone, zoneAbbreviation } from "../../lib/timezone";
import "../../styles/board.css";

const RING: { s: LiveState; label: string }[] = [
  { s: "verified", label: "Verified running" },
  { s: "draft", label: "Drafts" },
  { s: "unverified", label: "No verified run yet" },
  { s: "failing", label: "Latest run failed" },
];

/** Live: today's runs on a timeline, every automation in a table with trouble first, and one open in a drawer. */
export function Live({ entries, agents, open }: { entries: RegistryEntry[]; agents: readonly Agent[]; open: (id: string) => void }) {
  const tz = useTimeZone();
  const [query, setQuery] = useState("");
  const [owner, setOwner] = useState("");
  const [runtime, setRuntime] = useState("");
  const [state, setState] = useState("");
  const [sort, setSort] = useState<LiveSort>("attention");
  const [picked, setPicked] = useState<string | null>(null);
  const ownerOf = useMemo(() => new Map(entries.map((e) => [e.profile.id, identityFor(e.profile.id, agents)])), [entries, agents]);
  const counts = useMemo(() => liveCounts(entries), [entries]);
  const timeline = useMemo(() => todayRuns(entries, tz), [entries, tz]);
  const loaded = entries.some((e) => e.telemetry.source && e.telemetry.loaded);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sortLive(
      entries.filter(
        (e) =>
          (!q || `${e.profile.title} ${e.profile.execution.trigger ?? ""} ${ownerOf.get(e.profile.id)?.name ?? ""}`.toLowerCase().includes(q)) &&
          (!owner || ownerOf.get(e.profile.id)?.name === owner) &&
          (!runtime || runtimeFamily(e) === runtime) &&
          (!state || liveState(e) === state),
      ),
      sort,
    );
  }, [entries, query, owner, runtime, state, sort, ownerOf]);
  const current = rows.find((e) => e.profile.id === picked) ?? rows[0];
  // On narrow screens the drawer sits under the table, so bring it into view when a row is picked.
  const drawer = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (picked && window.innerWidth <= 1180) drawer.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [picked]);
  const owners = [...new Set([...ownerOf.values()].map((i) => i.name))].sort();
  const runtimes = [...new Set(entries.map(runtimeFamily))].sort();
  const nowHour = (() => {
    const [h, m] = formatTime(Date.now(), { hour: "numeric", minute: "numeric", hourCycle: "h23" }).split(":").map(Number);
    return h + m / 60;
  })();
  let offset = 25;

  return (
    <div className="live-tab">
      <div className="live-top">
        <div className="card live-ring">
          <svg width="96" height="96" viewBox="0 0 36 36" role="img" aria-label={RING.map((r) => `${counts[r.s]} ${r.label}`).join(", ")}>
            <circle cx="18" cy="18" r="15.9" className="ring-bg" />
            {RING.map(({ s }) => {
              const pct = (counts[s] / Math.max(1, entries.length)) * 100;
              const el = <circle key={s} cx="18" cy="18" r="15.9" className={`ring-${s}`} strokeDasharray={`${pct} ${100 - pct}`} strokeDashoffset={offset} />;
              offset -= pct;
              return el;
            })}
          </svg>
          <div className="live-legend">
            <div className="num">{entries.length}</div>
            {RING.map(({ s, label }) => (
              <div key={s}>
                <i className={`op-dot dot-${s === "draft" ? "draft" : s === "verified" ? "verified" : s === "failing" ? "failing" : "unknown"}`} /> {label} <b>{counts[s]}</b>
              </div>
            ))}
          </div>
        </div>

        <div className="card live-timeline">
          <div className="live-timeline-head">
            <h2>Today’s runs</h2>
            <span className="muted small">Times in {zoneAbbreviation()} · ■ succeeded · <span className="bad-text">■</span> failed</span>
          </div>
          {timeline.length === 0 ? (
            <p className="muted small">{loaded ? "No runs yet today." : "Live runs aren’t loaded yet, so there is nothing to draw."}</p>
          ) : (
            <div className="tl">
              <div className="tl-axis" aria-hidden>
                {[0, 3, 6, 9, 12, 15, 18, 21].map((h) => (
                  <span key={h} style={{ left: `${(h / 24) * 100}%` }}>{h % 12 || 12}{h < 12 ? "a" : "p"}</span>
                ))}
              </div>
              {timeline.map((r) => (
                <div key={r.entry.profile.id} className="tl-row">
                  <button className="tl-name text-btn" onClick={() => setPicked(r.entry.profile.id)}>
                    <i className="op-dot" style={{ background: ownerOf.get(r.entry.profile.id)?.accent }} aria-hidden />
                    {shortTitle(r.entry.profile.title)}
                  </button>
                  <div className="tl-track">
                    {r.runs.map((x) => (
                      <i key={x.at} className={x.result === "failure" ? "bad" : ""} style={{ left: `${(x.hour / 24) * 100}%`, background: x.result === "failure" ? undefined : ownerOf.get(r.entry.profile.id)?.accent }} title={`${formatTime(x.at, { hour: "numeric", minute: "2-digit" })} · ${x.result}`} />
                    ))}
                    <b className="tl-now" style={{ left: `${(nowHour / 24) * 100}%` }} aria-hidden />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="live-lower">
        <div className="card live-table">
          <div className="live-filters" role="search">
            <label className="field grow">
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search automations, owners, triggers" aria-label="Search automations" />
            </label>
            <Pick label="Owner" value={owner} set={setOwner} options={owners} />
            <Pick label="Runtime" value={runtime} set={setRuntime} options={runtimes} />
            <Pick label="Status" value={state} set={setState} options={RING.map((r) => r.s)} labels={Object.fromEntries(RING.map((r) => [r.s, r.label]))} />
            <label className="field">
              <span>Sort</span>
              <select value={sort} onChange={(e) => setSort(e.target.value as LiveSort)}>
                <option value="attention">Needs attention</option>
                <option value="recent">Last run</option>
                <option value="name">Name</option>
              </select>
            </label>
          </div>
          <table>
            <thead>
              <tr><th>Automation</th><th>Owner</th><th>Runtime</th><th>Trigger</th><th>Status</th><th>Last run</th></tr>
            </thead>
            <tbody>
              {rows.map((e) => {
                const id = ownerOf.get(e.profile.id)!;
                const s = liveState(e);
                return (
                  <tr key={e.profile.id} className={e === current ? "on" : ""} onClick={() => setPicked(e.profile.id)}>
                    <td><button className="text-btn" aria-pressed={e === current}>{shortTitle(e.profile.title)}</button></td>
                    <td><span className="live-owner"><AgentAvatar identity={id} size={20} />{id.name}</span></td>
                    <td><span className="rt">{runtimeFamily(e)}</span></td>
                    <td className="muted">{e.profile.execution.trigger ?? "Not documented"}</td>
                    <td><span className={`lv-pill lp-${s}`}><i className={`op-dot dot-${s === "unverified" ? "unknown" : s}`} />{statusLabel(e)}</span></td>
                    <td title={e.telemetry.lastAnyRun ? formatDate(e.telemetry.lastAnyRun.at) : undefined}>{e.telemetry.lastAnyRun ? relative(e.telemetry.lastAnyRun.at) : "Never seen"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="muted small live-foot">{rows.length} of {entries.length} automations</div>
        </div>
        <div ref={drawer}>{current && <Drawer e={current} agents={agents} open={open} />}</div>
      </div>
    </div>
  );
}

function Drawer({ e, agents, open }: { e: RegistryEntry; agents: readonly Agent[]; open: (id: string) => void }) {
  const id = identityFor(e.profile.id, agents);
  const runs = recentRuns(e, 30).reverse();
  const err = lastError(e);
  const n8n = n8nUrl(agents.find((a) => a.id === e.profile.id));
  const s = liveState(e);
  return (
    <aside className="card live-drawer" aria-label={`${e.profile.title} details`}>
      <div className="eyebrow">{id.name} · {id.role}</div>
      <h2>{shortTitle(e.profile.title)}</h2>
      <div className="lv-pills">
        <span className={`lv-pill lp-${s}`}><i className={`op-dot dot-${s === "unverified" ? "unknown" : s}`} />{statusLabel(e)}</span>
        <span className="lv-pill">{runtimeFamily(e)}</span>
      </div>
      {err && (
        <div className="live-error">
          <b>Latest run failed</b>
          <span className="muted small">{err}</span>
        </div>
      )}
      <div className="eyebrow">Last {runs.length || ""} runs</div>
      {runs.length ? (
        <div className="live-hist" aria-label={`${runs.filter((r) => r.result === "failure").length} of ${runs.length} failed`}>
          {runs.map((r, i) => <i key={i} className={r.result === "failure" ? "bad" : ""} title={`${formatDate(r.at)} · ${r.result}`} />)}
        </div>
      ) : (
        <p className="muted small">No runs loaded for this automation.</p>
      )}
      <dl className="live-kv">
        <div><dt>Trigger</dt><dd>{e.profile.execution.trigger ?? "Not documented"}</dd></div>
        <div><dt>Last run</dt><dd>{e.telemetry.lastAnyRun ? relative(e.telemetry.lastAnyRun.at) : "Never seen"}</dd></div>
        <div><dt>Cost cap</dt><dd>{e.profile.governance.caps ?? e.profile.cost.budget ?? "Not documented"}</dd></div>
        <div><dt>Risk</dt><dd>{e.profile.governance.risk ?? "Not documented"}</dd></div>
      </dl>
      <div className="live-actions">
        {n8n && <a className="btn primary" href={n8n} target="_blank" rel="noreferrer">Open in n8n</a>}
        {e.telemetry.lastAnyRun?.url && <a className="btn" href={e.telemetry.lastAnyRun.url} target="_blank" rel="noreferrer">Open last run</a>}
        <button className="btn" onClick={() => open(e.profile.id)}>Full details</button>
      </div>
    </aside>
  );
}

function Pick({ label, value, set, options, labels }: { label: string; value: string; set: (v: string) => void; options: string[]; labels?: Record<string, string> }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(e) => set(e.target.value)}>
        <option value="">All</option>
        {options.map((o) => <option key={o} value={o}>{labels?.[o] ?? o}</option>)}
      </select>
    </label>
  );
}
