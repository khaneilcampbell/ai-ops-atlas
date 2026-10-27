import type { PortfolioSummary, RegistryEntry } from "../../registry/registry";
import { CATEGORIES, CATEGORY_LABEL, CLASSIFICATION_INFO, type Classification } from "../../registry/types";
import { CLASS_COLOR, ClassBadge, OperationalPill } from "./parts";

const TILES: Classification[] = ["A", "B", "C", "D", "E", "F"];

/** Agent Portfolio Overview: what kinds of things are registered, and how much is actually verified. */
export function Portfolio({ entries, summary, open }: { entries: RegistryEntry[]; summary: PortfolioSummary; open: (id: string) => void }) {
  const s = summary;
  const verified = s.operational.verified;
  const failing = s.operational.failing;
  const configured = s.operational.configured;
  const pct = (n: number) => `${(n / Math.max(1, s.total)) * 100}%`;

  return (
    <div className="portfolio">
      <div className="grid tiles reg-tiles">
        <div className="card tile accent">
          <div className="eyebrow">Registered items</div>
          <div className="num">{s.total}</div>
          <div className="sub">Across {new Set(entries.map((e) => e.profile.project.id)).size} projects</div>
        </div>
        {TILES.map((c) => (
          <div key={c} className="card tile">
            <div className="eyebrow">
              <i className="class-dot" style={{ background: CLASS_COLOR[c] }} /> Type {c}
            </div>
            <div className="num">{s.byClass[c]}</div>
            <div className="sub">{CLASSIFICATION_INFO[c].label}</div>
          </div>
        ))}
        {s.byClass.unclassified > 0 && (
          <div className="card tile bad">
            <div className="eyebrow">Unclassified</div>
            <div className="num">{s.byClass.unclassified}</div>
            <div className="sub">No type in the manifest</div>
          </div>
        )}
      </div>

      <div className="card card-pad" style={{ marginTop: 16 }}>
        <div className="section-title">Configured versus verified</div>
        <p className="muted small" style={{ marginTop: 0 }}>
          Verified means Atlas has seen a successful run from a live source. A configuration in a repository is not evidence that something has run. {s.observable} of {s.total} items
          have a live source connected.
        </p>
        <div className="op-bar" role="img" aria-label={`${verified} verified, ${failing} failing, ${configured} configured but not verified`}>
          <span className="op-verified" style={{ width: pct(verified) }} />
          <span className="op-failing" style={{ width: pct(failing) }} />
          <span className="op-configured" style={{ width: pct(configured) }} />
        </div>
        <div className="op-legend">
          <span>
            <i className="op-verified" /> {verified} verified running
          </span>
          <span>
            <i className="op-failing" /> {failing} latest run failed
          </span>
          <span>
            <i className="op-configured" /> {configured} configured, not verified
          </span>
          {s.operational.planned > 0 && <span>{s.operational.planned} planned</span>}
        </div>
      </div>

      <div className="grid two" style={{ marginTop: 16 }}>
        <div className="card card-pad">
          <div className="section-title">By function</div>
          <ul className="cat-bars">
            {[...CATEGORIES, "uncategorized" as const]
              .filter((c) => s.byCategory[c])
              .map((c) => (
                <li key={c}>
                  <span className="grow">{CATEGORY_LABEL[c]}</span>
                  <span className="bar">
                    <i style={{ width: pct(s.byCategory[c]) }} />
                  </span>
                  <span className="n">{s.byCategory[c]}</span>
                </li>
              ))}
          </ul>
          <div className="section-title" style={{ marginTop: 18 }}>
            Goals coverage
          </div>
          <p className="small" style={{ margin: 0 }}>
            {s.withKpis} of {s.total} items have KPIs defined; {s.withObservedKpis} can be measured from connected telemetry.
          </p>
        </div>
        <div className="card card-pad">
          <div className="section-title">Requires review · {s.needsReview.length}</div>
          <EntryList entries={s.needsReview} open={open} detail={(e) => e.review.join(" · ")} empty="Nothing needs review." />
        </div>
      </div>

      <div className="card card-pad" style={{ marginTop: 16 }}>
        <div className="section-title">Missing documentation · {s.missingDocs.length}</div>
        <p className="muted small" style={{ marginTop: 0 }}>
          Profiles with fewer than half of the {entries[0]?.docs.total ?? 14} registry fields documented.
        </p>
        <EntryList entries={s.missingDocs} open={open} detail={(e) => `${e.docs.done} of ${e.docs.total} documented · missing ${e.docs.missing.slice(0, 4).join(", ")}${e.docs.missing.length > 4 ? "…" : ""}`} empty="Every profile is at least half documented." />
      </div>
    </div>
  );
}

function EntryList({ entries, open, detail, empty }: { entries: RegistryEntry[]; open: (id: string) => void; detail: (e: RegistryEntry) => string; empty: string }) {
  if (!entries.length) return <div className="muted small">{empty}</div>;
  return (
    <ul className="list" style={{ padding: 0 }}>
      {entries.map((e) => (
        <li key={e.profile.id}>
          <button className="list-row" onClick={() => open(e.profile.id)}>
            <span className="grow">
              <div className="title">{e.profile.title}</div>
              <div className="meta">{detail(e)}</div>
            </span>
            <ClassBadge c={e.profile.classification} />
            <OperationalPill op={e.operational} />
          </button>
        </li>
      ))}
    </ul>
  );
}
