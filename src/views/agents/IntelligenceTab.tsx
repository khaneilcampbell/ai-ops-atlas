import "../../styles/intelligence.css";
import { useMemo } from "react";
import { formatDateTime } from "../../lib/timezone";
import { useAtlas } from "../../state";
import { useIntel } from "../../intelligence/app";
import { profileFor, routeForStep } from "../../intelligence/benjaire";
import { grantsFor, SIDE_EFFECT_LABEL } from "../../intelligence/capabilities";
import { summarize } from "../../intelligence/evaluation";
import { agentAccess, readProblem } from "../../intelligence/memory";
import { TIER_LABEL } from "../../intelligence/routing";
import { MEMORY_CATEGORIES, MEMORY_INFO, MEMORY_LABEL } from "../../intelligence/types";
import { DEFINITIONS } from "../../workflows/benjaireLaunch";
import { NA } from "./parts";

// Agent Detail → Intelligence: what the agent may know (memory it can read), what it may use
// (granted tools), which model its steps get, how its work has scored and what Khaneil said.

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);

export function hasIntelligence(agentId: string): boolean {
  return grantsFor(agentId).length > 0 || Object.values(DEFINITIONS).some((d) => d.nodes.some((n) => n.agentId === agentId));
}

export function IntelligenceTab({ agentId }: { agentId: string }) {
  const { catalog } = useAtlas();
  const { store, file } = useIntel(catalog);
  const acc = useMemo(() => agentAccess(catalog, agentId), [catalog, agentId]);
  const now = Date.now();
  const readable = useMemo(() => store.memory().filter((m) => readProblem(m, acc, now) === null), [store, file, acc]); // eslint-disable-line react-hooks/exhaustive-deps
  const tools = grantsFor(agentId);
  const steps = Object.values(DEFINITIONS).flatMap((d) => d.nodes.filter((n) => n.agentId === agentId).map((n) => ({ def: d, node: n })));
  const evals = file.evaluations.filter((e) => e.agentId === agentId);
  const overall = summarize(evals, "agentId")[0];
  const byModel = summarize(evals, "model");
  const byPrompt = summarize(evals, "promptVersion");
  const feedback = file.feedback.filter((f) => f.agentId === agentId).slice(-5).reverse();
  const versions = file.versions.filter((v) => v.agentId === agentId).slice(-5).reverse();

  return (
    <div className="intel-tab">
      <section>
        <div className="section-title">Memory sources</div>
        <p className="muted small">
          Reads its building{acc.project ? ` (${catalog.projects.find((p) => p.id === acc.project)?.name ?? acc.project})` : ""}
          {acc.workflows.length ? `, the ${acc.workflows.length} workflow${acc.workflows.length > 1 ? "s" : ""} it takes part in` : ""} and Khaneil&apos;s global policies, up to {acc.clearance} data. Retrieved text reaches the agent as reference data, never as instructions.
        </p>
        <div className="intel-grid">
          {MEMORY_CATEGORIES.map((c) => {
            const mine = readable.filter((m) => m.category === c);
            return (
              <div key={c} className="intel-cell" title={MEMORY_INFO[c]}>
                <b>{mine.length}</b>
                <span>{MEMORY_LABEL[c]}</span>
                <span className="muted small">{mine.filter((m) => m.verification === "verified").length} verified</span>
              </div>
            );
          })}
        </div>
        {readable.length ? (
          <ul className="reg-list compact">
            {readable.slice(0, 6).map((m) => (
              <li key={m.id}>
                {m.title} <span className="muted small">· {MEMORY_LABEL[m.category]} · {m.verification} · {m.source.ref}</span>
              </li>
            ))}
          </ul>
        ) : (
          <NA kind="set" />
        )}
      </section>

      <section>
        <div className="section-title">Available tools</div>
        {tools.length ? (
          <table className="intel-table">
            <thead>
              <tr>
                <th>Tool</th>
                <th>Effect</th>
                <th>Runs through</th>
                <th>Timeout · retries</th>
              </tr>
            </thead>
            <tbody>
              {tools.map((t) => (
                <tr key={t.id} title={t.description}>
                  <td>
                    {t.name}
                    <div className="muted small mono">{t.id}</div>
                  </td>
                  <td data-label="Effect">{SIDE_EFFECT_LABEL[t.sideEffect]}{t.approval ? " · needs approval" : ""}</td>
                  <td data-label="Runs through">{t.adapter}</td>
                  <td data-label="Timeout · retries">
                    {Math.round(t.timeoutMs / 1000)} s · {t.retry.max}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted small">No tools granted through Atlas. It can&apos;t be given work that needs one.</p>
        )}
      </section>

      <section>
        <div className="section-title">Model routing policy</div>
        {steps.length ? (
          <ul className="list">
            {steps.map(({ def, node }) => {
              const r = routeForStep(node, undefined, catalog);
              return (
                <li key={`${def.id}:${node.id}`} className="list-row">
                  <span className="grow">
                    {node.title} · {TIER_LABEL[r.tier]}
                    {r.model ? ` · ${r.model}` : ""}
                    <div className="meta">
                      {profileFor(node.id).taskType.replace("_", " ")} · {r.reasons.join("; ")}
                      {r.held ? ` · ${r.held}` : ""}
                    </div>
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="muted small">Not part of a saved workflow, so no step routes are set.</p>
        )}
      </section>

      <section>
        <div className="section-title">Evaluation metrics</div>
        {overall ? (
          <>
            <div className="intel-grid">
              <div className="intel-cell">
                <b>{overall.avgScore ?? "—"}</b>
                <span>Average score</span>
                <span className="muted small">{overall.count} evaluated</span>
              </div>
              <div className="intel-cell">
                <b>{pct(overall.completionRate)}</b>
                <span>Completed</span>
              </div>
              <div className="intel-cell">
                <b>{pct(overall.validRate)}</b>
                <span>Valid output</span>
              </div>
              <div className="intel-cell">
                <b>${(overall.estimatedUsd + overall.billedUsd).toFixed(2)}</b>
                <span>Model cost</span>
                <span className="muted small">
                  ${overall.estimatedUsd.toFixed(2)} est · ${overall.billedUsd.toFixed(2)} billed
                </span>
              </div>
            </div>
            <p className="muted small">
              By model: {byModel.map((g) => `${g.key} (${g.count}, ${g.avgScore ?? "—"})`).join(" · ")}. By prompt version: {byPrompt.map((g) => `${g.key} (${g.count})`).join(" · ")}.
              {overall.policyBreaches ? ` ${overall.policyBreaches} policy breach${overall.policyBreaches > 1 ? "es" : ""}.` : ""}
            </p>
          </>
        ) : (
          <p className="muted small">No finished steps evaluated yet. Atlas scores each finished step from its recorded results; it doesn&apos;t ask a model to grade.</p>
        )}
      </section>

      <section>
        <div className="section-title">Recent feedback and versions</div>
        {feedback.length || versions.length ? (
          <ul className="list">
            {feedback.map((f) => (
              <li key={f.id} className="list-row">
                <span className="grow">
                  {"★".repeat(f.rating)}
                  {"☆".repeat(5 - f.rating)} {f.note}
                  <div className="meta">
                    {f.by} · {formatDateTime(f.at)}
                  </div>
                </span>
              </li>
            ))}
            {versions.map((v) => (
              <li key={v.id} className="list-row">
                <span className="grow">
                  Version {v.version} · {v.kind.replace("_", " ")}
                  {v.rolledBackAt ? " · rolled back" : ""}
                  <div className="meta">
                    {v.appliedIn} · {v.appliedBy} · {formatDateTime(v.at)}
                  </div>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">No feedback yet. Rate a finished task in the Task Center.</p>
        )}
      </section>
    </div>
  );
}
