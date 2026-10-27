import type { Status } from "../catalog/types";
import type { Health, HealthIndicator } from "../lib/derive";

const STATUS_LABEL: Record<Status, string> = {
  active: "Active",
  idle: "Idle",
  paused: "Paused",
  attention: "Needs attention",
  retired: "Retired",
};

export function StatusPill({ status }: { status: Status }) {
  return <span className={`status ${status}`}>{STATUS_LABEL[status]}</span>;
}

export function statusLabel(s: Status) {
  return STATUS_LABEL[s];
}

export function HealthDot({ health, label }: { health: Health; label?: string }) {
  return (
    <span className="health" title={label}>
      <i className={`h-${health}`} />
      {label}
    </span>
  );
}

const HEALTH_LABEL: Record<Health, string> = { good: "Healthy", warn: "Needs a look", bad: "Failing", unknown: "Not verified" };

/** Overall repository health, worded for a badge. */
export function HealthBadge({ health }: { health: Health }) {
  return (
    <span className={`health-badge hb-${health}`} title="Checked against GitHub: CI, push recency, open issues and license">
      <i className={`h-${health}`} />
      {HEALTH_LABEL[health]}
    </span>
  );
}

export function Indicator({ ind }: { ind: HealthIndicator }) {
  return (
    <span className="health" title={ind.label}>
      <i className={`h-${ind.health}`} />
      <span className="muted">{ind.label}</span> {ind.value}
    </span>
  );
}

// GitHub linguist colors for the languages likely to appear here.
export const LANG_COLORS: Record<string, string> = {
  Python: "#3572A5",
  TypeScript: "#3178c6",
  JavaScript: "#f1e05a",
  HTML: "#e34c26",
  CSS: "#563d7c",
  Shell: "#89e051",
  Rust: "#dea584",
  Go: "#00ADD8",
};

export function LangDot({ lang }: { lang: string | null }) {
  if (!lang) return <span className="muted small">No language</span>;
  return (
    <span className="health">
      <i className="lang-dot" style={{ background: LANG_COLORS[lang] ?? "var(--sage-400)" }} />
      {lang}
    </span>
  );
}

export function ExternalLink({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <a href={href} className={className} target="_blank" rel="noreferrer noopener" onClick={(e) => openExternal(e, href)}>
      {children}
    </a>
  );
}

/** In the desktop app, open links in the default browser instead of the web view. */
export function openExternal(e: React.MouseEvent, href: string) {
  if (!("__TAURI_INTERNALS__" in window)) return;
  e.preventDefault();
  void import("@tauri-apps/plugin-opener").then((m) => m.openUrl(href));
}
