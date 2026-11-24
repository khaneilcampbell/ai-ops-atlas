import { portfolioName, portfolioTotal, usd, type InvestmentSnapshot } from "../finance/investments";
import { type LocalJournal } from "../finance/investmentsLocal";
import { agentAccount, deskAlerts, SYNTHETIC_DESK_SNAPSHOT, SYNTHETIC_JOURNAL, TEAM, tradedThisWeek, TRADING_LIMITS, weeklyReport, type Journal, type Status } from "../finance/tradingDesk";
import { formatDateTime } from "../lib/timezone";

const STATUS_LABEL: Record<Status, string> = { proposed: "Proposed", blocked: "Blocked", submitted: "Sent", filled: "Filled", rejected: "Rejected", cancelled: "Cancelled" };
const STATUS_TONE: Record<Status, string> = { proposed: "", blocked: "warn", submitted: "", filled: "good", rejected: "bad", cancelled: "" };
const SHOWN_ENTRIES = 10;

/**
 * Trading desk: the agent trading account, Khaneil's limits, alerts, the six-seat team and the
 * trade journal. Read only: no buy, sell or cancel controls. Only the Trade Desk seat (a Claude
 * Code session Khaneil runs) can trade, and only in the Agentic account. On the website, or before
 * the first sync, it shows invented data, labelled as such.
 */
export function TradingDesk({ snapshot, stale, journal, now = new Date() }: { snapshot: InvestmentSnapshot | null; stale: boolean; journal: LocalJournal | null; now?: Date }) {
  const synthetic = !snapshot;
  const accounts = snapshot ?? SYNTHETIC_DESK_SNAPSHOT;
  const log: Journal = journal?.kind === "ok" ? journal.journal : synthetic ? SYNTHETIC_JOURNAL : { entries: [] };
  // Synthetic data is dated in the past; measure it against its own time so the preview reads like a live week.
  const at = synthetic ? new Date(SYNTHETIC_DESK_SNAPSHOT.as_of) : now;
  const agentic = agentAccount(accounts);
  const others = accounts.portfolios.filter((p) => !p.agent_tradable);
  const used = tradedThisWeek(log, at);
  const left = Math.max(0, TRADING_LIMITS.weekly_max - used);
  const alerts = deskAlerts(snapshot, stale, log, at);
  const report = weeklyReport(log, at);
  return (
    <div className="trading-desk" data-synthetic={synthetic ? "true" : undefined}>
      <p className="trading-off small"><strong>Trading is off in Atlas.</strong> Atlas has no buy, sell or cancel buttons. When you switch trading on, only the Trade Desk (Claude Code, run by you) can place orders, and only in the Agentic account.</p>
      {synthetic && <div className="finance-row"><strong>Preview</strong><span className="chip">Invented data · not your account</span></div>}

      <div className="trading-grid">
        <div className="trading-card">
          <div className="finance-row"><strong>{agentic ? portfolioName(agentic) : "Agent trading account"}</strong><span className="chip agent-tradable">Agent trading account</span></div>
          {agentic ? <dl className="kv">
            <dt>Value</dt><dd>{usd(portfolioTotal(agentic))}</dd>
            <dt>Cash</dt><dd>{usd(agentic.cash)}</dd>
            <dt>Holdings</dt><dd>{agentic.positions.length ? agentic.positions.map((x) => `${x.symbol} ${usd(x.market_value)}`).join(" · ") : "None"}</dd>
            <dt>Last sync</dt><dd>{formatDateTime(accounts.as_of)}{!synthetic && stale ? " · Stale" : ""}</dd>
          </dl> : <p className="muted small">Not in the latest snapshot.</p>}
        </div>
        <div className="trading-card">
          <div className="finance-row"><strong>Limits</strong><span className="chip">Set by you</span></div>
          <dl className="kv">
            <dt>Per week</dt><dd>{usd(TRADING_LIMITS.weekly_max)} of agent trades · {usd(left)} left</dd>
            <dt>Allowed</dt><dd>Stocks and ETFs only</dd>
            <dt>Account</dt><dd>Agentic only</dd>
          </dl>
          <div className="trading-meter" role="meter" aria-label="Weekly limit used" aria-valuemin={0} aria-valuemax={TRADING_LIMITS.weekly_max} aria-valuenow={used}><i style={{ width: `${Math.min(100, (used / TRADING_LIMITS.weekly_max) * 100)}%` }} /></div>
          <p className="muted small">Counts sent orders, buys and sells, over the last 7 days.</p>
        </div>
        <div className="trading-card">
          <div className="finance-row"><strong>Alerts</strong></div>
          <ul className="trading-alerts small">{alerts.map((a) => <li key={a.text} className={a.level}>{a.text}</li>)}</ul>
        </div>
      </div>

      <div className="section-title">Trading team</div>
      <ul className="trading-team">
        {TEAM.map((s) => (
          <li key={s.id} data-seat={s.id}>
            <strong>{s.name}</strong>
            <span className="small muted">{s.role}</span>
            <span className="finance-row">
              <span className="chip">{s.can_trade ? "Can trade · off" : "Read only"}</span>
              <span className="chip muted-chip">{s.uses_ai ? "Uses AI" : "No AI"}</span>
            </span>
          </li>
        ))}
      </ul>

      <div className="section-title">Agent trade log</div>
      {journal?.kind === "refused" && <div className="small"><strong>Journal refused</strong><ul className="muted small">{journal.errors.map((e) => <li key={e}>{e}</li>)}</ul></div>}
      {journal?.kind === "error" && <p className="small">Couldn't read the journal: {journal.message}</p>}
      {log.entries.length === 0 ? <p className="muted small">No agent trades yet.</p> : (
        <div className="trading-log-wrap">
          <table className="trading-log small">
            <thead><tr><th>When</th><th>Order</th><th>Check</th><th>Result</th><th>Why</th></tr></thead>
            <tbody>
              {log.entries.slice(0, SHOWN_ENTRIES).map((e, i) => (
                <tr key={e.at + i}>
                  <td>{formatDateTime(e.at)}</td>
                  <td>{e.side === "buy" ? "Buy" : "Sell"} {usd(e.amount)} {e.symbol}</td>
                  <td>{e.check === "passed" ? "Passed" : "Blocked"}</td>
                  <td><span className={`chip trading-status ${STATUS_TONE[e.status]}`}>{STATUS_LABEL[e.status]}</span></td>
                  <td className="muted">{e.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small">Last 7 days: {report.trades} sent order{report.trades === 1 ? "" : "s"}, {usd(report.bought)} bought, {usd(report.sold)} sold.</p>

      {others.length > 0 && <>
        <div className="section-title">Other accounts</div>
        <ul className="muted small">{others.map((p) => <li key={p.last4 + p.label}>{portfolioName(p)} · {usd(portfolioTotal(p))} · view only, agents never trade here</li>)}</ul>
      </>}
    </div>
  );
}
