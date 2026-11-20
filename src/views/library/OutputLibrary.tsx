import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import "../../styles/library.css";
import { useAtlas } from "../../state";
import { Icon } from "../../components/Icon";
import { AgentAvatar } from "../../components/AgentIdentity";
import { identityFor } from "../../registry/identity";
import { focusTasks } from "../../tasks/focus";
import { formatDateTime } from "../../lib/timezone";
import { relative } from "../../lib/time";
import { SafeMarkdown } from "../workflows/OutputRenderers";
import { canChangeLibrary, canOpenOnMac, closeLibrary, fetchOutput, fetchOutputs, fetchTextPreview, fileUrl, imageSource, libraryAvailability, openOnMac, reconcileReportsOnce, retryOutput, saveOnMac } from "../../library/client";
import { isTauri } from "../../lib/env";
import {
  APPROVAL_LABEL,
  FORMAT_LABEL,
  FORMATS,
  LIBRARY_BUILDING_NAME,
  parseDelimited,
  previewKind,
  safeFilename,
  sizeLabel,
  STORAGE_LABEL,
  type Approval,
  type ListPage,
  type OutputDetail,
  type OutputFormat,
  type OutputSummary,
  type OutputVersion,
  type StorageState,
} from "../../library/model";

// The Output Library drawer: every deliverable agents and workflows produced, kept in the site's
// database and private file storage (server/outputs.ts). It opens over the right side of the map
// (a bottom sheet on a phone) without moving the map, from the toolbar's Library button or the
// Knowledge & Research Center. Generated content is untrusted: text is drawn as React text, files
// are served inert by the site, and images/PDFs come only from the authorized same-origin route.

type StatusFilter = "" | `approval:${Approval}` | `storage:${StorageState}`;
const FORMAT_GLYPH: Record<OutputFormat, string> = { report: "RPT", text: "TXT", image: "IMG", pdf: "PDF", spreadsheet: "XLS", document: "DOC", data: "JSON", other: "FILE" };

function FormatIcon({ format }: { format: OutputFormat }) {
  return (
    <span className={`lib-format f-${format}`} aria-hidden>
      <svg viewBox="0 0 24 30" width="24" height="30">
        <path d="M2 2h13l7 7v19H2z" fill="currentColor" opacity="0.16" />
        <path d="M2 2h13l7 7v19H2zM15 2v7h7" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
      <b>{FORMAT_GLYPH[format]}</b>
    </span>
  );
}

function ApprovalPill({ approval }: { approval: Approval }) {
  return <span className={`lib-pill a-${approval}`}>{APPROVAL_LABEL[approval]}</span>;
}

function StorageBadge({ v }: { v: OutputVersion }) {
  if (v.storage === "saved" && v.verifiedAt) return <span className="lib-storage s-verified" title={`Read back and checksum matched ${formatDateTime(v.verifiedAt)}`}><Icon name="check" size={12} /> Retrieval verified</span>;
  if (v.storage === "saved") return <span className="lib-storage s-saved">Saved, not yet verified</span>;
  return <span className={`lib-storage s-${v.storage}`}><Icon name="alert" size={12} /> {STORAGE_LABEL[v.storage]}</span>;
}

