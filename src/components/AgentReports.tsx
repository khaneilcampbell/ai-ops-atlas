import { useState } from "react";
import { formatDate, relative } from "../lib/time";
import { useAgentReports } from "../reports/client";
import { MECHANISM_LABEL, type AgentSpec, type ReportAgent, type StoredReport } from "../reports/model";
import { opportunityPdf, savePdf } from "../reports/pdf";
import { CopyButton, ExternalLink } from "./bits";
import { Icon } from "./Icon";

// An agent's full reports (src/reports), read-only. The full view sits in the agent's profile;
// the compact one in the office panel shows the latest top idea and links to the profile.

const usd = (n: number) => `$${n.toFixed(2)}`;

export function specMarkdown(s: AgentSpec): string {
  return [
    `# Agent spec: ${s.name}`,
    "",
    `For the idea: ${s.idea}`,
    "",
    `- Purpose: ${s.purpose}`,
    `- Trigger: ${s.trigger}`,
    `- Schedule: ${s.schedule}`,
    `- Inputs: ${s.inputs.join("; ")}`,
    `- Outputs: ${s.outputs.join("; ")}`,
    `- Monthly cap: ${usd(s.monthly_cap_usd)}`,
    `- Building: ${s.building}`,
    `- Human approval: ${s.approval_point}`,
  ].join("\n");
}

