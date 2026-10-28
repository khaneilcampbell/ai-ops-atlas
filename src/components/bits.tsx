import { useEffect, useState } from "react";
import type { Status } from "../catalog/types";
import { copyText } from "../lib/clipboard";
import { Icon } from "./Icon";
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

/**
 * Copies `text()` to the clipboard and says so for a moment. The text is built on click so a
 * long review isn't turned into Markdown on every render.
 */
export function CopyButton({ text, label = "Copy", title, compact }: { text: () => string; label?: string; title?: string; compact?: boolean }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const t = setTimeout(() => setState("idle"), 1800);
    return () => clearTimeout(t);
  }, [state]);
  const shown = state === "copied" ? "Copied" : state === "failed" ? "Couldn't copy" : label;
  return (
    <button
      type="button"
      className={`copy-btn${compact ? " compact" : ""}${state === "copied" ? " done" : ""}`}
      title={state === "failed" ? "Select the text and copy it instead" : (title ?? label)}
      aria-label={compact ? (title ?? label) : undefined}
      onClick={() => copyText(text()).then(() => setState("copied"), () => setState("failed"))}
    >
      <Icon name={state === "copied" ? "check" : "copy"} size={compact ? 12 : 13} />
      {(!compact || state !== "idle") && <span>{shown}</span>}
    </button>
  );
}
