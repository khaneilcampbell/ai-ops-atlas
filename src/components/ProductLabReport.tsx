import { formatDate, relative } from "../lib/time";
import type { StoredReport } from "../reports/model";
import { CRITERIA, PILLAR_LABEL, type ProductLabReport, type ProductPick } from "../reports/productLab";
import { ExternalLink } from "./bits";
import { Icon } from "./Icon";

// Benjaire Product Lab's monthly brief (src/reports/productLab.ts), read-only. Atlas shows what the
// n8n agent sent; it never runs the agent or calls a model.

const score = (r: ProductLabReport, title: string) => r.scorecard.find((x) => x.idea === title)?.total.toFixed(2) ?? "–";
const status = (r: ProductLabReport) => (r.status === "validated" ? "Validated by real demand" : "Hypothesis, not validated yet");

export function ProductLabSummary({ report, onOpen }: { report: StoredReport<ProductLabReport>; onOpen?: () => void }) {
  const r = report.body;
  return (
    <div className="report-summary">
      <div className="report-top">
        <span className="report-score">{score(r, r.top.title)}</span>
        <span className="grow">
          <strong>{r.top.title}</strong>
          <div className="muted small">
            {PILLAR_LABEL[r.top.pillar]} · {r.top.offer}
          </div>
        </span>
      </div>
      <div className="muted small">
        {r.month} · {status(r)} · runners-up: {r.runners_up.map((p) => p.title).join(", ")} · {relative(report.at)}
      </div>
      {onOpen && (
        <button className="text-btn inline" onClick={onOpen}>
          Open full report
        </button>
      )}
    </div>
  );
}

function Pick({ p, label }: { p: ProductPick; label: string }) {
  return (
    <section>
      <div className="section-title">
        {label}: {p.title}
      </div>
      <p className="small" style={{ margin: 0 }}>
        {PILLAR_LABEL[p.pillar]} · {p.offer}
      </p>
      <p className="small" style={{ margin: "4px 0 0" }}>
        <strong>Biggest risk:</strong> {p.risk}
      </p>
    </section>
  );
}

export function ProductLabFull({ reports, current, onPick, error }: { reports: StoredReport[]; current: StoredReport<ProductLabReport>; onPick: (id: number) => void; error: string | null }) {
  const r = current.body;
  return (
    <div className="agent-reports">
      <div className="report-head">
        <label className="muted small">
          Report{" "}
          <select value={current.id} onChange={(e) => onPick(Number(e.target.value))} aria-label="Choose a report">
            {reports.map((x, i) => (
              <option key={x.id} value={x.id}>
                {formatDate(x.at)}
                {i === 0 ? " (latest)" : ""}
              </option>
            ))}
          </select>
        </label>
        <span className="muted small">
          {r.month} · {r.topic} · {r.model} · {status(r)}
        </span>
        {r.notion_url && (
          <ExternalLink href={r.notion_url}>
            <Icon name="external" size={13} /> Notion page
          </ExternalLink>
        )}
        {error && <span className="muted small">Couldn't refresh: {error}</span>}
      </div>
      <Pick p={r.top} label="Top pick" />
      {r.runners_up.map((p, i) => (
        <Pick key={p.title} p={p} label={`Runner-up ${i + 1}`} />
      ))}
      <table className="table runs-table report-table">
        <thead>
          <tr>
            <th>Idea</th>
            {CRITERIA.map((c) => (
              <th key={c.key} title={`${c.weight}%`}>
                {c.label}
              </th>
            ))}
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {[...r.scorecard]
            .sort((a, b) => b.total - a.total)
            .map((row) => (
              <tr key={row.idea}>
                <td>
                  <strong>{row.idea}</strong>
                </td>
                {CRITERIA.map((c) => (
                  <td key={c.key} className="mono">
                    {row[c.key]}
                  </td>
                ))}
                <td>
                  <span className="report-score">{row.total.toFixed(2)}</span>
                </td>
              </tr>
            ))}
        </tbody>
      </table>
      <div className="muted small">Scored 1 to 5. Weights: {CRITERIA.map((c) => `${c.label.toLowerCase()} ${c.weight}%`).join(", ")}. Atlas recomputed every total.</div>
      {r.change_since_last_month && (
        <section>
          <div className="section-title">Change since last month</div>
          <p className="small">{r.change_since_last_month}</p>
        </section>
      )}
      <section>
        <div className="section-title">30-day validation plan</div>
        <ol className="reg-list">
          {r.plan.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ol>
      </section>
      <section>
        <div className="section-title">Success metrics</div>
        <ul className="reg-list">
          {r.metrics.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      </section>
      {r.evidence.length > 0 && (
        <section>
          <div className="section-title">Demand evidence</div>
          <ul className="reg-list">
            {r.evidence.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </section>
      )}
      <section>
        <div className="section-title">Sources</div>
        <ul className="reg-list">
          {r.sources.map((s) => (
            <li key={s.url}>
              <ExternalLink href={s.url}>{s.label}</ExternalLink>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
