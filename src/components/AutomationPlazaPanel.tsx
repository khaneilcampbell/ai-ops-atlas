import { useEffect, useState } from "react";
import { useAtlas } from "../state";
import { focusTasks } from "../tasks/focus";
import { ITEM_STATUS_LABEL, plazaSummary, type ItemStatus, type PlazaItem } from "../plaza/plazaState";
import { setPlazaPreview, usePlazaSnapshot } from "../plaza/usePlaza";
import { ExternalLink } from "./bits";

/** A shape for each status, so it reads without colour. */
const MARK: Record<ItemStatus, string> = { running: "●", waiting: "◐", queued: "○", blocked: "◇", awaiting_approval: "◆", failed: "!" };

/** "4 min", "1 h 12 min": time since a run started, from the source's own start time. */
export function elapsed(startedAt: string | undefined, now: number): string | null {
  if (!startedAt) return null;
  const ms = now - Date.parse(startedAt);
  if (!Number.isFinite(ms) || ms < 0) return null;
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "under a minute";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return `${h} h${min % 60 ? ` ${min % 60} min` : ""}`;
}

/** Initials stand in for agent portraits until the agent identities are approved and added. */
function Avatar({ name }: { name?: string }) {
  const initials = (name ?? "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return (
    <span className="plaza-avatar" aria-hidden="true" title="Portrait not added yet">
      {initials || "?"}
    </span>
  );
}

function Item({ it, now }: { it: PlazaItem; now: number }) {
  const { setView, select } = useAtlas();
  const time = elapsed(it.startedAt, now);
  const openTask = (id: string) => {
    focusTasks({ query: id });
    select(null);
    setView("tasks");
  };
  return (
    <li className={`plaza-item s-${it.status}`}>
      <Avatar name={it.agentName} />
      <div className="grow">
        <div className="plaza-item-head">
          <span className="plaza-item-title">{it.title}</span>
          <span className={`plaza-status s-${it.status}`}>
            <span aria-hidden="true">{MARK[it.status]}</span> {ITEM_STATUS_LABEL[it.status]}
          </span>
        </div>
        <div className="muted small">
          {it.agentName ? (
            it.agentId ? (
              <button className="text-btn small" onClick={() => select({ kind: "agent", id: it.agentId! })}>
                {it.agentName}
              </button>
            ) : (
              it.agentName
            )
          ) : (
            "No agent named"
          )}
          {it.buildingName ? ` · ${it.buildingName}` : ""}
        </div>
        <dl className="plaza-facts">
          {it.step && (
            <>
              <dt>Step</dt>
              <dd>{it.step}</dd>
            </>
          )}
          {time && (
            <>
              <dt>{it.status === "running" || it.status === "waiting" ? "Running for" : "Started"}</dt>
              <dd>{time}{it.status === "running" || it.status === "waiting" ? "" : " ago"}</dd>
            </>
          )}
        </dl>
        <p className="plaza-detail">{it.detail}</p>
        {it.links.length > 0 && (
          <div className="plaza-links">
            {it.links.map((l) =>
              l.taskId ? (
                <button key={l.label + l.taskId} className="text-btn small" onClick={() => openTask(l.taskId!)}>
                  {l.label} →
                </button>
              ) : l.url ? (
                <ExternalLink key={l.url} href={l.url} className="text-btn small">
                  {l.label} ↗
                </ExternalLink>
              ) : null,
            )}
          </div>
        )}
      </div>
    </li>
  );
}

function Section({ title, items, empty, now }: { title: string; items: PlazaItem[]; empty: string; now: number }) {
  return (
    <section>
      <div className="section-title">
        {title} <span className="muted">({items.length})</span>
      </div>
      {items.length ? (
        <ul className="plaza-list">
          {items.map((it) => (
            <Item key={it.id} it={it} now={now} />
          ))}
        </ul>
      ) : (
        <p className="muted small">{empty}</p>
      )}
    </section>
  );
}

/** What to connect when no source answers: the exact integrations that feed the plaza. */
function Unavailable() {
  return (
    <div className="plaza-notice" role="status">
      <strong>Status unavailable.</strong> No automation source has current data, so the plaza shows nothing running rather than a guess.
      <p className="small">
        To connect: agent runs come from GitHub sync and the agent feed (<code>/api/hooks/agents</code>, docs/live-telemetry.md); n8n runs need the
        site's <code>N8N_API_KEY</code> secret (hosted site) or Website sync (Mac app).
      </p>
    </div>
  );
}

/**
 * The plaza's panel: active workflows, who runs them, their step and elapsed time when the source
 * supplies them, what needs attention, and links to the Task Center or the execution. It is also
 * the plaza's full text equivalent, reachable from the map's nameplate and the keyboard button.
 */
export function AutomationPlazaPanel() {
  const s = usePlazaSnapshot();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="plaza-panel">
      <p className="plaza-summary" aria-live="polite">
        {plazaSummary(s)}
      </p>
      <div className="building-task-counts">
        <span className={`chip${s.running.length ? " chip-good" : ""}`}>{s.running.length} running</span>
        <span className="chip">{s.queued.length} queued</span>
        <span className={`chip${s.attention.length ? " chip-warn" : ""}`}>{s.attention.length} need{s.attention.length === 1 ? "s" : ""} attention</span>
      </div>
      {s.preview ? (
        <div className="plaza-notice preview" role="status">
          <strong>Sample preview · not live data.</strong> These examples show how the plaza moves. Nothing here is a real run.{" "}
          <button className="text-btn small" onClick={() => setPlazaPreview(false)}>
            Back to live data
          </button>
        </div>
      ) : s.connection === "unavailable" ? (
        <Unavailable />
      ) : null}
      <Section title="Needs attention" items={s.attention} empty="Nothing needs attention." now={now} />
      <Section title="Active workflows" items={s.running} empty={s.connection === "live" ? "Idle. Nothing is running right now." : "Nothing can be shown while status is unavailable."} now={now} />
      <Section title="Queued" items={s.queued} empty="Nothing queued." now={now} />
      <section>
        <div className="section-title">Sources</div>
        <dl className="kv">
          {s.sources.map((src) => (
            <div key={src.id} style={{ display: "contents" }}>
              <dt>{src.label}</dt>
              <dd>
                {src.state === "live" ? "Connected" : src.state === "stale" ? "Stale" : "Not connected"} · {src.note}
              </dd>
            </div>
          ))}
        </dl>
        {!s.preview && (
          <button className="text-btn small" onClick={() => setPlazaPreview(true)}>
            Show a sample preview
          </button>
        )}
      </section>
    </div>
  );
}
