import { daysUntil, type Incident } from "../properties/incidents";
import type { Deploy } from "../properties/deploys";
import type { WebProperty } from "../properties/registry";
import {
  dismissIncidents,
  refreshSite,
  usePropertyData,
  usePropertyIncidents,
  type Loaded,
} from "../properties/state";
import type { Check } from "../properties/types";
import { relative } from "../lib/time";
import { ExternalLink } from "./bits";
import { Icon } from "./Icon";
import "../styles/properties.css";

// The live dashboard on a website's building: incidents first, then one tile per signal. A tile
// shows what its source said and when; a source that couldn't answer says so, and a source
// that isn't connected yet says what it needs.

const DEPLOY_LABEL: Record<Deploy["state"], string> = {
  success: "Live",
  failure: "Failed",
  in_progress: "Deploying",
  queued: "Queued",
  cancelled: "Cancelled",
};

interface Tile {
  label: string;
  value: string;
  note: string;
  tone?: "good" | "warn" | "bad" | "idle";
  title?: string;
  unchecked?: boolean;
  checkedAt?: string;
  checkError?: boolean;
}

function fromCheck<T>(
  label: string,
  c: Check<T> | undefined,
  loading: boolean,
  ok: (data: T, checkedAt: string) => Omit<Tile, "label">,
): Tile {
  if (!c)
    return {
      label,
      value: loading ? "…" : "–",
      note: loading ? "Checking" : "Not checked on this device",
      tone: "idle",
      unchecked: !loading,
    };
  if (c.state === "not-configured")
    return {
      label,
      value: "Not connected",
      note: `Needs ${c.source}`,
      tone: "idle",
      title: c.need,
    };
  if (c.state === "error")
    return {
      label,
      value: "Unknown",
      note: c.message,
      tone: "idle",
      title: `${c.source}, ${relative(c.checkedAt)}: ${c.message}`,
      checkedAt: c.checkedAt,
      checkError: true,
    };
  return {
    label,
    ...ok(c.data, c.checkedAt),
    title: `${c.source}, checked ${relative(c.checkedAt)}`,
    checkedAt: c.checkedAt,
  };
}

const dayTone = (d: number, warn: number, bad: number): Tile["tone"] =>
  d < bad ? "bad" : d < warn ? "warn" : "good";
const ms = (v: number | null) =>
  v === null
    ? "–"
    : v >= 1000
      ? `${(v / 1000).toFixed(1)} s`
      : `${Math.round(v)} ms`;

function deployTile(p: WebProperty, d: Loaded<Deploy[]>): Tile {
  const label = "Deploys";
  if (d.state === "error" && !d.value)
    return {
      label,
      value: "Unknown",
      note: d.message ?? "GitHub didn't answer",
      tone: "idle",
    };
  const list = d.value;
  if (!list) return { label, value: "…", note: "Reading GitHub", tone: "idle" };
  const newest = list[0];
  if (!newest)
    return {
      label,
      value: "None seen",
      note: `No ${p.deploy.kind === "check-runs" ? `"${p.deploy.name}" check runs on the latest commits` : `${p.deploy.environment} deployments`}`,
      tone: "idle",
    };
  const tone: Tile["tone"] =
    newest.state === "failure"
      ? "bad"
      : newest.state === "success"
        ? "good"
        : "warn";
  return {
    label,
    value: DEPLOY_LABEL[newest.state],
    note: `${newest.sha.slice(0, 7)} · ${relative(newest.finishedAt ?? newest.at)}`,
    tone,
    title: `${newest.label}, GitHub`,
  };
}