/** Builds the PDF on this device from the stored report; nothing is sent anywhere. */
function PdfButton({ report }: { report: StoredReport }) {
  const [state, setState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const save = async () => {
    setState("saving");
    try {
      const ok = await savePdf(`opportunity-scout-${report.at.slice(0, 10)}.pdf`, opportunityPdf(report.body, report.at));
      setState(ok ? "saved" : "idle");
    } catch {
      setState("failed");
    }
  };
  return (
    <button className="ghost-btn" onClick={save} disabled={state === "saving"} title="Save this report as a PDF">
      <Icon name="download" size={13} /> {state === "saving" ? "Saving…" : state === "saved" ? "Saved" : state === "failed" ? "Couldn't save, try again" : "Download PDF"}
    </button>
  );
}

function Empty({ state, message }: { state: string; message: string | null }) {
  if (state === "loading") return <div className="muted small">Loading reports…</div>;
  if (message) return <div className="muted small">{message}</div>;
  return <div className="muted small">No reports yet. The next run that finds something new will appear here.</div>;
}

/** The latest top idea, for the office panel. */
export function AgentReportSummary({ agent, onOpen }: { agent: ReportAgent; onOpen: () => void }) {
  const { state, message, reports } = useAgentReports(agent);
  const latest = reports[0];
  if (!latest) return <Empty state={state} message={message} />;
  const r = latest.body;
  const top = r.ideas[0];
  return (
    <div className="report-summary">
      {top ? (
        <>
          <div className="report-top">
            <span className="report-score">{top.score.toFixed(1)}</span>
            <span className="grow">
              <strong>{top.title}</strong>
              <div className="muted small">
                {MECHANISM_LABEL[top.mechanism]} · first dollar in ~{top.days_to_first_dollar} days · {usd(top.monthly_cost_usd)}/mo
              </div>
            </span>
          </div>
          <div className="muted small">
            {r.ideas.length} idea{r.ideas.length === 1 ? "" : "s"}
            {r.spec ? ` · spec: ${r.spec.name}` : ""} · {relative(latest.at)}
          </div>
        </>
      ) : (
        <div className="muted small">The last run had no ideas ({relative(latest.at)}).</div>
      )}
      <button className="text-btn inline" onClick={onOpen}>
        Open full report
      </button>
    </div>
  );
}

/** Every stored report, newest first, with the chosen one in full. */
export function AgentReports({ agent }: { agent: ReportAgent }) {
  const { state, message, reports } = useAgentReports(agent);
  const [picked, setPicked] = useState<number | null>(null);
  const current: StoredReport | undefined = reports.find((r) => r.id === picked) ?? reports[0];
  if (!current) return <Empty state={state} message={message} />;
  const r = current.body;
  return (
    <div className="agent-reports">
      <div className="report-head">
        <label className="muted small">
          Report{" "}
          <select value={current.id} onChange={(e) => setPicked(Number(e.target.value))} aria-label="Choose a report">
            {reports.map((x, i) => (
              <option key={x.id} value={x.id}>
                {formatDate(x.at)}
                {i === 0 ? " (latest)" : ""}
              </option>
            ))}
          </select>
        </label>
        <span className="muted small">
          Read {r.registry.projects} projects and {r.registry.agents} agents · {r.model} · about {usd(r.cost_usd)}
        </span>
        {r.run_url && (
          <ExternalLink href={r.run_url}>
            <Icon name="external" size={13} /> Run on GitHub
          </ExternalLink>
        )}
        <PdfButton key={current.id} report={current} />
        {state === "error" && message && <span className="muted small">Couldn't refresh: {message}</span>}
      </div>

      {r.ideas.length === 0 ? (
        <div className="muted small">This run had no ideas.</div>
      ) : (
        <>
          <table className="table runs-table report-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Idea</th>
                <th>How it earns</th>
                <th>First $</th>
                <th>Cost/mo</th>
                <th title="Revenue, effort, cost, risk: 5 is always best">R · E · C · K</th>
                <th>Score</th>
              </tr>
            </thead>
            <tbody>
              {r.ideas.map((i, n) => (
                <tr key={i.title}>
                  <td>{n + 1}</td>
                  <td>
                    <strong>{i.title}</strong>
                    <div className="muted small">{i.customer}</div>
                  </td>
                  <td>{MECHANISM_LABEL[i.mechanism]}</td>
                  <td>~{i.days_to_first_dollar}d</td>
                  <td>{usd(i.monthly_cost_usd)}</td>
                  <td className="mono">
                    {i.scores.revenue} · {i.scores.effort} · {i.scores.cost} · {i.scores.risk}
                  </td>
                  <td>
                    <span className="report-score">{i.score.toFixed(1)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="muted small">Score = (2 × revenue + effort + cost + risk) ÷ 5, where 5 is always best. Revenue, timing and cost are the model's estimates.</div>

          <div className="report-ideas">
            {r.ideas.map((i, n) => (
              <section key={i.title}>
                <div className="section-title">
                  {n + 1}. {i.title}
                </div>
                <div className="chips">
                  {i.reuses.length ? i.reuses.map((x) => <span key={x} className="chip mono">{x}</span>) : <span className="muted small">Reuses nothing listed</span>}
                </div>
                <p className="small" style={{ margin: "6px 0 0" }}>
                  <strong>Risks:</strong> {i.risks || "None given."}
                </p>
              </section>
            ))}
          </div>
        </>
      )}

      {r.spec && (
        <section className="report-spec">
          <div className="report-spec-head">
            <div className="section-title grow">Agent spec: {r.spec.name}</div>
            <CopyButton text={() => specMarkdown(r.spec!)} label="Copy spec" title="Copy the spec as Markdown, to paste into a build request" compact />
          </div>
          <dl className="kv">
            <dt>For the idea</dt>
            <dd>{r.spec.idea}</dd>
            <dt>Purpose</dt>
            <dd>{r.spec.purpose}</dd>
            <dt>Trigger</dt>
            <dd>{r.spec.trigger}</dd>
            <dt>Schedule</dt>
            <dd>{r.spec.schedule}</dd>
            <dt>Inputs</dt>
            <dd>{r.spec.inputs.join("; ")}</dd>
            <dt>Outputs</dt>
            <dd>{r.spec.outputs.join("; ")}</dd>
            <dt>Monthly cap</dt>
            <dd>{usd(r.spec.monthly_cap_usd)}</dd>
            <dt>Building</dt>
            <dd className="mono">{r.spec.building}</dd>
            <dt>Human approval</dt>
            <dd>{r.spec.approval_point || <span className="na">None given: don't build it until one is added</span>}</dd>
          </dl>
        </section>
      )}

      {r.notes.length > 0 && (
        <section>
          <div className="section-title">Checks</div>
          <ul className="reg-list">
            {r.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
