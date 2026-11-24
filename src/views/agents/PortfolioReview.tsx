import { useMemo, useState } from "react";
import { catalog as bundledCatalog } from "../../catalog";
import type { Catalog } from "../../catalog/types";
import { AgentIdentityLine } from "../../components/AgentIdentity";
import { CopyButton } from "../../components/bits";
import { load, save } from "../../lib/storage";
import { identityFor } from "../../registry/identity";
import { implementationBrief, REC_STATUSES, REVIEW_COORDINATOR, reviewPortfolio, type EntryStatus, type Recommendation, type RecStatus } from "../../registry/portfolioReview";
import type { RegistryEntry } from "../../registry/registry";

const KEY = "portfolioReviewDecisions";
const STATUS_LABEL: Record<RecStatus, string> = { proposed: "Proposed", approved: "Approved", deferred: "Deferred", implemented: "Implemented" };
const ENTRY_LABEL: Record<EntryStatus, string> = { active: "Active", inactive: "Inactive", planned: "Planned", archived: "Archived" };
const PAGE = 20;

/**
 * Agent portfolio review in the Agents tab. Read-only: it reads the registry Atlas already has and
 * changes nothing. A decision (approve, defer, implemented) is kept on this device only; approving
 * just reveals a brief to paste into Claude, which then opens a draft pull request for Khaneil.
 */
export function PortfolioReview({ catalog, entries, open }: { catalog: Catalog; entries: RegistryEntry[]; open: (id: string) => void }) {
  const review = useMemo(() => reviewPortfolio(catalog, entries), [catalog, entries]);
  const [decisions, setDecisions] = useState<Record<string, RecStatus>>(() => load(KEY, {}));
  const [show, setShow] = useState<RecStatus | "all">("proposed");
  const [limit, setLimit] = useState(PAGE);
  const statusOf = (r: Recommendation) => decisions[r.id] ?? "proposed";
  const decide = (id: string, s: RecStatus) =>
    setDecisions((d) => {
      const next = { ...d, [id]: s };
      if (s === "proposed") delete next[id];
      save(KEY, next);
      return next;
    });
  const counts = Object.fromEntries(REC_STATUSES.map((s) => [s, review.recommendations.filter((r) => statusOf(r) === s).length])) as Record<RecStatus, number>;
  const list = review.recommendations.filter((r) => show === "all" || statusOf(r) === show);
  const lead = identityFor(REVIEW_COORDINATOR, bundledCatalog.agents);

  return (
    <div className="portfolio portfolio-review">
      <div className="card card-pad">
        <AgentIdentityLine identity={lead} size={38} />
        <p className="small" style={{ marginBottom: 6 }}>
          Reviewed {review.entries.length} registry entries: {(Object.keys(ENTRY_LABEL) as EntryStatus[]).map((s) => `${review.byStatus[s]} ${ENTRY_LABEL[s].toLowerCase()}`).join(", ")}. {review.recommendations.length} recommendations from the catalog and the runs Atlas already observed.
        </p>
        <p className="muted small" style={{ margin: 0 }}>
          Read-only. The review changes no agent, automation, permission, credential or setting. Evidence lists only what the catalog and live sources show; "Not documented" means it isn't there. Your decisions stay on this device. Approving a recommendation only reveals a Claude brief to copy.
        </p>
      </div>

      <div className="seg role-views" role="tablist" aria-label="Recommendation status" style={{ marginTop: 12 }}>
        {([...REC_STATUSES, "all"] as const).map((s) => (
          <button key={s} role="tab" aria-selected={show === s} className={show === s ? "on" : ""} onClick={() => { setShow(s); setLimit(PAGE); }}>
            {s === "all" ? `All ${review.recommendations.length}` : `${STATUS_LABEL[s]} ${counts[s]}`}
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <div className="card empty" style={{ marginTop: 12 }}>No {show === "all" ? "" : STATUS_LABEL[show].toLowerCase()} recommendations.</div>
      ) : (
        <ul className="list review-recs" style={{ padding: 0, marginTop: 12 }}>
          {list.slice(0, limit).map((r) => (
            <RecCard key={r.id} r={r} status={statusOf(r)} decide={(s) => decide(r.id, s)} open={() => open(r.agentId)} />
          ))}
        </ul>
      )}
      {list.length > limit && (
        <button className="btn small" style={{ marginTop: 8 }} onClick={() => setLimit((n) => n + PAGE)}>
          Show {Math.min(PAGE, list.length - limit)} more of {list.length - limit}
        </button>
      )}

      <details className="card card-pad" style={{ marginTop: 16 }}>
        <summary className="section-title">All {review.entries.length} entries reviewed</summary>
        <ul className="list" style={{ padding: 0 }}>
          {review.entries.map((e) => (
            <li key={e.id} className="small review-entry">
              <button className="text-btn" onClick={() => open(e.id)}>{e.title}</button> <span className="chip">{ENTRY_LABEL[e.status]}</span> <span className="muted">{e.recommendations ? `${e.recommendations} recommendations` : "Nothing to recommend"}</span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function RecCard({ r, status, decide, open }: { r: Recommendation; status: RecStatus; decide: (s: RecStatus) => void; open: () => void }) {
  return (
    <li className="card card-pad review-rec" style={{ marginBottom: 10 }}>
      <div className="review-rec-head">
        <span className="chip">{r.area}</span>
        <button className="text-btn" onClick={open}>{r.agentTitle}</button>
        <span className="chip">{ENTRY_LABEL[r.agentStatus]}</span>
        <span className="muted small">{STATUS_LABEL[status]} · {r.confidence} confidence</span>
      </div>
      <div className="title" style={{ margin: "6px 0" }}>{r.change}</div>
      <div className="small">
        <b>Observed</b>
        <ul style={{ margin: "2px 0 6px", paddingLeft: 18 }}>
          {r.evidence.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
        <div><b>Benefit:</b> {r.benefit}</div>
        <div><b>Risk:</b> {r.risk}</div>
        <div><b>Depends on:</b> {r.dependencies.length ? r.dependencies.join("; ") : "None noted"}</div>
      </div>
      <div className="review-rec-actions">
        {status !== "approved" && <button className="btn small primary" onClick={() => decide("approved")}>Approve</button>}
        {status !== "deferred" && status !== "implemented" && <button className="btn small" onClick={() => decide("deferred")}>Defer</button>}
        {status === "approved" && <button className="btn small" onClick={() => decide("implemented")}>Mark implemented</button>}
        {status !== "proposed" && <button className="text-btn small" onClick={() => decide("proposed")}>Back to proposed</button>}
      </div>
      {status === "approved" && (
        <div className="review-brief">
          <div className="review-rec-head">
            <span className="small"><b>Claude implementation brief</b></span>
            <CopyButton text={() => implementationBrief(r)} label="Copy brief" title="Copies the brief to paste into Claude. Nothing runs until you paste it." />
          </div>
          <pre className="selectable">{implementationBrief(r)}</pre>
        </div>
      )}
    </li>
  );
}
