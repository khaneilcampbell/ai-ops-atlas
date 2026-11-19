import { memo, useState, type ReactNode } from "react";
import { ExternalLink } from "../../components/bits";
import type { AgentOutput, CodeData, DocumentData, ErrorData } from "../../outputs/types";
import { chartData, outputProblems, redact, safeImageUrl, safeUrl, tableData } from "../../outputs/validate";

// Renderers for the Agent Output Studio, one per output type. Everything is drawn as React text
// nodes: no innerHTML, no iframes, no scripts. Markdown supports a small safe subset; raw HTML in
// it shows as text. Links open only when the output is verified and the URL is https.

/** Inline markdown: **bold**, `code` and [text](https://link). Anything else is plain text. */
function inline(s: string, links: boolean, key = 0): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|_[^_]+_)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = key;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("**")) out.push(<b key={k++}>{t.slice(2, -2)}</b>);
    else if (t.startsWith("`")) out.push(<code key={k++}>{t.slice(1, -1)}</code>);
    else if (t.startsWith("_")) out.push(<em key={k++}>{t.slice(1, -1)}</em>);
    else {
      const lm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(t)!;
      const url = safeUrl(lm[2]);
      out.push(url && links ? <ExternalLink key={k++} href={url}>{lm[1]}</ExternalLink> : <span key={k++}>{lm[1]}{url ? ` (${new URL(url).host})` : ""}</span>);
    }
    last = m.index + t.length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

export function SafeMarkdown({ text, links }: { text: string; links: boolean }) {
  const lines = redact(text).split("\n");
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const items = list.items.map((x, i) => <li key={i}>{inline(x, links)}</li>);
    blocks.push(list.ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>);
    list = null;
  };
  for (const raw of lines) {
    const l = raw.trimEnd();
    const bullet = /^\s*[-*]\s+(.*)$/.exec(l);
    const num = /^\s*\d+[.)]\s+(.*)$/.exec(l);
    if (bullet || num) {
      const ordered = !!num && !bullet;
      if (list && list.ordered !== ordered) flush();
      list ??= { ordered, items: [] };
      list.items.push((bullet ?? num)![1]);
      continue;
    }
    flush();
    const h = /^(#{1,4})\s+(.*)$/.exec(l);
    if (h) blocks.push(<h4 key={blocks.length} className="os-md-h">{inline(h[2], links)}</h4>);
    else if (l.trim()) blocks.push(<p key={blocks.length}>{inline(l, links)}</p>);
  }
  flush();
  return <div className="os-md">{blocks}</div>;
}

