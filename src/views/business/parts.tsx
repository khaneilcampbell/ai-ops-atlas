import type { ReactNode } from "react";
import { Icon } from "../../components/Icon";
import { isMissing, type Metric } from "../../business/dashboard";
import { money } from "../../business/revenue";
import type { GoalDomain, Provenance } from "../../business/types";
import { KHANEIL } from "../../tasks/types";

export const ME = KHANEIL;
export const nowIso = () => new Date().toISOString();
export const today = () => new Date().toISOString().slice(0, 10);
export const pct = (x: number) => `${Math.round(x * 100)}%`;

export const DOMAIN_LABEL: Record<GoalDomain, string> = { revenue: "Revenue", sales: "Sales", marketing: "Marketing", product: "Product", customer: "Customer", operations: "Operations" };

/** A metric, or a plain "Not available" with the reason. */
export function Value<T>({ m, render }: { m: Metric<T>; render: (v: T) => ReactNode }) {
  if (isMissing(m)) return <span className="na biz-missing" title={m.missing}>Not available<small>{m.missing}</small></span>;
  return <>{render(m)}</>;
}

export const moneyList = (rows: { currency: string; cents: number }[]) => (rows.length ? rows.map((r) => money(r.cents, r.currency)).join(" · ") : "0");

export function Tile({ label, children, sub, tone = "" }: { label: string; children: ReactNode; sub?: string; tone?: string }) {
  return (
    <div className={`card tile biz-tile ${tone}`}>
      <div className="eyebrow">{label}</div>
      <div className="num">{children}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

export function ProvChip({ p }: { p: Provenance }) {
  return p === "test" ? <span className="chip biz-test-chip">Test data</span> : null;
}

export function Panel({ title, eyebrow = "Business", onClose, children }: { title: string; eyebrow?: string; onClose: () => void; children: ReactNode }) {
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="panel task-panel" role="dialog" aria-label={title}>
        <div className="panel-head">
          <div className="grow">
            <div className="eyebrow">{eyebrow}</div>
            <h2>{title}</h2>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close" style={{ color: "var(--ink-2)" }}><Icon name="close" /></button>
        </div>
        <div className="panel-body task-form selectable">{children}</div>
      </aside>
    </>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="task-field">
      <span>{label}</span>
      {children}
      {hint && <small className="muted">{hint}</small>}
    </label>
  );
}

/** Real or test, and where the record came from. Real records must name a checkable source. */
export function ProvenanceFields({ provenance, setProvenance, source, setSource, testMode }: { provenance: Provenance; setProvenance: (p: Provenance) => void; source: string; setSource: (s: string) => void; testMode: boolean }) {
  return (
    <div className="task-row">
      <Field label="Kind of record">
        <select value={provenance} onChange={(e) => setProvenance(e.target.value as Provenance)} disabled={testMode}>
          <option value="real">Real</option>
          <option value="test">Test data (never counted)</option>
        </select>
      </Field>
      <Field label="Source" hint={provenance === "real" ? "Where it can be checked, e.g. Stripe dashboard" : undefined}>
        <input value={source} onChange={(e) => setSource(e.target.value)} placeholder={provenance === "real" ? "Required" : "Test data"} />
      </Field>
    </div>
  );
}

export function ErrorLine({ error }: { error: string | null }) {
  return error ? <p className="task-error" role="alert">{error}</p> : null;
}

export function Empty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="card card-pad task-empty">
      <h3>{title}</h3>
      {children}
    </div>
  );
}
