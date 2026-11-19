import "../../styles/intelligence.css";
import { useState } from "react";
import { useIntel } from "../../intelligence/app";
import { applyProposal, giveFeedback, propose, reviewProposal, rollback, suggest } from "../../intelligence/improvement";
import { TIER_LABEL } from "../../intelligence/routing";
import { MEMORY_LABEL, PROPOSAL_LABEL, type Feedback } from "../../intelligence/types";
import { formatDateTime } from "../../lib/timezone";
import { useAtlas } from "../../state";
import { ATLAS, KHANEIL, type StoredTask } from "../../tasks/types";

// Task Center → a task's intelligence: the context it was given, how good its output was, Khaneil's
// rating, and improvement suggestions that become proposals only through Khaneil's review.

const METRIC_LABEL: Record<string, string> = { completion: "Completed", outputValid: "Valid output", evidence: "Evidence", toolSelection: "Right tools", policy: "Policy", reliability: "First-try" };

export function TaskIntelligence({ task }: { task: StoredTask }) {
  const { catalog } = useAtlas();
  const { store, file } = useIntel(catalog);
  const [rating, setRating] = useState<Feedback["rating"] | 0>(0);
  const [note, setNote] = useState("");
  const [appliedIn, setAppliedIn] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const agentId = task.agentId;
  const contexts = file.contexts.filter((c) => c.taskId === task.id);
  const evals = file.evaluations.filter((e) => e.taskId === task.id);
  const finished = task.status === "completed" || task.status === "failed" || task.status === "cancelled";
  if (!agentId || (!contexts.length && !evals.length && !finished)) return null;
  const ctx = contexts[contexts.length - 1];
  const ev = evals[evals.length - 1];
  const suggestions = suggest(file.evaluations, file.feedback, agentId);
  const proposals = file.proposals.filter((p) => p.agentId === agentId && p.state !== "rejected").slice(-5).reverse();
  const versionOf = (proposalId: string) => file.versions.find((v) => v.proposalId === proposalId);
  const say = (r: { ok: boolean; error?: string }, ok: string) => setMsg(r.ok ? ok : (r.error ?? "Not saved."));

  return (
    <>
      <section>
        <div className="section-title">Context used</div>
        {ctx ? (
          <>
            <p className="muted small" style={{ margin: 0 }}>
              Attempt {ctx.attempt} · {ctx.usedTokens} of {ctx.budgetTokens} context tokens · {TIER_LABEL[ctx.route.tier]}
              {ctx.route.model ? ` (${ctx.route.model})` : ""} · {ctx.capabilities.length} tools granted
            </p>
            <ul className="reg-list compact">
              {ctx.items.map((i) => (
                <li key={i.id}>
                  {i.title}{" "}
                  <span className="muted small">
                    · {MEMORY_LABEL[i.category]} · {i.verification}
                    {i.stale ? " · stale" : ""} · {i.source.ref}
                  </span>
                </li>
              ))}
            </ul>
            {Object.keys(ctx.dropped).length > 0 && <p className="muted small">Left out: {Object.entries(ctx.dropped).map(([k, v]) => `${v} ${k}`).join(", ")}.</p>}
          </>
        ) : (
          <p className="muted small" style={{ margin: 0 }}>
            No context recorded. Atlas records it when it sends a step to an agent.
          </p>
        )}
      </section>

      <section>
        <div className="section-title">Output quality</div>
        {ev ? (
          <>
            <p style={{ margin: "0 0 4px" }}>
              <b>{ev.score ?? "—"}</b>
              <span className="muted small"> / 100 · attempt {ev.attempt} · {ev.model} · prompt {ev.promptVersion}</span>
            </p>
            <div className="chips">
              {Object.entries(METRIC_LABEL).map(([k, label]) => {
                const v = ev.metrics[k as keyof typeof ev.metrics];
                return (
                  <span key={k} className="chip">
                    {label} {v === null ? "—" : `${Math.round((v as number) * 100)}%`}
                  </span>
                );
              })}
            </div>
            {ev.flags.length > 0 && (
              <ul className="reg-list compact">
                {ev.flags.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className="muted small" style={{ margin: 0 }}>
            {finished ? "Not evaluated: this task isn't part of a coordinated workflow run." : "Scored when the step finishes."}
          </p>
        )}
      </section>

      {finished && (
        <section>
          <div className="section-title">Human feedback</div>
          {ev?.human ? (
            <p className="small" style={{ margin: 0 }}>
              {"★".repeat(ev.human.rating)}
              {"☆".repeat(5 - ev.human.rating)} {ev.human.note} <span className="muted">· {ev.human.by}, {formatDateTime(ev.human.at)}</span>
            </p>
          ) : null}
          <form
            className="task-artifact-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!rating) return setMsg("Pick a rating.");
              say(giveFeedback(store, { taskId: task.id, agentId, rating, note }, KHANEIL), "Feedback saved.");
              setNote("");
            }}
          >
            <select value={rating} onChange={(e) => setRating(Number(e.target.value) as Feedback["rating"])} aria-label="Rating">
              <option value={0}>Rate…</option>
              {[5, 4, 3, 2, 1].map((r) => (
                <option key={r} value={r}>
                  {r} ★
                </option>
              ))}
            </select>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was good or missing?" aria-label="Feedback note" />
            <button className="btn" type="submit">
              Save
            </button>
          </form>
        </section>
      )}

      <section>
        <div className="section-title">Improvement suggestions</div>
        {suggestions.length === 0 && proposals.length === 0 && <p className="muted small" style={{ margin: 0 }}>None. Suggestions appear after repeated schema failures, thin evidence, over-tier models or low ratings.</p>}
        <ul className="list">
          {suggestions
            .filter((s) => !file.proposals.some((p) => p.agentId === s.agentId && p.title === s.title && p.state === "proposed"))
            .map((s) => (
              <li key={s.title} className="list-row">
                <span className="grow">
                  {PROPOSAL_LABEL[s.kind]}: {s.title}
                  <div className="meta">{s.rationale}</div>
                </span>
                <button className="btn small" onClick={() => say(propose(store, s, ATLAS), "Proposal created for review.")}>
                  Propose
                </button>
              </li>
            ))}
          {proposals.map((p) => {
            const v = versionOf(p.id);
            return (
              <li key={p.id} className="list-row">
                <span className="grow">
                  {PROPOSAL_LABEL[p.kind]}: {p.title} <span className="chip">{p.state.replace("_", " ")}</span>
                  <div className="meta">{p.change}</div>
                  {v && (
                    <div className="meta">
                      Version {v.version} · {v.appliedIn}
                    </div>
                  )}
                </span>
                <span className="row-actions">
                  {p.state === "proposed" && (
                    <>
                      <button className="btn small" onClick={() => say(reviewProposal(store, p.id, KHANEIL, "approved"), "Approved. Apply it where it lives, then record it here.")}>
                        Approve
                      </button>
                      <button className="btn small" onClick={() => say(reviewProposal(store, p.id, KHANEIL, "rejected"), "Rejected.")}>
                        Reject
                      </button>
                    </>
                  )}
                  {p.state === "approved" && (
                    <>
                      <input value={appliedIn} onChange={(e) => setAppliedIn(e.target.value)} placeholder="Where applied (n8n version, PR)" aria-label="Where the change was applied" />
                      <button className="btn small" onClick={() => say(applyProposal(store, p.id, KHANEIL, appliedIn), "Recorded as a new version.")}>
                        Record applied
                      </button>
                    </>
                  )}
                  {p.state === "applied" && v && (
                    <button className="btn small" onClick={() => say(rollback(store, v.id, KHANEIL), "Marked rolled back. Revert it where it was applied.")}>
                      Roll back
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
        <p className="muted small">Agents can suggest prompt, knowledge, workflow and validation changes only. Permissions, security rules, approvals and deployments are never proposed by an agent.</p>
        {msg && <p className="muted small">{msg}</p>}
      </section>
    </>
  );
}