export function OutputLibrary({ phone }: { phone: boolean }) {
  const { catalog, setView } = useAtlas();
  const availability = useMemo(libraryAvailability, []);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [format, setFormat] = useState<OutputFormat | "">("");
  const [agent, setAgent] = useState("");
  const [project, setProject] = useState("");
  const [status, setStatus] = useState<StatusFilter>("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ListPage | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const root = useRef<HTMLElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Typing settles for a moment before asking the site.
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => setPage(1), [query, format, agent, project, status]);

  const projectAgents = useMemo(() => (project ? catalog.agents.filter((a) => a.projectId === project).map((a) => a.id) : []), [catalog.agents, project]);
  useEffect(() => {
    if (!availability.ok) return;
    const ac = new AbortController();
    setState("loading");
    const [kind, value] = status ? status.split(":") : ["", ""];
    fetchOutputs({ q: query, format, agent, project, page, projectAgents, approval: kind === "approval" ? (value as Approval) : "", storage: kind === "storage" ? (value as StorageState) : "" }, ac.signal)
      .then((d) => {
        setData(d);
        setState("ready");
        setError(null);
      })
      .catch((e) => {
        if (ac.signal.aborted) return;
        setState("error");
        setError(e instanceof Error ? e.message : String(e));
      });
    return () => ac.abort();
  }, [availability.ok, query, format, agent, project, status, page, projectAgents, tick]);

  // Reports stored before the Library existed (or while storage was off) are archived automatically
  // the first time the Library opens with storage connected.
  const storageReady = !!data?.configured && !!data.storageConnected && data.environment !== "development";
  useEffect(() => {
    if (!storageReady) return;
    let live = true;
    void reconcileReportsOnce().then((r) => {
      if (live && r && r.created > 0) setTick((t) => t + 1);
    });
    return () => {
      live = false;
    };
  }, [storageReady]);

  // Focus lands in the drawer on open; Escape closes from anywhere inside it.
  useEffect(() => {
    search.current?.focus({ preventScroll: true });
  }, []);
  const onKeyDown = (e: ReactKeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      if (selected && phone) setSelected(null);
      else closeLibrary();
    }
  };
  const onListKey = (e: ReactKeyboardEvent<HTMLUListElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
    const items = [...(listRef.current?.querySelectorAll<HTMLButtonElement>("button.lib-item") ?? [])];
    if (!items.length) return;
    e.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : Math.max(0, Math.min(items.length - 1, at + (e.key === "ArrowDown" ? 1 : -1)));
    items[next].focus();
  };

  const agents = useMemo(() => {
    const ids = new Set([...(data?.facets.agents ?? []), ...(agent ? [agent] : [])]);
    return [...ids].map((id) => ({ id, name: identityFor(id, catalog.agents).name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [data?.facets.agents, agent, catalog.agents]);
  const projectName = useCallback((id: string | null) => (id ? (catalog.projects.find((p) => p.id === id)?.name ?? id) : null), [catalog.projects]);
  const projectOf = useCallback((v: OutputVersion) => v.project ?? catalog.agents.find((a) => a.id === v.agent)?.projectId ?? null, [catalog.agents]);
  const projects = useMemo(() => {
    const ids = new Set<string>(data?.facets.projects ?? []);
    for (const id of data?.facets.agents ?? []) {
      const p = catalog.agents.find((a) => a.id === id)?.projectId;
      if (p) ids.add(p);
    }
    if (project) ids.add(project);
    return [...ids].map((id) => ({ id, name: projectName(id)! })).sort((a, b) => a.name.localeCompare(b.name));
  }, [data?.facets, project, catalog.agents, projectName]);

  const total = data?.total ?? 0;
  const from = total ? (page - 1) * (data?.pageSize ?? 20) + 1 : 0;
  const to = Math.min(total, page * (data?.pageSize ?? 20));
  const filtered = !!(query || format || agent || project || status);
  const showDetail = !!selected;

  return (
    <aside
      ref={root}
      className={`lib-drawer ${phone ? "sheet" : ""} ${showDetail ? "has-detail" : ""}`}
      role="dialog"
      aria-modal="false"
      aria-labelledby="lib-title"
      onKeyDown={onKeyDown}
      onWheel={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <header className="lib-head">
        <div>
          <div className="lib-eyebrow">{LIBRARY_BUILDING_NAME}</div>
          <h2 id="lib-title">Output Library</h2>
          {availability.ok && data && <p className="lib-sub">{total} output{total === 1 ? "" : "s"}{filtered ? " match" : " kept"}{data.storageConnected ? "" : " · file storage not connected"}</p>}
        </div>
        <button type="button" className="lib-close" onClick={closeLibrary} aria-label="Close Output Library" title="Close (Esc)">
          <Icon name="close" size={18} />
        </button>
      </header>

      {!availability.ok ? (
        <p className="lib-banner info">{availability.message}</p>
      ) : (
        <>
          {data?.environment === "development" && (
            <p className="lib-banner dev" role="note">
              <b>Development examples.</b> This local preview stores files in memory, not in Atlas storage. Nothing here is production data.
            </p>
          )}
          {data && !data.configured && <p className="lib-banner warn">The Library's database isn't connected on the site (the LIVE D1 binding is missing).</p>}
          {data?.configured && !data.storageConnected && (
            <p className="lib-banner warn" role="status">
              <b>File storage isn't connected.</b> Outputs are recorded, but their files can't be saved until the site's private R2 bucket (OUTPUTS) is bound.
            </p>
          )}

          <div className="lib-body">
            <section className={`lib-list-pane ${phone && showDetail ? "hidden" : ""}`} aria-label="Outputs">
              <div className="lib-search">
                <Icon name="search" size={15} />
                <input ref={search} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, agent, task or text" aria-label="Search outputs by title, agent, task or text" />
              </div>
              <div className="lib-chips" role="group" aria-label="File type">
                <button type="button" className={format === "" ? "on" : ""} aria-pressed={format === ""} onClick={() => setFormat("")}>All</button>
                {FORMATS.filter((f) => f !== "other").map((f) => (
                  <button type="button" key={f} className={format === f ? "on" : ""} aria-pressed={format === f} onClick={() => setFormat(format === f ? "" : f)}>
                    {FORMAT_LABEL[f]}
                  </button>
                ))}
              </div>
              <div className="lib-filters">
                <label>
                  <span className="sr-only">Agent</span>
                  <select value={agent} onChange={(e) => setAgent(e.target.value)} aria-label="Filter by agent">
                    <option value="">All agents</option>
                    {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </label>
                <label>
                  <span className="sr-only">Project</span>
                  <select value={project} onChange={(e) => setProject(e.target.value)} aria-label="Filter by project">
                    <option value="">All projects</option>
                    {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
                <label>
                  <span className="sr-only">Status</span>
                  <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} aria-label="Filter by status">
                    <option value="">Any status</option>
                    <option value="approval:awaiting">Awaiting approval</option>
                    <option value="approval:approved">Approved</option>
                    <option value="approval:rejected">Rejected</option>
                    <option value="storage:failed">File not saved</option>
                    <option value="storage:pending">Saving</option>
                  </select>
                </label>
              </div>

              {state === "error" && (
                <div className="lib-banner bad" role="alert">
                  Couldn't load the Library: {error}{" "}
                  <button type="button" className="lib-link" onClick={() => setTick((n) => n + 1)}>Try again</button>
                </div>
              )}
              <ul ref={listRef} className="lib-list" aria-label="Outputs" aria-busy={state === "loading"} onKeyDown={onListKey}>
                {data?.outputs.map((o) => <OutputRow key={o.id} o={o} selected={o.id === selected} onSelect={() => setSelected(o.id)} />)}
              </ul>
              {state === "ready" && data && data.outputs.length === 0 && (
                <div className="lib-empty">
                  {filtered ? (
                    <>
                      <p>No outputs match these filters.</p>
                      <button type="button" className="lib-link" onClick={() => { setQ(""); setFormat(""); setAgent(""); setProject(""); setStatus(""); }}>Clear filters</button>
                    </>
                  ) : (
                    <p>No outputs yet. Reports and files appear here as agents and workflows save them.</p>
                  )}
                </div>
              )}
              {state === "loading" && !data && <p className="lib-empty">Loading outputs…</p>}
              {total > 0 && (
                <nav className="lib-pager" aria-label="Pages">
                  <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous page">‹</button>
                  <span aria-live="polite">{from}–{to} of {total}</span>
                  <button type="button" disabled={to >= total} onClick={() => setPage(page + 1)} aria-label="Next page">›</button>
                </nav>
              )}
            </section>

            {selected && (
              <OutputDetailPane
                key={selected}
                id={selected}
                phone={phone}
                projectOf={projectOf}
                projectName={projectName}
                onBack={() => {
                  setSelected(null);
                  requestAnimationFrame(() => listRef.current?.querySelector<HTMLButtonElement>("button.lib-item")?.focus());
                }}
                onOpenTask={(taskId) => {
                  focusTasks({}, taskId);
                  closeLibrary();
                  setView("tasks");
                }}
                onChanged={() => setTick((n) => n + 1)}
              />
            )}
          </div>
        </>
      )}
    </aside>
  );
}

function OutputRow({ o, selected, onSelect }: { o: OutputSummary; selected: boolean; onSelect: () => void }) {
  const { catalog } = useAtlas();
  const v = o.latest;
  const who = identityFor(v.agent, catalog.agents);
  return (
    <li>
      <button type="button" className={`lib-item ${selected ? "on" : ""}`} aria-current={selected || undefined} onClick={onSelect}>
        <FormatIcon format={v.format} />
        <span className="lib-item-main">
          <span className="lib-item-title">{v.title}</span>
          <span className="lib-item-meta">
            <AgentAvatar identity={who} size={18} />
            <span>{who.name}</span>
            <span aria-hidden>·</span>
            <time dateTime={v.producedAt} title={formatDateTime(v.producedAt)}>{relative(v.producedAt)}</time>
            {o.versions > 1 && <span className="lib-ver">v{v.version}</span>}
            {v.sample && <span className="lib-sample">Example</span>}
          </span>
        </span>
        <span className="lib-item-side">
          {v.approval !== "not_required" && <ApprovalPill approval={v.approval} />}
          {v.storage !== "saved" && <span className={`lib-storage s-${v.storage}`}><Icon name="alert" size={11} /> {STORAGE_LABEL[v.storage]}</span>}
        </span>
      </button>
    </li>
  );
}

function OutputDetailPane({
  id,
  phone,
  projectOf,
  projectName,
  onBack,
  onOpenTask,
  onChanged,
}: {
  id: string;
  phone: boolean;
  projectOf: (v: OutputVersion) => string | null;
  projectName: (id: string | null) => string | null;
  onBack: () => void;
  onOpenTask: (taskId: string) => void;
  onChanged: () => void;
}) {
  const { catalog } = useAtlas();
  const [detail, setDetail] = useState<OutputDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [version, setVersion] = useState<number | null>(null);
  const [preview, setPreview] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [macBusy, setMacBusy] = useState(false);
  const [macNote, setMacNote] = useState<{ text: string; bad: boolean } | null>(null);
  const mac = useMemo(isTauri, []);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const ac = new AbortController();
    fetchOutput(id, ac.signal)
      .then((d) => {
        setDetail(d);
        setErr(null);
      })
      .catch((e) => !ac.signal.aborted && setErr(e instanceof Error ? e.message : String(e)));
    return () => ac.abort();
  }, [id, tick]);
  useEffect(() => {
    if (phone) heading.current?.focus({ preventScroll: true });
  }, [phone, detail?.id]);

  if (err) return <section className="lib-detail"><p className="lib-banner bad" role="alert">Couldn't load this output: {err}</p></section>;
  if (!detail) return <section className="lib-detail" aria-busy="true"><p className="lib-empty">Loading…</p></section>;
  const v = detail.history.find((h) => h.version === (version ?? detail.latest.version)) ?? detail.latest;
  const who = identityFor(v.agent, catalog.agents);
  const project = projectOf(v);
  const canFile = v.storage === "saved";
  const kind = previewKind(v.mime);
  const building = v.building ? (catalog.projects.find((p) => p.id === v.building)?.name ?? v.building) : null;
  const fileName = safeFilename(v.title, v.mime);
  // The Mac app opens files in their default app or saves them where Khaneil picks.
  const onMac = async (action: "open" | "save") => {
    setMacBusy(true);
    setMacNote(null);
    try {
      if (action === "open") await openOnMac(detail.id, v.version, fileName);
      else if (await saveOnMac(detail.id, v.version, fileName)) setMacNote({ text: `Saved ${fileName}.`, bad: false });
    } catch (e) {
      setMacNote({ text: e instanceof Error ? e.message : String(e), bad: true });
    }
    setMacBusy(false);
  };

  return (
    <section className="lib-detail" aria-labelledby="lib-detail-title">
      {phone && (
        <button type="button" className="lib-link lib-back" onClick={onBack}>
          ‹ All outputs
        </button>
      )}
      <div className="lib-detail-head">
        <FormatIcon format={v.format} />
        <div>
          <h3 id="lib-detail-title" ref={heading} tabIndex={-1}>{v.title}</h3>
          <p className="lib-sub">{FORMAT_LABEL[v.format]} · {v.mime} · {sizeLabel(v.size)} · version {v.version} of {detail.versions}</p>
        </div>
      </div>
      {v.sample && <p className="lib-banner dev">Development example, not production data.</p>}
      {v.storage !== "saved" && (
        <div className="lib-banner bad" role="alert">
          <b>{v.storage === "pending" ? "The file is still being saved." : "The file for this output wasn't saved."}</b> {v.storageError ?? ""}
          {v.via === "agent_report" && v.storage === "failed" && !canChangeLibrary() && <span className="lib-sub"> Retry it from the Atlas web page.</span>}
          {v.via === "agent_report" && v.storage === "failed" && canChangeLibrary() && (
            <>
              {" "}
              <button
                type="button"
                className="lib-link"
                disabled={retrying === "busy"}
                onClick={async () => {
                  setRetrying("busy");
                  try {
                    const r = await retryOutput(detail.id, v.version);
                    setRetrying(r.message ?? (r.storage === "saved" ? "Saved." : "Still not saved."));
                  } catch (e) {
                    setRetrying(e instanceof Error ? e.message : String(e));
                  }
                  setTick((n) => n + 1);
                  onChanged();
                }}
              >
                Retry from the stored report
              </button>
            </>
          )}
          {retrying && retrying !== "busy" && <span className="lib-sub"> {retrying}</span>}
        </div>
      )}

      <div className="lib-actions">
        <button type="button" className="lib-btn" disabled={!canFile || kind === "none"} aria-expanded={preview} onClick={() => setPreview(!preview)} title={kind === "none" ? "This format downloads instead" : undefined}>
          <Icon name="focus" size={14} /> {preview ? "Hide preview" : "Preview"}
        </button>
        {canFile && mac ? (
          <>
            {canOpenOnMac(fileName) && (
              <button type="button" className="lib-btn primary" disabled={macBusy} onClick={() => onMac("open")}>
                <Icon name="external" size={14} /> Open
              </button>
            )}
            <button type="button" className={`lib-btn${canOpenOnMac(fileName) ? "" : " primary"}`} disabled={macBusy} onClick={() => onMac("save")}>
              <Icon name="download" size={14} /> Save to Mac…
            </button>
          </>
        ) : canFile ? (
          <a className="lib-btn primary" href={fileUrl(detail.id, v.version, "download")} download>
            <Icon name="download" size={14} /> Download
          </a>
        ) : (
          <button type="button" className="lib-btn primary" disabled>
            <Icon name="download" size={14} /> Download
          </button>
        )}
        <button type="button" className="lib-btn" disabled={!v.task} onClick={() => v.task && onOpenTask(v.task)} title={v.task ? `Open ${v.task} in the Task Center` : "No source task was recorded"}>
          <Icon name="tasks" size={14} /> Open source task
        </button>
      </div>

      {macNote && <p className={`lib-sub lib-mac-note${macNote.bad ? " bad" : ""}`} role={macNote.bad ? "alert" : "status"}>{macNote.text}</p>}

      {preview && canFile && <Preview id={detail.id} v={v} onOpen={mac && canOpenOnMac(fileName) ? () => onMac("open") : undefined} />}

      {v.summary && <p className="lib-summary">{v.summary}</p>}

      <dl className="lib-facts">
        <dt>Agent</dt>
        <dd className="lib-agent">
          <AgentAvatar identity={who} size={22} />
          <span>{who.name}{who.via ? <span className="lib-sub"> via {who.via}</span> : null}</span>
        </dd>
        <dt>Source task</dt>
        <dd>{v.task ?? <span className="lib-sub">Not recorded</span>}</dd>
        <dt>Workflow / run</dt>
        <dd>
          {v.workflow ? <span>{v.workflow} · </span> : null}
          <span className="lib-mono">{v.execution}</span>
          {v.runUrl && (
            <>
              {" · "}
              <a href={v.runUrl} target="_blank" rel="noreferrer noopener">Open run <Icon name="external" size={11} /></a>
            </>
          )}
        </dd>
        <dt>Project</dt>
        <dd>{projectName(project) ?? <span className="lib-sub">Not recorded</span>}{!v.project && project ? <span className="lib-sub"> (agent's project)</span> : null}</dd>
        {building && (
          <>
            <dt>Building</dt>
            <dd>{building}</dd>
          </>
        )}
        <dt>Produced</dt>
        <dd>{formatDateTime(v.producedAt)}</dd>
        <dt>Approval</dt>
        <dd><ApprovalPill approval={v.approval} /></dd>
        <dt>Storage</dt>
        <dd className="lib-storage-cell">
          <StorageBadge v={v} />
          <span className="lib-sub">
            {v.storageAttempts} attempt{v.storageAttempts === 1 ? "" : "s"}
            {v.checksum ? <> · SHA-256 <span className="lib-mono" title={v.checksum}>{v.checksum.slice(0, 12)}…</span></> : null}
          </span>
          {v.storage === "saved" && v.storageError && <span className="lib-sub">{v.storageError}</span>}
        </dd>
        <dt>Provenance</dt>
        <dd>{v.via ? `Sent by ${v.via === "agent_report" ? "the agent's report" : v.via}` : "Sent through the Library hook"}{v.sourceUrl ? <> · <a href={v.sourceUrl} target="_blank" rel="noreferrer noopener">source</a></> : null}</dd>
      </dl>

      <h4 className="lib-h4">Version history</h4>
      <ol className="lib-versions">
        {detail.history.map((h) => (
          <li key={h.version}>
            <button type="button" className={h.version === v.version ? "on" : ""} aria-current={h.version === v.version || undefined} onClick={() => { setVersion(h.version); setPreview(false); setMacNote(null); }}>
              <span>v{h.version}</span>
              <span className="lib-sub">{formatDateTime(h.producedAt)} · {sizeLabel(h.size)}</span>
              <span className={`lib-dot s-${h.storage === "saved" && h.verifiedAt ? "verified" : h.storage}`} aria-label={h.storage === "saved" && h.verifiedAt ? "Retrieval verified" : STORAGE_LABEL[h.storage]} />
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Previews from the authorized file route. Text is read as text (first 256 KB) and drawn as React text. */
function Preview({ id, v, onOpen }: { id: string; v: OutputVersion; onOpen?: () => void }) {
  const kind = previewKind(v.mime);
  const [text, setText] = useState<{ text: string; truncatedFrom: number | null } | null>(null);
  const [img, setImg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const textual = kind === "text" || kind === "markdown" || kind === "table";
  const mac = isTauri();
  useEffect(() => {
    if (!textual && kind !== "image") return;
    const ac = new AbortController();
    const fail = (e: unknown) => !ac.signal.aborted && setErr(e instanceof Error ? e.message : String(e));
    if (kind === "image") imageSource(id, v.version, ac.signal).then(setImg).catch(fail);
    else fetchTextPreview(id, v.version, ac.signal).then(setText).catch(fail);
    return () => ac.abort();
  }, [id, v.version, textual, kind]);

  // The Mac app's window can't frame a PDF, so it opens in Preview instead.
  if (kind === "pdf" && mac)
    return (
      <div className="lib-preview lib-preview-mac">
        <p>PDFs open in Preview on your Mac.</p>
        {onOpen && <button type="button" className="lib-btn" onClick={onOpen}><Icon name="external" size={14} /> Open in Preview</button>}
      </div>
    );
  if (kind === "pdf") return <figure className="lib-preview pdf"><iframe src={fileUrl(id, v.version, "inline")} title={`Preview of ${v.title}`} /></figure>;
  if (err) return <p className="lib-banner bad">Couldn't load the preview: {err}</p>;
  if (kind === "image") return img ? <figure className="lib-preview"><img src={img} alt={`Preview of ${v.title}`} /></figure> : <p className="lib-empty">Loading preview…</p>;
  if (!text) return <p className="lib-empty">Loading preview…</p>;
  const cut = text.truncatedFrom ? <p className="lib-sub">Showing the first {sizeLabel(text.text.length)} of {sizeLabel(text.truncatedFrom)}. Download for the whole file.</p> : null;
  if (kind === "table") {
    const rows = parseDelimited(text.text, v.mime.includes("tab-separated") ? "\t" : ",", 101);
    const [head, ...body] = rows;
    return (
      <div className="lib-preview table">
        <table>
          <thead><tr>{head?.map((c, i) => <th key={i}>{c}</th>)}</tr></thead>
          <tbody>{body.slice(0, 100).map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
        </table>
        {body.length > 100 && <p className="lib-sub">First 100 rows.</p>}
        {cut}
      </div>
    );
  }
  if (kind === "markdown") return <div className="lib-preview md"><SafeMarkdown text={text.text} links={false} />{cut}</div>;
  let shown = text.text;
  if (v.mime.startsWith("application/json") && !text.truncatedFrom) {
    try {
      shown = JSON.stringify(JSON.parse(text.text), null, 2);
    } catch {
      // Not valid JSON: show it as it came.
    }
  }
  return <div className="lib-preview"><pre>{shown}</pre>{cut}</div>;
}