export function PropertyDashboard({ property: p, compact = false }: { property: WebProperty; compact?: boolean }) {
  const d = usePropertyData(p.id);
  const { open } = usePropertyIncidents();
  if (!d) return null;
  const now = Date.now();
  const s = d.site.value?.checks;
  const loading = d.site.state === "loading";
  const incidents = open.filter((i) => i.propertyId === p.id);

  const tiles: Tile[] = [
    deployTile(p, d.deploys),
    fromCheck("Reachable now", s?.probe, loading, (x) => ({
      value: x.status < 400 ? `Up · ${x.status}` : `HTTP ${x.status}`,
      note: `${ms(x.ms)} response${x.cloudflare ? " · via Cloudflare" : ""}${x.hsts ? " · HSTS" : ""}`,
      tone: x.status < 400 ? "good" : "bad",
    })),
    fromCheck("Uptime", s?.uptime, loading, (x) => ({
      value: x.uptime24h === null ? "–" : `${x.uptime24h.toFixed(2)}%`,
      note: "Last 24 hours, Uptime Kuma",
      tone: x.up === false ? "bad" : "good",
    })),
    fromCheck("SSL certificate", s?.tls, loading, (x) => {
      const left = daysUntil(x.notAfter, now);
      return {
        value: `${left} days left`,
        note: `${x.issuer ?? "Unknown issuer"} · ends ${x.notAfter.slice(0, 10)}`,
        tone: dayTone(left, 14, 3),
      };
    }),
    fromCheck("Domain", s?.domain, loading, (x) => {
      if (!x.expiresAt)
        return {
          value: "Registered",
          note: "The registry didn't publish an expiry date",
          tone: "idle",
        };
      const left = daysUntil(x.expiresAt, now);
      return {
        value: `${left} days left`,
        note: `${x.registrar ?? "Registrar unknown"} · renews by ${x.expiresAt.slice(0, 10)}`,
        tone: dayTone(left, 30, 7),
      };
    }),
    fromCheck("DNS", s?.dns, loading, (x) => {
      const n = x.a.length + x.aaaa.length;
      const cf = x.ns.some((ns) => ns.endsWith(".ns.cloudflare.com"));
      return {
        value: n ? `${n} address${n === 1 ? "" : "es"}` : "No address",
        note: `${cf ? "Cloudflare nameservers" : (x.ns[0] ?? "No NS records")}${x.mx.length ? " · mail set" : ""}${x.validated ? " · DNSSEC" : ""}`,
        tone: n ? "good" : "bad",
      };
    }),
    fromCheck("Mobile speed", s?.performance, loading, (x) => ({
      value: x.score === null ? "–" : `${x.score} / 100`,
      note: `LCP ${ms(x.lcpMs)}${x.field?.overall ? ` · real users ${x.field.overall.toLowerCase()}` : " · lab test"}`,
      tone:
        x.score === null
          ? "idle"
          : x.score >= 90
            ? "good"
            : x.score >= 50
              ? "warn"
              : "bad",
    })),
    fromCheck("Traffic, 24 h", s?.traffic, loading, (x) =>
      // A DNS-only (grey cloud) record sends visitors straight to the host, so Cloudflare counts nothing.
      s?.probe.state === "ok" && !s.probe.data.cloudflare && x.requests24h === 0
        ? {
            value: "Not proxied",
            note: "DNS only, so visits go straight to the host and Cloudflare can't count them",
            tone: "idle",
          }
        : {
            value: x.requests24h.toLocaleString(),
            note: `requests${x.visits24h !== null ? ` · ${x.visits24h.toLocaleString()} page views` : ""}${x.threats24h ? ` · ${x.threats24h} threats blocked` : ""}`,
            tone: "good",
          },
    ),
    fromCheck("Cloudflare events", s?.edgeEvents, loading, (x) => ({
      value: String(x.length),
      note: x[0]
        ? `${x[0].action} · ${relative(x[0].at)}`
        : "No changes in 7 days",
      tone: "good",
    })),
  ];

  const perf =
    s?.performance.state === "ok" ? s.performance.data.reportUrl : null;
  const headline = incidents.some((i) => i.severity === "critical")
    ? "bad"
    : incidents.length
      ? "warn"
      : "good";

  return (
    <section className={`property${compact ? " property-compact" : ""}`} aria-label={`${p.domain} live dashboard`}>
      <div className="section-head">
        <div className="section-title">Live site · {p.domain}</div>
        <span className={`chip property-chip ${headline}`}>
          {incidents.length
            ? `${incidents.length} incident${incidents.length === 1 ? "" : "s"}`
            : "No incidents"}
        </span>
      </div>
      {incidents.length > 0 && (
        <ul className="property-incidents">
          {incidents.map((i) => (
            <IncidentRow key={i.key} incident={i} />
          ))}
        </ul>
      )}
      {compact && tiles.some(t => t.unchecked) && <p className="small muted property-coverage">{tiles.filter(t => t.unchecked).length} metrics not checked on this device. Site checks need an available connection.</p>}
      {compact && ((d.site.state === "error" && d.site.value) || (d.deploys.state === "error" && d.deploys.value)) && <p className="small notice">Saved results · latest refresh failed. See check details.</p>}
      <div className="insight-grid property-grid">
        {tiles.map((t) => (
          <div
            key={t.label}
            className={`insight property-tile ${t.tone ?? ""}${compact && t.unchecked ? " unchecked" : ""}`}
            title={t.title}
          >
            <div className="label">{t.label}</div>
            <div className="value">{compact && t.unchecked ? "Not checked" : t.value}</div>
            {!(compact && t.unchecked) && <div className="note">{compact && t.checkError ? "Check failed · details below" : compact && t.checkedAt ? relative(t.checkedAt) : t.note}</div>}
          </div>
        ))}
      </div>
      <div className="property-foot muted small">
        {compact ? <details className="property-sources grow">
          <summary>Sources and check details{tiles.some(t => t.checkError) || d.site.state === "error" || d.deploys.state === "error" ? " · check errors" : ""}</summary>
          <p>{d.deploys.state === "error" ? `Deploy check: ${d.deploys.message} · ` : ""}{p.host} · deploys from GitHub{d.site.at ? ` · site checks ${relative(d.site.at)}` : ""}{d.site.state === "off" || d.site.state === "error" ? ` · ${d.site.message}` : ""}</p>
          <ul>{tiles.filter(t => !t.unchecked).map(t => <li key={t.label}><b>{t.label}:</b> {t.note}{t.title ? ` · ${t.title}` : ""}</li>)}</ul>
        </details> : (
        <span className="grow">
          {p.host} · deploys from GitHub
          {d.site.at ? ` · site checks ${relative(d.site.at)}` : ""}
          {d.site.state === "off" || d.site.state === "error"
            ? ` · ${d.site.message}`
            : ""}
        </span>
        )}
        <span className="property-links">
          <ExternalLink href={p.url}>
            <Icon name="external" size={12} /> Site
          </ExternalLink>
          <ExternalLink href={p.deployConsole.url}>
            <Icon name="external" size={12} /> {p.deployConsole.label}
          </ExternalLink>
          {perf && (
            <ExternalLink href={perf}>
              <Icon name="external" size={12} /> PageSpeed
            </ExternalLink>
          )}
          {d.site.state !== "off" && (
            <button
              className="text-btn small"
              onClick={() => void refreshSite(p)}
              disabled={loading}
            >
              Check now
            </button>
          )}
        </span>
      </div>
    </section>
  );
}

function IncidentRow({ incident: i }: { incident: Incident }) {
  return (
    <li className={`property-incident ${i.severity}`}>
      <div className="property-incident-head">
        <Icon name="alert" size={13} />
        <strong className="grow">{i.title}</strong>
        <span className="muted small nowrap">{relative(i.since)}</span>
      </div>
      <p>{i.detail}</p>
      <div className="property-actions">
        {i.actions.map((a) => (
          <ExternalLink
            key={a.label}
            href={a.url}
            className={
              a.label === "Fix with Claude" ? "ghost-btn small" : undefined
            }
          >
            {a.label} ↗
          </ExternalLink>
        ))}
        <button
          className="text-btn small"
          onClick={() => dismissIncidents([i.key])}
          title="Hide until it happens again"
        >
          Dismiss
        </button>
      </div>
    </li>
  );
}

/** Header pill: shows only while a website incident is open, and opens that site's building. */