export function TableView({ data, limit }: { data: unknown; limit?: number }) {
  const t = tableData(data);
  const [all, setAll] = useState(false);
  if (!t) return <Invalid why="Table data isn't rows and columns." />;
  const PAGE = 100;
  const max = limit ?? (all ? t.rows.length : PAGE);
  const rows = t.rows.slice(0, max);
  return (
    <div className="os-table-wrap">
      <table className="os-table">
        <thead>
          <tr>
            {t.columns.map((c, i) => (
              <th key={i}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {t.columns.map((_, j) => (
                <td key={j}>{r[j] ?? ""}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {t.rows.length > max &&
        (limit ? (
          <div className="muted small">+{t.rows.length - max} more rows</div>
        ) : (
          <button className="text-btn small" onClick={() => setAll(true)}>
            Show all {t.rows.length} rows
          </button>
        ))}
    </div>
  );
}

export function ChartView({ data, limit }: { data: unknown; limit?: number }) {
  const c = chartData(data);
  if (!c) return <Invalid why="Chart data isn't a list of real numbers, so no chart is drawn." />;
  const top = c.max ?? Math.max(...c.series.map((p) => p.value), 1);
  const series = limit ? c.series.slice(0, limit) : c.series;
  return (
    <div className="os-chart" role="img" aria-label={series.map((p) => `${p.label} ${p.value}`).join(", ")}>
      {series.map((p, i) => (
        <div key={i} className="os-bar">
          <span className="os-bar-label">{p.label}</span>
          <span className="os-bar-track">
            <i style={{ width: `${Math.min(100, (p.value / top) * 100)}%` }} />
          </span>
          <span className="os-bar-val">
            {p.value}
            {c.max ? `/${c.max}` : ""}
          </span>
        </div>
      ))}
      {c.unit && <div className="muted small">{c.unit}</div>}
    </div>
  );
}

function JsonNode({ name, value, depth }: { name?: string; value: unknown; depth: number }) {
  const label = name !== undefined ? <span className="os-json-key">{redact(name)}: </span> : null;
  if (value === null || typeof value !== "object")
    return (
      <div className="os-json-leaf">
        {label}
        <span className={`os-json-${typeof value}`}>{typeof value === "string" ? `"${redact(value)}"` : String(value)}</span>
      </div>
    );
  const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v] as const) : Object.entries(value);
  if (depth > 6) return <div className="os-json-leaf">{label}…</div>;
  return (
    <details className="os-json-node" open={depth < 2}>
      <summary>
        {label}
        <span className="muted">{Array.isArray(value) ? `[${entries.length}]` : `{${entries.length}}`}</span>
      </summary>
      {entries.slice(0, 200).map(([k, v]) => (
        <JsonNode key={k} name={k} value={v} depth={depth + 1} />
      ))}
    </details>
  );
}
export const JsonView = ({ data }: { data: unknown }) => (
  <div className="os-json">
    <JsonNode value={data} depth={0} />
  </div>
);

function Invalid({ why }: { why: string }) {
  return <p className="muted small os-invalid">Can't display this output: {why}</p>;
}

function ArtifactAction({ o }: { o: AgentOutput }) {
  const url = o.artifact ? safeUrl(o.artifact.url) : null;
  if (!url || !o.artifact) return null;
  if (o.verificationStatus !== "verified")
    return (
      <div className="muted small">
        {o.artifact.label} · {new URL(url).host} · not opened from here until verified
      </div>
    );
  return (
    <ExternalLink className="btn small" href={url}>
      Open {o.type === "document" ? "document" : "link"} · {new URL(url).host}
    </ExternalLink>
  );
}

/** Draws one output. `compact` draws the card preview: a few rows or bars, no long text. */
export const OutputBody = memo(function OutputBody({ o, compact }: { o: AgentOutput; compact?: boolean }) {
  const problems = outputProblems(o);
  if (problems.length) return <Invalid why={problems.join(" ")} />;
  const d = o.structuredData;
  const verified = o.verificationStatus === "verified";
  switch (o.type) {
    case "text": {
      const t = (d as { text?: unknown })?.text;
      return typeof t === "string" ? <p className="os-text">{redact(compact ? t.split("\n")[0] : t)}</p> : <Invalid why="No text." />;
    }
    case "markdown":
      if (typeof d !== "string") return <Invalid why="No markdown text." />;
      return compact ? <p className="os-text">{redact((d.split("\n").find((l) => l.trim() && !/^#{1,4}\s/.test(l)) ?? "").replace(/^\s*(?:[-*]|\d+[.)])\s+/, "").replace(/[*_`>]/g, ""))}</p> : <SafeMarkdown text={d} links={verified} />;
    case "table":
      return <TableView data={d} limit={compact ? 3 : undefined} />;
    case "chart":
      return <ChartView data={d} limit={compact ? 4 : undefined} />;
    case "json":
      return compact ? <p className="muted small">Structured data · expand to inspect</p> : <JsonView data={d} />;
    case "document": {
      const doc = d as DocumentData | undefined;
      const ok = doc && Array.isArray(doc.sections) && doc.sections.every((s) => typeof s?.heading === "string" && typeof s?.body === "string");
      if (compact) return <p className="os-text">{ok ? doc!.sections.map((s) => s.heading).join(" · ") : (o.artifact?.label ?? "Document")}</p>;
      return (
        <div className="os-doc">
          {ok &&
            doc!.sections.map((s, i) => (
              <section key={i}>
                <h4 className="os-md-h">{redact(s.heading)}</h4>
                <SafeMarkdown text={s.body} links={verified} />
              </section>
            ))}
          <ArtifactAction o={o} />
        </div>
      );
    }
    case "code": {
      const c = d as CodeData | undefined;
      if (!c || typeof c.code !== "string") return <Invalid why="No code." />;
      const text = redact(c.code);
      return (
        <pre className="os-code" aria-label={`${c.language || "text"} (read-only)`}>
          <code>{compact ? text.split("\n").slice(0, 3).join("\n") : text}</code>
        </pre>
      );
    }
    case "image": {
      const src = o.artifact ? safeImageUrl(o.artifact.url) : null;
      if (!src || !verified) return <ArtifactAction o={o} />;
      return <img className="os-img" src={src} alt={redact(o.title)} loading="lazy" referrerPolicy="no-referrer" />;
    }
    case "link":
      return <ArtifactAction o={o} />;
    case "error": {
      const e = d as ErrorData | undefined;
      return <p className="os-error">{redact(typeof e?.message === "string" ? e.message : "Failed without an error message.")}</p>;
    }
  }
});
