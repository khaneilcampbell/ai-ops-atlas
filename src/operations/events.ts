import { redact } from "../executive/store";
import { EVENT_SYSTEMS, EVENT_TYPES, SEVERITIES, SOURCE_IDENTITIES, type EventSystem, type OpsEvent, type OpsEventType, type SafePayload, type Severity, type SourceIdentity } from "./types";

// Normalized operational events: schema validation and source trust. Every event Atlas acts on
// passes both. Payloads are flattened to short primitives and redacted, so a hostile body can't
// carry instructions, secrets or bulk data into incidents, tasks or audit history.

/**
 * Which identities may speak for which system. An agent pipeline's key can report agent runs but
 * can never claim to be GitHub or n8n; only Atlas's own reads speak for integrations and budgets.
 */
export const TRUSTED: Record<EventSystem, readonly SourceIdentity[]> = {
  github: ["github-webhook", "github-api"],
  n8n: ["n8n-api"],
  cloudflare: ["cloudflare-api"],
  atlas: ["atlas-local", "atlas-sync"],
  agent: ["agent-feed", "atlas-sync", "github-api", "atlas-local"],
  integration: ["atlas-local"],
  budget: ["atlas-local"],
  goal: ["atlas-local"],
};

export const MAX_PAYLOAD_KEYS = 12;
export const MAX_TEXT = 300;
const ID = /^[A-Za-z0-9._:/@#-]{1,200}$/;

export type Checked = { ok: true; event: OpsEvent } | { ok: false; error: string };

const isIso = (s: unknown): s is string => typeof s === "string" && s.length <= 40 && !Number.isNaN(Date.parse(s));
const httpsUrl = (s: unknown): s is string => {
  if (typeof s !== "string" || s.length > 500) return false;
  try {
    return new URL(s).protocol === "https:";
  } catch {
    return false;
  }
};

/** Short text: redacted, single-line, bounded. */
export const safeText = (s: string, max = MAX_TEXT) => redact(s).replace(/\s+/g, " ").trim().slice(0, max);

function cleanPayload(p: unknown): SafePayload | string {
  if (p === undefined) return {};
  if (!p || typeof p !== "object" || Array.isArray(p)) return "payload must be a flat object";
  const out: SafePayload = {};
  const entries = Object.entries(p as Record<string, unknown>);
  if (entries.length > MAX_PAYLOAD_KEYS) return `payload has more than ${MAX_PAYLOAD_KEYS} fields`;
  for (const [k, v] of entries) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,40}$/.test(k)) return `payload field "${k.slice(0, 40)}" isn't allowed`;
    if (v === null || typeof v === "boolean") out[k] = v;
    else if (typeof v === "number") {
      if (!Number.isFinite(v)) return `payload field "${k}" isn't a finite number`;
      out[k] = v;
    } else if (typeof v === "string") out[k] = safeText(v);
    else return `payload field "${k}" must be text, a number, true/false or null`;
  }
  return out;
}

/** Strict schema check. Unknown fields are dropped, never trusted. */
export function validateEvent(raw: unknown): Checked {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Not an event object." };
  const r = raw as Record<string, unknown>;
  if (!EVENT_SYSTEMS.includes(r.system as EventSystem)) return { ok: false, error: "Unknown source system." };
  if (!EVENT_TYPES.includes(r.type as OpsEventType)) return { ok: false, error: "Unknown event type." };
  if (!SEVERITIES.includes(r.severity as Severity)) return { ok: false, error: "Unknown severity." };
  if (!SOURCE_IDENTITIES.includes(r.identity as SourceIdentity)) return { ok: false, error: "Unknown source identity." };
  for (const f of ["id", "correlationId", "resource", "dedupKey"] as const) if (typeof r[f] !== "string" || !ID.test(r[f] as string)) return { ok: false, error: `Bad ${f}.` };
  if (r.project !== null && (typeof r.project !== "string" || !ID.test(r.project))) return { ok: false, error: "Bad project." };
  if (!isIso(r.at)) return { ok: false, error: "Bad timestamp." };
  if (r.artifactUrl !== undefined && !httpsUrl(r.artifactUrl)) return { ok: false, error: "Evidence links must be https." };
  const payload = cleanPayload(r.payload);
  if (typeof payload === "string") return { ok: false, error: payload };
  return {
    ok: true,
    event: {
      id: r.id as string,
      system: r.system as EventSystem,
      type: r.type as OpsEventType,
      project: (r.project as string | null) ?? null,
      correlationId: r.correlationId as string,
      at: new Date(r.at as string).toISOString(),
      severity: r.severity as Severity,
      identity: r.identity as SourceIdentity,
      resource: r.resource as string,
      dedupKey: r.dedupKey as string,
      payload,
      ...(r.artifactUrl ? { artifactUrl: r.artifactUrl as string } : {}),
    },
  };
}

/** Source trust: the identity must be one allowed to speak for the system it claims. */
export function authenticateEvent(e: Pick<OpsEvent, "system" | "identity">): string | null {
  return TRUSTED[e.system].includes(e.identity) ? null : `${e.identity} can't report ${e.system} events.`;
}

/** Validate, then authenticate. The only way an event enters operations state. */
export function admitEvent(raw: unknown): Checked {
  const v = validateEvent(raw);
  if (!v.ok) return v;
  const bad = authenticateEvent(v.event);
  return bad ? { ok: false, error: bad } : v;
}

/** A stable, short id from the dedup key (FNV-1a), so the same event always gets the same id. */
export function eventId(dedupKey: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < dedupKey.length; i++) {
    h ^= dedupKey.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `ev_${h.toString(36)}_${dedupKey.length.toString(36)}`;
}

export type EventInput = Omit<OpsEvent, "id" | "payload"> & { payload?: SafePayload };

/** Builds an event with its stable id. Callers still pass it through admitEvent. */
export const makeEvent = (e: EventInput): OpsEvent => ({ ...e, id: eventId(e.dedupKey), payload: e.payload ?? {} });
