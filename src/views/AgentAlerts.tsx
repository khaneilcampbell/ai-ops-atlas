import { useEffect, useState } from "react";
import { Icon } from "../components/Icon";
import { ALERTING, STATE_LABEL, type Watch } from "../alerts/alerts";
import { permission, requestPermission, type Permission } from "../alerts/notify";
import { dismiss, setNotifyOn, useAlerts, useNotifyOn } from "../alerts/state";
import { relative } from "../lib/time";
import { useAtlas } from "../state";
import "../styles/alerts.css";

/** Mission Control's list of watched agents: what failed, what went quiet, and what can't be known. */
export function AgentAlerts() {
  const { watches, open } = useAlerts();
  const { select } = useAtlas();
  if (!watches.length) return null;
  const openKeys = new Set(open.map((w) => w.key));
  return (
    <section className="card agent-alerts" id="agent-alerts">
      <div className="card-head">
        <h2 className="grow">Agent alerts</h2>
        {open.length > 0 && (
          <button className="text-btn small" onClick={() => dismiss(open.map((w) => w.key!))} title="Hide these until the agent fails or goes silent again">
            Dismiss all
          </button>
        )}
        <span className={`chip ${open.length ? "chip-bad" : ""}`}>
          <Icon name="alert" size={12} /> {open.length ? `${open.length} open` : "None open"}
        </span>
      </div>
      <ul className="list">
        {watches.map((w) => (
          <li key={w.agent.id}>
            <div className={`list-row watch ${w.state}`}>
              <span className={`watch-dot ${w.state}`} aria-hidden />
              <span className="grow">
                <button className="text-btn inline title" onClick={() => select({ kind: "agent", id: w.agent.id })}>
                  {w.agent.name}
                </button>
                <div className="meta" title={w.detail}>
                  {w.detail}
                </div>
              </span>
              <span className={`chip watch-chip ${w.state}`}>{STATE_LABEL[w.state]}</span>
              <span className="muted small nowrap" title={w.last ? new Date(w.last.at).toLocaleString() : "No report on this device"}>
                {w.last ? `Last report ${relative(w.last.at)}` : "No report"}
              </span>
              {w.key && ALERTING.has(w.state) && openKeys.has(w.key) ? (
                <button className="text-btn small" onClick={() => dismiss([w.key!])} title="Hide until the agent fails or goes silent again">
                  Dismiss
                </button>
              ) : (
                <span className="watch-spacer" aria-hidden />
              )}
            </div>
          </li>
        ))}
      </ul>
      <div className="card-foot muted small agent-alerts-foot">
        <span className="grow">
          Watched agents are the ones with an <code>alerts</code> block in their manifest. Failures and silence come from what each agent reports to the live feed; with no feed on this device the state is unknown, never healthy.
        </span>
        <NotifySwitch />
      </div>
    </section>
  );
}

function NotifySwitch() {
  const on = useNotifyOn();
  const [perm, setPerm] = useState<Permission | null>(null);
  useEffect(() => {
    void permission().then(setPerm, () => setPerm("unsupported"));
  }, []);
  if (perm === "unsupported") return <span className="nowrap">System notifications aren't available here</span>;
  if (perm === "denied") return <span className="nowrap" title="Allow notifications for Atlas in the system or browser settings, then reload.">Notifications are blocked</span>;
  const toggle = async () => {
    if (on) return setNotifyOn(false);
    const p = perm === "granted" ? perm : await requestPermission().catch(() => "denied" as const);
    setPerm(p);
    if (p === "granted") setNotifyOn(true);
  };
  return (
    <label className="notify-switch nowrap">
      <input type="checkbox" checked={on && perm === "granted"} onChange={() => void toggle()} />
      Notify me on this device
    </label>
  );
}

/** Header pill: shows only while an alert is open, and opens Mission Control's list. */
export function AlertPill({ open }: { open: Watch[] }) {
  const { setView } = useAtlas();
  if (!open.length) return null;
  const first = open[0];
  const text = open.length === 1 ? `${first.agent.name} ${first.state === "failing" ? "failed" : "is silent"}` : `${open.length} agent alerts`;
  return (
    <button
      className="alert-pill"
      title={open.map((w) => `${w.agent.name}: ${w.detail}`).join("\n")}
      onClick={() => {
        setView("overview");
        setTimeout(() => document.getElementById("agent-alerts")?.scrollIntoView({ block: "start", behavior: "smooth" }), 60);
      }}
    >
      <Icon name="alert" size={13} />
      <span className="alert-text">{text}</span>
    </button>
  );
}
