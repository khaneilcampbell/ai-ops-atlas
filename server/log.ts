// Structured, redacted operational events for the Pages functions. Each line is one JSON object on
// the console, which Cloudflare keeps in the project's Workers logs (no new logging service).
// Nothing here ever writes a credential: keys that name a secret are replaced, and strings that
// look like a token are masked, before anything is printed.

import { secretPatterns } from "../src/lib/secretPatterns";

export type Severity = "debug" | "info" | "warn" | "error";

export interface OpsEvent {
  /** Dotted event name, e.g. "auth.denied", "api.error", "health.check". */
  event: string;
  severity: Severity;
  /** Which part of Atlas produced it, e.g. "pages-functions", "n8n-bridge". */
  service: string;
  /** Correlation id: the same for every line about one request. */
  requestId?: string;
  executionId?: string;
  agentId?: string;
  taskId?: string;
  path?: string;
  method?: string;
  status?: number;
  durationMs?: number;
  detail?: string;
  [extra: string]: unknown;
}

const SECRET_KEY = /(token|secret|password|passwd|authorization|cookie|api[-_]?key|private[-_]?key|jwt|assertion|credential|signature)/i;

export const REDACTED = "[redacted]";
const MAX_STRING = 500;
const MAX_DEPTH = 5;

/** Masks anything in a string that looks like a credential, and caps its length. */
export function redactString(s: string): string {
  let out = s;
  for (const re of secretPatterns()) out = out.replace(re, REDACTED);
  return out.length > MAX_STRING ? `${out.slice(0, MAX_STRING)}…` : out;
}

/** A deep copy safe to print: secret-named keys replaced, token-shaped strings masked. */
export function redact(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return redactString(value);
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = SECRET_KEY.test(k) ? REDACTED : redact(v, depth + 1);
  return out;
}

/** Cloudflare's ray id when there is one (it matches the dashboard's logs), otherwise a fresh id. */
export function requestIdOf(req: Request): string {
  const ray = req.headers.get("cf-ray");
  if (ray && /^[A-Za-z0-9-]{8,64}$/.test(ray)) return ray;
  return crypto.randomUUID();
}

export type Sink = (line: string) => void;
const consoleSink: Sink = (line) => console.log(line);

/** Prints one redacted event as a single JSON line. Never throws. */
export function logEvent(e: OpsEvent, sink: Sink = consoleSink, now = Date.now()): void {
  try {
    sink(JSON.stringify({ at: new Date(now).toISOString(), ...(redact(e) as OpsEvent) }));
  } catch {
    /* logging must never break a request */
  }
}
