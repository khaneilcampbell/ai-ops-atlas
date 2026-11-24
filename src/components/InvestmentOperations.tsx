import { useCallback, useEffect, useState } from "react";
import { connectionState, dataQualityIssues, portfolioName, portfolioTotal, summarizeChange, SYNTHETIC_SNAPSHOTS, usd, type InvestmentSnapshot, type PortfolioKind } from "../finance/investments";
import { disconnectLocalSnapshot, readLocalJournal, readLocalSnapshot, type LocalJournal, type LocalSnapshot } from "../finance/investmentsLocal";
import { TradingDesk } from "./TradingDesk";
import { formatDateTime } from "../lib/timezone";

const STATE_LABEL = { "not-connected": "Not connected", synced: "Synced", stale: "Stale" } as const;
const KIND_LABEL: Record<PortfolioKind, string> = { individual: "Individual", roth_ira: "Roth IRA", traditional_ira: "Traditional IRA", joint: "Joint", custodial: "Custodial", other: "Other" };
const SHOWN_POSITIONS = 8;

/** Per-account cards: label and last four only, value, cash and the largest positions. */
function Portfolios({ snapshot }: { snapshot: InvestmentSnapshot }) {
  return (
    <ul className="investment-portfolios">
      {snapshot.portfolios.map((p) => {
        const top = [...p.positions].sort((a, b) => b.market_value - a.market_value);
        return (
          <li key={p.last4 + p.label} className="investment-portfolio">
            <div className="finance-row">
              <strong>{portfolioName(p)}</strong>
              <span className="chip">{KIND_LABEL[p.kind]}</span>
              {p.agent_tradable && <span className="chip agent-tradable" title="Robinhood lets an agent trade only in this account. Atlas itself never trades.">Agent trading account</span>}
            </div>
            <div className="small">{usd(portfolioTotal(p))} total · {usd(p.cash)} cash · {p.positions.length} positions</div>
            {top.length > 0 && (
              <ul className="muted small">
                {top.slice(0, SHOWN_POSITIONS).map((x) => <li key={x.symbol + x.asset_class}>{x.symbol} · {x.asset_class} · {usd(x.market_value)}</li>)}
                {top.length > SHOWN_POSITIONS && <li>and {top.length - SHOWN_POSITIONS} more</li>}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function SyntheticPreview() {
  const [prev, cur] = SYNTHETIC_SNAPSHOTS;
  const issues = dataQualityIssues(cur, new Date(cur.as_of));
  return (
    <div className="investment-preview" data-synthetic="true">
      <div className="finance-row"><strong>Synthetic preview</strong><span className="chip">Invented data · not your account</span></div>
      <ul className="muted small">{summarizeChange(prev, cur).map((l) => <li key={l}>{l}</li>)}</ul>
      {issues.length > 0 && <><div className="small"><strong>Data checks</strong></div><ul className="muted small">{issues.map((l) => <li key={l}>{l}</li>)}</ul></>}
    </div>
  );
}

/**
 * Investment Operations Center: connection status, a per-account summary and data checks. On the
 * Mac it reads the snapshot Claude Code writes on "sync my investments"; on the website, and before
 * the first sync, it shows only invented preview data, labelled as such. Atlas places no orders and
 * moves no money.
 */
export function InvestmentOperations({ initial, initialJournal, initialTab = "accounts" }: { initial?: LocalSnapshot; initialJournal?: LocalJournal; initialTab?: "accounts" | "desk" } = {}) {
  const [local, setLocal] = useState<LocalSnapshot | null>(initial ?? null);
  const [journal, setJournal] = useState<LocalJournal | null>(initialJournal ?? null);
  const [tab, setTab] = useState(initialTab);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => { setBusy(true); const [s, j] = await Promise.all([readLocalSnapshot(), readLocalJournal()]); setLocal(s); setJournal(j); setBusy(false); }, []);
  useEffect(() => { if (!initial) void refresh(); }, [initial, refresh]);
  const disconnect = async () => { setBusy(true); try { await disconnectLocalSnapshot(); } finally { setConfirming(false); } await refresh(); };

  const now = new Date();
  const snapshot = local?.kind === "ok" ? local.snapshot : null;
  const state = connectionState(snapshot, now);
  const issues = snapshot ? dataQualityIssues(snapshot, now) : [];
  const onMac = local != null && local.kind !== "web";
  const hasFile = local?.kind === "ok" || local?.kind === "refused";
  return (
    <section className="investment-ops" aria-label="Investment operations">
      <div className="section-title">Investment operations</div>
      <div className="investment-tabs" role="tablist" aria-label="Investment operations views">
        <button type="button" role="tab" aria-selected={tab === "accounts"} className={tab === "accounts" ? "on" : ""} onClick={() => setTab("accounts")}>Accounts</button>
        <button type="button" role="tab" aria-selected={tab === "desk"} className={tab === "desk" ? "on" : ""} onClick={() => setTab("desk")}>Trading desk</button>
      </div>
      {tab === "desk" ? <TradingDesk snapshot={snapshot} stale={state === "stale"} journal={journal} /> : <>
      <dl className="kv">
        <dt>Connection</dt><dd><span className={`chip finance-status ${state}`}>{STATE_LABEL[state]}</span> Read only</dd>
        <dt>Last sync</dt><dd>{snapshot ? formatDateTime(snapshot.as_of) : "Never"}</dd>
        <dt>Stored</dt><dd>{local?.kind === "web" ? "Nothing on the website. Account data stays on your Mac." : "One summary file and the agent trade journal on this Mac, both deleted by Disconnect. Account numbers show as the last four only."}</dd>
      </dl>
      {local?.kind === "error" && <p className="small">Couldn't read the snapshot: {local.message}</p>}
      {local?.kind === "refused" && <div className="small"><strong>Snapshot refused</strong><ul className="muted small">{local.errors.map((e) => <li key={e}>{e}</li>)}</ul></div>}
      {snapshot && <>
        <ul className="muted small">{summarizeChange(null, snapshot).map((l) => <li key={l}>{l}</li>)}</ul>
        <Portfolios snapshot={snapshot} />
        {issues.length > 0 && <><div className="small"><strong>Data checks</strong></div><ul className="muted small">{issues.map((l) => <li key={l}>{l}</li>)}</ul></>}
      </>}
      {onMac && <div className="finance-row">
        <button type="button" className="btn" onClick={() => void refresh()} disabled={busy}>Refresh</button>
        {hasFile && !confirming && <button type="button" className="btn" onClick={() => setConfirming(true)} disabled={busy}>Disconnect</button>}
        {confirming && <><span className="small">Delete the snapshot and trade journal from this Mac?</span><button type="button" className="btn" onClick={() => void disconnect()} disabled={busy}>Delete</button><button type="button" className="btn" onClick={() => setConfirming(false)}>Cancel</button></>}
      </div>}
      {onMac && !snapshot && <p className="muted small">To sync, ask Claude on this Mac: “sync my investments”. It reads your Robinhood accounts with trading switched off and writes the summary here{"path" in local ? <>: <code>{local.path}</code></> : null}.</p>}
      {local?.kind === "web" && <p className="muted small">Live account data shows only in the Atlas Mac app.</p>}
      {!snapshot && <SyntheticPreview />}
      </>}
      <p className="muted small">Operational summaries only, not investment advice. Atlas never places, changes or cancels orders, and never moves money.</p>
    </section>
  );
}
