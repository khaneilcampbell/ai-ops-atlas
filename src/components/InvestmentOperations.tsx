import { connectionState, dataQualityIssues, summarizeChange, SYNTHETIC_SNAPSHOTS } from "../finance/investments";

const STATE_LABEL = { "not-connected": "Not connected", synced: "Synced", stale: "Stale" } as const;

/**
 * Investment Operations Center: connection status and an operational summary. Until a supported
 * read-only source exists it shows only invented preview data, labelled as such. Nothing is
 * fetched, stored or sent; Atlas places no orders and moves no money.
 */
export function InvestmentOperations() {
  const [prev, cur] = SYNTHETIC_SNAPSHOTS;
  const at = new Date(cur.as_of);
  const state = connectionState(null, at);
  const issues = dataQualityIssues(cur, at);
  return (
    <section className="investment-ops" aria-label="Investment operations">
      <div className="section-title">Investment operations</div>
      <dl className="kv">
        <dt>Connection</dt><dd><span className={`chip finance-status ${state}`}>{STATE_LABEL[state]}</span> Read only when connected</dd>
        <dt>Last sync</dt><dd>Never</dd>
        <dt>Stored in Atlas</dt><dd>Nothing. A future sync would keep only the latest summary in memory.</dd>
      </dl>
      <button type="button" className="btn" disabled aria-describedby="investment-connect-why">Connect a read-only source</button>
      <p id="investment-connect-why" className="muted small">Robinhood offers no read-only connection today: its agent connection also allows trading and shares account numbers, so Atlas does not use it.</p>
      <div className="investment-preview" data-synthetic="true">
        <div className="finance-row"><strong>Synthetic preview</strong><span className="chip">Invented data · not your account</span></div>
        <ul className="muted small">{summarizeChange(prev, cur).map((l) => <li key={l}>{l}</li>)}</ul>
        {issues.length > 0 && <><div className="small"><strong>Data checks</strong></div><ul className="muted small">{issues.map((l) => <li key={l}>{l}</li>)}</ul></>}
      </div>
      <p className="muted small">Operational summaries only, not investment advice. Atlas never places, changes or cancels orders, and never moves money.</p>
    </section>
  );
}
