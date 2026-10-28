import { relative } from "../lib/time";
import { useLiveStatus } from "../live/feed";

/** Whether live updates are flowing, and the latest thing they reported. */
export function LivePill() {
  const s = useLiveStatus();
  if (s.state === "off" && !s.message) return null;
  const label = s.state === "live" ? "Live" : s.state === "connecting" ? "Connecting…" : s.state === "error" ? "Live paused" : "Live off";
  const title =
    s.state === "live"
      ? `Checking for new GitHub and agent activity every few seconds${s.checkedAt ? `; last checked ${new Date(s.checkedAt).toLocaleTimeString()}` : ""}.${s.last ? `\nLatest: ${s.last.text} (${relative(s.last.at)})` : "\nNothing has happened since this window opened."}`
      : s.message ?? label;
  return (
    <span className={`live-pill ${s.state}`} title={title} aria-live="polite">
      <span className="dot" />
      {label}
      {s.state === "live" && s.last && <span className="live-last">{s.last.text}</span>}
    </span>
  );
}
