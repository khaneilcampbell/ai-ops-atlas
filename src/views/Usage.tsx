import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { intelApi } from "../intel/api";
import type { Run } from "../intel/types";
import { useIntel } from "../intel/state";
import { load, remove, save } from "../lib/storage";
import { relative } from "../lib/time";
import { useAtlas } from "../state";
import {
  PERIODS,
  compact,
  cost,
  groupRows,
  money,
  parseImport,
  providerLabel,
  recordsFromRuns,
  summarize,
  topAgents,
  type Bucket,
  type GroupBy,
  type GroupRow,
  type Period,
  type UsageRecord,
} from "../usage/model";
import "../styles/usage.css";

interface ImportStore {
  files: { name: string; importedAt: string; count: number }[];
  records: UsageRecord[];
}
const IMPORT_KEY = "usageImports";
const KNOWN_PROVIDERS = ["anthropic", "openai"];

/** Reads usage Atlas already logged, on open and when Refresh is pressed. No polling, no model calls. */
function useUsageData() {
  const intel = useIntel();
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(intel.available);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [imports, setImports] = useState<ImportStore>(() => load<ImportStore>(IMPORT_KEY, { files: [], records: [] }));

  const refresh = useCallback(async () => {
    setImports(load<ImportStore>(IMPORT_KEY, { files: [], records: [] }));
    if (!intel.available) {
      setUpdatedAt(new Date().toISOString());
      return;
    }
    setLoading(true);
    try {
      setRuns(await intelApi.runs());
      setError(null);
      setUpdatedAt(new Date().toISOString());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [intel.available]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const addImport = (name: string, records: UsageRecord[]) => {
    const next: ImportStore = {
      files: [...imports.files.filter((f) => f.name !== name), { name, importedAt: new Date().toISOString(), count: records.length }],
      records: [...imports.records.filter((r) => !r.id.startsWith(`import:${name}:`)), ...records],
    };
    save(IMPORT_KEY, next);
    setImports(load<ImportStore>(IMPORT_KEY, { files: [], records: [] }));
  };
  const clearImports = () => {
    remove(IMPORT_KEY);
    setImports({ files: [], records: [] });
  };

  const agentName = intel.status?.name ?? "Repository Intelligence";
  const records = useMemo(() => [...recordsFromRuns(runs ?? [], agentName), ...imports.records], [runs, agentName, imports.records]);
  const oldestRun = runs?.find((r) => r.usage)?.started_at ?? null;

  return { available: intel.available, keyPresent: intel.status?.key_present ?? false, records, runs, imports, loading, error, updatedAt, oldestRun, refresh, addImport, clearImports };
}

export function UsageView() {
  const { catalog, setView } = useAtlas();
  const data = useUsageData();
  const [period, setPeriodState] = useState<Period>(() => load<Period>("usagePeriod", "week"));
  const setPeriod = (p: Period) => {
    setPeriodState(p);
    save("usagePeriod", p);
  };
  const span = PERIODS.find((p) => p.id === period)!.span;
  const summary = useMemo(() => summarize(data.records, period), [data.records, period]);
  const top = useMemo(() => topAgents(summary.inWindow), [summary.inWindow]);
  const t = summary.totals;
  const projectName = useMemo(() => {
    const byRepo = new Map(catalog.projects.map((p) => [p.repository.toLowerCase(), p.name]));
    return (repo: string) => byRepo.get(repo.toLowerCase()) ?? null;
  }, [catalog.projects]);

  const hasAny = data.records.length > 0;
  const firstLoad = data.loading && data.runs === null;
  const cached = t.cacheRead + t.cacheWrite;
  const billedProviders = new Set(summary.inWindow.filter((r) => r.costKind === "billed").map((r) => r.provider));

  return (
    <div className="page usage">
      <div className="page-head">
        <div className="grow">
          <div className="eyebrow">API Usage</div>
          <h1>What your agents spend.</h1>
          <p className="lede">Tokens, requests and cost from usage Atlas has recorded, totalled on this device. Nothing here calls a model or a provider.</p>
        </div>
        <div className="usage-controls">
          <div className="seg-ctl" role="group" aria-label="Period">
            {PERIODS.map((p) => (
              <button key={p.id} className={period === p.id ? "on" : ""} aria-pressed={period === p.id} onClick={() => setPeriod(p.id)} title={p.span}>
                {p.label}
              </button>
            ))}
          </div>
          <button className="btn" onClick={() => void data.refresh()} disabled={data.loading}>
            <Icon name="refresh" size={14} className={data.loading ? "spin" : undefined} /> Refresh
          </button>
        </div>
      </div>
      <div className="usage-meta small muted">
        {data.updatedAt ? <>Last updated {new Date(data.updatedAt).toLocaleString()} · </> : null}
        Showing the {span}
        {data.oldestRun && <> · Atlas records go back to {new Date(data.oldestRun).toLocaleDateString()}</>}
      </div>

      {data.error && (
        <div className="card card-pad usage-error" role="alert">
          <Icon name="alert" size={16} />
          <div className="grow">
            <div className="title">Couldn't read recorded usage.</div>
            <div className="small muted selectable">{data.error}</div>
          </div>
          <button className="btn small" onClick={() => void data.refresh()}>
            Try again
          </button>
        </div>
      )}

      {firstLoad ? (
        <div className="card empty">Reading recorded usage…</div>
      ) : !hasAny ? (
        <SetupState available={data.available} keyPresent={data.keyPresent} onSettings={() => setView("settings")} onImport={data.addImport} />
      ) : (
        <div className={data.loading ? "usage-body refetching" : "usage-body"}>
          <div className="grid usage-kpis">
            <div className="card tile accent">
              <div className="eyebrow">Estimated spend</div>
              <div className="num">{money(t.estimatedUsd)}</div>
              <div className="sub">
                Reported tokens × your configured prices{t.unpriced ? ` · ${t.unpriced} ${t.unpriced === 1 ? "record has" : "records have"} no price` : ""}
              </div>
            </div>
            <div className="card tile">
              <div className="eyebrow">Provider-billed</div>
              <div className="num">{billedProviders.size ? money(t.billedUsd) : "–"}</div>
              <div className="sub">{billedProviders.size ? `From ${[...billedProviders].map(providerLabel).join(", ")} billing records` : "No billing records imported for this period"}</div>
            </div>
            <div className="card tile">
              <div className="eyebrow">Tokens</div>
              <div className="num">{compact(t.input + t.output + cached)}</div>
              <div className="sub">
                {compact(t.input)} input · {compact(t.output)} output · {compact(cached)} cached
              </div>
            </div>
            <div className="card tile">
              <div className="eyebrow">API requests</div>
              <div className="num">{compact(t.requests)}</div>
              <div className="sub">
                {t.records} {t.records === 1 ? "record" : "records"} in the {span}
              </div>
            </div>
          </div>

          <div className="grid usage-row">
            <UsageChart buckets={summary.buckets} period={period} />
            <div className="usage-side">
              <div className="card">
                <div className="card-head">
                  <h3 className="grow">Top agents by cost</h3>
                </div>
                {top.length === 0 ? (
                  <div className="empty small">No priced usage in the {span}.</div>
                ) : (
                  <ol className="usage-top">
                    {top.map((a, i) => (
                      <li key={a.key}>
                        <span className="rank">{i + 1}</span>
                        <span className="grow">
                          <span className="title">{a.key}</span>
                          <span className="meta">
                            {compact(a.requests)} requests · {a.providers.map(providerLabel).join(", ")}
                          </span>
                        </span>
                        <span className="amt">
                          {money(cost(a))}
                          <span className="meta">{costKindLabel(a)}</span>
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
              <ProviderCard records={summary.inWindow} imports={data.imports} onImport={data.addImport} onClear={data.clearImports} />
            </div>
          </div>

          <UsageTable records={summary.inWindow} projectName={projectName} span={span} />
          <p className="usage-foot small muted">
            Estimated costs for Atlas's own runs are Anthropic's reported token counts priced with the rates under Settings → Repository intelligence, and imported rows not marked billed are estimates too; either can differ from your invoice. Provider-billed figures come only from billing records you import. Claude subscription usage (Pro, Max, Claude Code plans) isn't available through API billing, so it isn't counted here.
          </p>
        </div>
      )}
    </div>
  );
}

function costKindLabel(r: GroupRow) {
  if (r.billedUsd && r.estimatedUsd) return "estimated + billed";
  return r.billedUsd ? "billed" : "estimated";
}

// ── Chart ───────────────────────────────────────────────────────────────────

type Metric = "requests" | "tokens" | "cost";
const METRICS: { id: Metric; label: string }[] = [
  { id: "requests", label: "Requests" },
  { id: "tokens", label: "Tokens" },
  { id: "cost", label: "Cost" },
];

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return ([1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((s) => n <= s) ?? 10) * p;
}

function UsageChart({ buckets, period }: { buckets: Bucket[]; period: Period }) {
  const [metric, setMetric] = useState<Metric>("requests");
  const [hover, setHover] = useState<number | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const W = 720;
  const H = 210;
  const pad = { l: 44, r: 8, t: 12, b: 26 };
  const hasBilled = buckets.some((b) => b.billedUsd > 0);
  const val = (b: Bucket) => (metric === "requests" ? b.requests : metric === "tokens" ? b.tokens : b.estimatedUsd + b.billedUsd);
  const max = niceMax(Math.max(0, ...buckets.map(val)));
  const step = (W - pad.l - pad.r) / buckets.length;
  const bw = Math.min(24, step - 2);
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const fmt = (v: number) => {
    if (metric !== "cost") return v < 10 && v % 1 ? v.toFixed(1) : compact(v);
    if (v === 0) return "$0";
    return v >= 100 ? `$${compact(v)}` : `$${v.toFixed(v % 1 ? 2 : 0)}`;
  };
  const when = (b: Bucket) =>
    period === "day"
      ? new Date(b.start).toLocaleTimeString(undefined, { hour: "numeric" })
      : new Date(b.start).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const labelEvery = period === "day" ? 4 : period === "week" ? 1 : 5;
  const total = buckets.reduce((s, b) => s + val(b), 0);
  const hb = hover == null ? null : buckets[hover];

  // A bar's top corners are rounded, its baseline edge stays square.
  const bar = (x: number, top: number, h: number, roundTop: boolean) => {
    const r = roundTop ? Math.min(4, h, bw / 2) : 0;
    const bottom = top + h;
    return `M${x},${bottom}V${top + r}${r ? `Q${x},${top} ${x + r},${top}` : ""}H${x + bw - r}${r ? `Q${x + bw},${top} ${x + bw},${top + r}` : ""}V${bottom}Z`;
  };

  return (
    <div className="card usage-chart-card" ref={wrap}>
      <div className="card-head">
        <div className="grow">
          <h3>{metric === "requests" ? "API requests" : metric === "tokens" ? "Tokens" : "Cost"} over time</h3>
          <div className="small muted">{period === "day" ? "Per hour" : "Per day"} · hover a bar for its values</div>
        </div>
        {metric === "cost" && hasBilled && (
          <span className="legend-inline">
            <span>
              <i className="sw-est" /> Estimated
            </span>
            <span>
              <i className="sw-billed" /> Billed
            </span>
          </span>
        )}
        <div className="seg-ctl" role="group" aria-label="Chart metric">
          {METRICS.map((m) => (
            <button key={m.id} className={metric === m.id ? "on" : ""} aria-pressed={metric === m.id} onClick={() => setMetric(m.id)}>
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <svg className="usage-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${fmt(total)} ${metric} in ${buckets.length} ${period === "day" ? "hours" : "days"}`} onMouseLeave={() => setHover(null)}>
        {[0, max / 2, max].map((tk) => (
          <g key={tk}>
            <line x1={pad.l} x2={W - pad.r} y1={y(tk)} y2={y(tk)} className="gridline" />
            <text x={pad.l - 8} y={y(tk) + 3} textAnchor="end" className="axis">
              {fmt(tk)}
            </text>
          </g>
        ))}
        {buckets.map((b, i) => {
          const x = pad.l + i * step + (step - bw) / 2;
          const est = metric === "cost" ? b.estimatedUsd : val(b);
          const billed = metric === "cost" ? b.billedUsd : 0;
          const hEst = y(0) - y(est);
          const hBilled = y(0) - y(billed);
          return (
            <g
              key={b.start}
              className={hover === i ? "col on" : "col"}
              tabIndex={0}
              aria-label={`${when(b)}: ${fmt(val(b))}`}
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
            >
              <rect x={pad.l + i * step} y={pad.t} width={step} height={H - pad.t - pad.b} fill="transparent" />
              {hEst > 0 && <path d={bar(x, y(est), Math.max(1, hEst), billed === 0)} className="m-est" />}
              {hBilled > 0 && <path d={bar(x, y(est) - hBilled - (hEst > 0 ? 2 : 0), Math.max(1, hBilled), true)} className="m-billed" />}
              {i % labelEvery === (buckets.length - 1) % labelEvery && (
                <text x={x + bw / 2} y={H - 8} textAnchor="middle" className="axis">
                  {when(b)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hb && hover != null && (
        <div className="usage-tip" style={{ left: `${((pad.l + (hover + 0.5) * step) / W) * 100}%` }} role="status">
          <div className="tip-when">{period === "day" ? `${when(hb)}–${new Date(hb.end).toLocaleTimeString(undefined, { hour: "numeric" })}` : new Date(hb.start).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</div>
          <div className="tip-row">
            <strong>{compact(hb.requests)}</strong> requests
          </div>
          <div className="tip-row">
            <strong>{compact(hb.tokens)}</strong> tokens
          </div>
          <div className="tip-row">
            <i className="sw-est" />
            <strong>{money(hb.estimatedUsd)}</strong> estimated
          </div>
          {hasBilled && (
            <div className="tip-row">
              <i className="sw-billed" />
              <strong>{money(hb.billedUsd)}</strong> billed
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Providers ───────────────────────────────────────────────────────────────

function ProviderCard({ records, imports, onImport, onClear }: { records: UsageRecord[]; imports: ImportStore; onImport: (name: string, r: UsageRecord[]) => void; onClear: () => void }) {
  const rows = useMemo(() => {
    const g = groupRows(records, "provider");
    const ids = [...new Set([...KNOWN_PROVIDERS, ...g.map((r) => r.key)])];
    return ids.map((id) => ({ id, row: g.find((r) => r.key === id) ?? null }));
  }, [records]);
  const all = Math.max(...rows.map((r) => (r.row ? cost(r.row) : 0)), 0);
  return (
    <div className="card">
      <div className="card-head">
        <h3 className="grow">By provider</h3>
      </div>
      <div className="usage-providers">
        {rows.map(({ id, row }) => (
          <div key={id} className="prov">
            <div className="prov-line">
              <span className="title">{providerLabel(id)}</span>
              <span className="spacer" />
              {row ? <span className="amt">{money(cost(row))}</span> : <span className="small muted">No records</span>}
            </div>
            {row ? (
              <>
                <div className="meter" aria-hidden="true">
                  <i className={row.billedUsd > row.estimatedUsd ? "billed" : undefined} style={{ width: `${all ? (cost(row) / all) * 100 : 0}%` }} />
                </div>
                <div className="meta">
                  {compact(row.requests)} requests · {compact(row.input + row.output + row.cacheRead + row.cacheWrite)} tokens · {costKindLabel(row)}
                </div>
              </>
            ) : (
              <div className="meta">{id === "anthropic" ? "Recorded automatically when repository intelligence runs." : "Import a usage file to include it."}</div>
            )}
          </div>
        ))}
      </div>
      <div className="card-foot">
        <ImportButton onImport={onImport} />
        {imports.files.length > 0 && (
          <div className="small muted usage-files">
            {imports.files.map((f) => `${f.name} (${f.count})`).join(", ")} ·{" "}
            <button className="text-btn small" onClick={onClear}>
              Remove imports
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ImportButton({ onImport }: { onImport: (name: string, r: UsageRecord[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const { records, skipped } = parseImport(await f.text(), f.name);
      onImport(f.name, records);
      setMsg({ ok: true, text: `Imported ${records.length} ${records.length === 1 ? "record" : "records"}${skipped ? `, skipped ${skipped} that didn't match the format` : ""}.` });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      if (input.current) input.current.value = "";
    }
  };
  return (
    <div>
      <input ref={input} type="file" accept=".json,application/json" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
      <button className="btn small" onClick={() => input.current?.click()}>
        <Icon name="plus" size={12} /> Import usage file
      </button>
      {msg && <div className={`small ${msg.ok ? "muted" : "usage-bad"}`}>{msg.text}</div>}
    </div>
  );
}

// ── Table ───────────────────────────────────────────────────────────────────

type SortKey = "key" | "requests" | "input" | "output" | "cached" | "estimatedUsd" | "billedUsd" | "last";
const GROUPS: { id: GroupBy; label: string }[] = [
  { id: "agent", label: "Agent" },
  { id: "project", label: "Project" },
  { id: "provider", label: "Provider" },
  { id: "model", label: "Model" },
];
const COLS: { key: SortKey; label: string; num?: boolean }[] = [
  { key: "requests", label: "Requests", num: true },
  { key: "input", label: "Input", num: true },
  { key: "output", label: "Output", num: true },
  { key: "cached", label: "Cached", num: true },
  { key: "estimatedUsd", label: "Est. cost", num: true },
  { key: "billedUsd", label: "Billed", num: true },
  { key: "last", label: "Last used" },
];

function UsageTable({ records, projectName, span }: { records: UsageRecord[]; projectName: (repo: string) => string | null; span: string }) {
  const [by, setBy] = useState<GroupBy>("agent");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "estimatedUsd", desc: true });
  const rows = useMemo(() => {
    const v = (r: GroupRow): number | string => (sort.key === "cached" ? r.cacheRead + r.cacheWrite : sort.key === "key" ? r.key.toLowerCase() : r[sort.key]);
    return groupRows(records, by).sort((a, b) => {
      const x = v(a);
      const y = v(b);
      const c = x < y ? -1 : x > y ? 1 : 0;
      return sort.desc ? -c : c;
    });
  }, [records, by, sort]);
  const head = (key: SortKey, label: string, num?: boolean) => (
    <th key={key} className={num ? "num" : undefined} aria-sort={sort.key === key ? (sort.desc ? "descending" : "ascending") : "none"}>
      <button className="sort-btn" onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : key !== "key" }))}>
        {label}
        {sort.key === key && <span aria-hidden="true">{sort.desc ? " ↓" : " ↑"}</span>}
      </button>
    </th>
  );
  const name = (r: GroupRow) => (by === "provider" ? providerLabel(r.key) : r.key);

  return (
    <div className="card usage-table-card">
      <div className="card-head">
        <h3 className="grow">Usage by {GROUPS.find((g) => g.id === by)!.label.toLowerCase()}</h3>
        <div className="seg-ctl" role="group" aria-label="Group by">
          {GROUPS.map((g) => (
            <button key={g.id} className={by === g.id ? "on" : ""} aria-pressed={by === g.id} onClick={() => setBy(g.id)}>
              {g.label}
            </button>
          ))}
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="empty small">No usage in the {span}.</div>
      ) : (
        <div className="usage-table-wrap">
          <table className="table usage-table">
            <thead>
              <tr>
                {head("key", GROUPS.find((g) => g.id === by)!.label)}
                {COLS.map((c) => head(c.key, c.label, c.num))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td>
                    <div className="name">{name(r)}</div>
                    <div className="desc">{[by === "project" ? projectName(r.key) : null, by !== "provider" ? r.providers.map(providerLabel).join(", ") : null].filter(Boolean).join(" · ")}</div>
                  </td>
                  <td className="num">{r.requests.toLocaleString()}</td>
                  <td className="num">{compact(r.input)}</td>
                  <td className="num">{compact(r.output)}</td>
                  <td className="num">{compact(r.cacheRead + r.cacheWrite)}</td>
                  <td className="num">
                    {r.estimatedUsd ? money(r.estimatedUsd) : "–"}
                    {r.unpriced > 0 && <div className="desc">{r.unpriced} unpriced</div>}
                  </td>
                  <td className="num">{r.billedUsd ? money(r.billedUsd) : "–"}</td>
                  <td className="muted">{relative(r.last)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Setup ───────────────────────────────────────────────────────────────────

function SetupState({ available, keyPresent, onSettings, onImport }: { available: boolean; keyPresent: boolean; onSettings: () => void; onImport: (name: string, r: UsageRecord[]) => void }) {
  return (
    <div className="card usage-setup">
      <div className="usage-setup-head">
        <div className="brand-mark">
          <Icon name="usage" size={20} />
        </div>
        <div>
          <h2>No API usage recorded yet</h2>
          <p className="muted">Atlas only shows usage it can read from a real record. Until one exists, there's nothing to total, and nothing runs in the background.</p>
        </div>
      </div>
      <ol className="usage-steps">
        <li>
          <div className="title">Record usage from Atlas's own agent</div>
          {available ? (
            <p className="muted">
              {keyPresent
                ? "Your Anthropic key is set. Each repository intelligence run logs the tokens Anthropic reports, and its estimated cost, here. Run an analysis from the Intel tab to see the first record."
                : "Add an Anthropic API key under Settings → Repository intelligence. The key stays in the macOS Keychain. Each analysis then logs the tokens Anthropic reports, and an estimated cost."}
            </p>
          ) : (
            <p className="muted">Usage is recorded by the Mac app, which holds the API key in the macOS Keychain. This web view can't read it; open Atlas on your Mac.</p>
          )}
          {available && !keyPresent && (
            <button className="btn small" onClick={onSettings}>
              <Icon name="settings" size={12} /> Open Settings
            </button>
          )}
        </li>
        <li>
          <div className="title">Import Anthropic or OpenAI usage records</div>
          <p className="muted">
            For agents that run outside Atlas, import a JSON file of usage records (format in <span className="mono">docs/api-usage.md</span>). Mark a row's cost as <span className="mono">billed</span> only when it comes from the provider's
            billing; everything else is shown as an estimate. The file stays on this device.
          </p>
          <ImportButton onImport={onImport} />
        </li>
      </ol>
      <p className="small muted usage-setup-note">Claude subscription usage (Pro, Max, Claude Code plans) isn't available through API billing endpoints, so it can't appear here.</p>
    </div>
  );
}
