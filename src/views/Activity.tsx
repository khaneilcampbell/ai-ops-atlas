import { useMemo, useState } from "react";
import { Icon, type IconName } from "../components/Icon";
import { ExternalLink } from "../components/bits";
import { filterEvents, workspaceEvents, type AtlasEvent, type EventKind, type EventResult } from "../lib/activity";
import { load, save } from "../lib/storage";
import { relative } from "../lib/time";
import { useAtlas } from "../state";

const KINDS: { kind: EventKind; label: string; icon: IconName }[] = [
  { kind: "commit", label: "Commits", icon: "commit" },
  { kind: "ci", label: "CI runs", icon: "play" },
  { kind: "agent", label: "Agent runs", icon: "agents" },
  { kind: "manifest", label: "Manifest history", icon: "tag" },
];
const RANGES: { label: string; ms: number | null }[] = [
  { label: "24 hours", ms: 86_400_000 },
  { label: "7 days", ms: 7 * 86_400_000 },
  { label: "30 days", ms: 30 * 86_400_000 },
  { label: "All time", ms: null },
];
const RESULT_LABEL: Record<EventResult, string> = { success: "Succeeded", failure: "Failed", running: "Running", other: "Other" };
const PAGE = 80;

function dayHeading(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yest.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

/** One timeline of everything Atlas has read: commits, CI results and agent runs, with filters. */
export function ActivityView() {
  const { catalog, repos, uncataloged, select } = useAtlas();
  const [kinds, setKinds] = useState<EventKind[]>([]);
  const [project, setProject] = useState("");
  const [result, setResult] = useState<"" | EventResult>("");
  const [range, setRangeState] = useState<number>(() => load<number>("activityRange", 1));
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE);
  const setRange = (i: number) => {
    setRangeState(i);
    save("activityRange", i);
  };

  const all = useMemo(() => workspaceEvents(catalog, repos, uncataloged), [catalog, repos, uncataloged]);
  const events = useMemo(() => filterEvents(all, { kinds, project, result, sinceMs: RANGES[range]?.ms ?? null, query }), [all, kinds, project, result, range, query]);
  const counts = useMemo(() => {
    const c: Record<EventKind, number> = { commit: 0, ci: 0, agent: 0, manifest: 0 };
    for (const e of filterEvents(all, { kinds: [], project, result: "", sinceMs: RANGES[range]?.ms ?? null, query })) c[e.kind]++;
    return c;
  }, [all, project, range, query]);

  const groups = useMemo(() => {
    const out: { day: string; items: AtlasEvent[] }[] = [];
    for (const e of events.slice(0, shown)) {
      const day = dayHeading(e.at);
      if (out[out.length - 1]?.day !== day) out.push({ day, items: [] });
      out[out.length - 1].items.push(e);
    }
    return out;
  }, [events, shown]);

  const toggleKind = (k: EventKind) => setKinds((ks) => (ks.includes(k) ? ks.filter((x) => x !== k) : [...ks, k]));
  const anyFilter = kinds.length || project || result || query;

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <div className="eyebrow">Activity Center</div>
          <h1>What happened, and when.</h1>
          <p className="lede">Commits and CI results read from GitHub, runs of the workflows your agents report through, and history written in manifests.</p>
        </div>
      </div>

      <div className="filters" role="search">
        <label className="field">
          <Icon name="search" size={14} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search events" aria-label="Search events" />
        </label>
        <label className="field">
          <span>Project</span>
          <select value={project} onChange={(e) => setProject(e.target.value)}>
            <option value="">All</option>
            {catalog.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Result</span>
          <select value={result} onChange={(e) => setResult(e.target.value as "" | EventResult)}>
            <option value="">Any</option>
            {(Object.keys(RESULT_LABEL) as EventResult[]).map((r) => (
              <option key={r} value={r}>
                {RESULT_LABEL[r]}
              </option>
            ))}
          </select>
        </label>
        <div className="seg-ctl" role="group" aria-label="Time range">
          {RANGES.map((r, i) => (
            <button key={r.label} className={range === i ? "on" : ""} aria-pressed={range === i} onClick={() => setRange(i)}>
              {r.label}
            </button>
          ))}
        </div>
        {anyFilter ? (
          <button
            className="text-btn"
            onClick={() => {
              setKinds([]);
              setProject("");
              setResult("");
              setQuery("");
            }}
          >
            Clear filters
          </button>
        ) : null}
        <span className="count">{events.length} events</span>
      </div>

      <div className="kind-chips" role="group" aria-label="Event types">
        {KINDS.map((k) => (
          <button key={k.kind} className={`chip kind-chip ${kinds.includes(k.kind) ? "on" : ""}`} aria-pressed={kinds.includes(k.kind)} onClick={() => toggleKind(k.kind)}>
            <Icon name={k.icon} size={12} /> {k.label} <span className="muted">{counts[k.kind]}</span>
          </button>
        ))}
      </div>

      <div className="card feed">
        {events.length === 0 ? (
          <div className="empty">
            {all.length === 0 ? "Nothing loaded yet. Refresh to read activity from GitHub." : "No events match these filters. Try a longer time range."}
          </div>
        ) : (
          groups.map((g) => (
            <section key={g.day} aria-label={g.day}>
              <h3 className="feed-day">{g.day}</h3>
              <ul className="feed-list">
                {g.items.map((e) => (
                  <li key={e.id} className={`feed-row k-${e.kind}`}>
                    <time dateTime={e.at} title={new Date(e.at).toLocaleString()}>
                      {e.kind === "manifest" ? "" : new Date(e.at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                    </time>
                    <span className={`feed-icon ${e.result ?? ""}`} aria-hidden>
                      <Icon name={KINDS.find((k) => k.kind === e.kind)!.icon} size={12} />
                    </span>
                    <span className="grow">
                      <span className="title">{e.url ? <ExternalLink href={e.url}>{e.title}</ExternalLink> : e.title}</span>
                      <span className="meta">
                        <button className="text-btn inline" onClick={() => select(e.agentId ? { kind: "agent", id: e.agentId } : e.repo ? { kind: "repo", id: e.repo } : null)}>
                          {e.detail}
                        </button>
                      </span>
                    </span>
                    {e.result && <span className={`result r-${e.result}`}>{RESULT_LABEL[e.result]}</span>}
                    <span className="muted small nowrap">{relative(e.at)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
        {events.length > shown && (
          <div className="feed-more">
            <button className="btn" onClick={() => setShown((n) => n + PAGE)}>
              Show {Math.min(PAGE, events.length - shown)} more
            </button>
          </div>
        )}
      </div>
      <p className="muted small" style={{ marginTop: 12 }}>
        GitHub keeps the latest 10 commits and 10 default-branch runs per repository in Atlas. Live run logs from n8n and CrewAI arrive with their adapters.
      </p>
    </div>
  );
}
