// The n8n workflows Atlas may start, and what each one accepts. Shared by the site (which enforces
// it: server/n8nStart.ts) and the app (which draws the form from it). This file is in a public
// repository on purpose and holds no secret. A workflow's webhook is protected by a short-lived
// token the site signs with N8N_START_SECRET (a Pages secret, also saved in n8n as the
// "Atlas start (JWT)" credential), not by its path.
//
// Adding a workflow here is not enough to start it: it also needs an "Atlas Start" webhook with
// JWT auth and the "Verify Atlas Start" check in n8n, and it must be published there.

export type StartFieldKind = "text" | "textarea" | "url" | "choice" | "number";

export interface StartField {
  name: string;
  label: string;
  kind: StartFieldKind;
  required?: boolean;
  /** Longest text kept. Longer text is refused, never cut. */
  max?: number;
  /** Shortest text accepted (text fields), or smallest number (number fields). */
  min?: number;
  /** Largest number (number fields). */
  maxValue?: number;
  options?: readonly { value: string; label: string }[];
  placeholder?: string;
  hint?: string;
  default?: string;
}

export interface StartableWorkflow {
  /** Short key: in the webhook path, the token's audience and the URL. Lowercase letters and dashes. */
  key: string;
  /** The n8n workflow id. */
  workflowId: string;
  /** The workflow's name in n8n, for the confirm step and the Mac's Touch ID prompt. */
  name: string;
  /** What starting it does, in plain words. */
  does: string;
  /** What it never does, so the confirm step can say so. */
  never: string;
  fields: readonly StartField[];
  /** At most this many starts of this workflow in 24 hours, whoever asks. */
  dailyCap: number;
  /** A rule across fields; null when the input is fine. */
  check?: (input: Readonly<Record<string, string | number>>) => string | null;
}

/** At most this many starts across every workflow in 24 hours. */
export const TOTAL_DAILY_CAP = 10;
/** The site gives up on n8n after this long. A start that times out is "unknown", never retried by itself. */
export const START_TIMEOUT_MS = 15_000;
/** A signed token is good for this long. n8n refuses it after. */
export const TOKEN_TTL_SEC = 120;
export const KEEP_DAYS = 30;
/** Most bytes of input one start can carry. */
export const MAX_INPUT_BYTES = 32_000;

export const STARTABLE: readonly StartableWorkflow[] = [
  {
    key: "career-job",
    workflowId: "Zd379gPsiCcBQfwo",
    name: "Career · Execution Agent",
    does: "Drafts a tailored resume and cover letter for one job from your confirmed facts, and emails you the Word and PDF copies to review.",
    never: "It never applies, and never messages the company or a recruiter. Its own $3 a month cap still applies.",
    dailyCap: 3,
    fields: [
      { name: "job_url", label: "Job post link", kind: "url", max: 2000, placeholder: "https://…" },
      { name: "job_text", label: "Or paste the job description", kind: "textarea", max: 20000, hint: "Paste it when the link needs a login. At least 200 characters." },
      { name: "company", label: "Company (optional)", kind: "text", max: 120 },
      { name: "role", label: "Role (optional)", kind: "text", max: 120 },
    ],
    check: (i) => (!String(i.job_url ?? "") && String(i.job_text ?? "").trim().length < 200 ? "Add a job link or at least 200 characters of the job description." : null),
  },
  {
    key: "product-idea",
    workflowId: "1Dc7L3hYKdbTWL2F",
    name: "Commerce · Add product idea",
    does: "Queues one Canva product idea. Claude and Canva design it on the next Design product run, and you get an approval email before anything goes on sale.",
    never: "It never publishes, prices in Stripe or emails a buyer. Only your approval email can do that.",
    dailyCap: 5,
    fields: [
      { name: "name", label: "Product name", kind: "text", required: true, max: 120, placeholder: "90-Day Small Business Planner" },
      {
        name: "product_type",
        label: "Format",
        kind: "choice",
        required: true,
        options: [
          { value: "doc", label: "Canva doc (planner, workbook, guide, checklist)" },
          { value: "presentation", label: "Canva presentation (deck, kit, slides)" },
        ],
        default: "doc",
      },
      { name: "audience", label: "Who is it for?", kind: "text", required: true, max: 200, placeholder: "new freelance designers" },
      { name: "price", label: "Price in US dollars", kind: "number", required: true, min: 3, maxValue: 200, default: "19" },
      { name: "notes", label: "Notes for Claude (optional)", kind: "textarea", max: 2000 },
    ],
  },
];

export const startableByKey = (key: string) => STARTABLE.find((w) => w.key === key);
export const startableByWorkflowId = (id: string | undefined) => (id ? STARTABLE.find((w) => w.workflowId === id) : undefined);
/** The n8n webhook path of a startable workflow. */
export const startPath = (w: Pick<StartableWorkflow, "key">) => `atlas-start-${w.key}`;

export type StartInput = Record<string, string | number>;
export type InputCheck = { ok: true; input: StartInput } | { ok: false; error: string };

const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * The input, cleaned to exactly the workflow's fields, or why it's refused. Unknown fields are
 * dropped; text is trimmed; too-long text is refused rather than cut, so nothing is silently lost.
 */
export function checkStartInput(w: StartableWorkflow, raw: unknown): InputCheck {
  if (!obj(raw)) return { ok: false, error: "The input must be an object." };
  const input: StartInput = {};
  for (const f of w.fields) {
    const v = raw[f.name];
    if (f.kind === "number") {
      const blank = v === undefined || v === null || v === "";
      if (blank) {
        if (f.required) return { ok: false, error: `${f.label} is required.` };
        continue;
      }
      const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.trim()) : NaN;
      if (!Number.isFinite(n)) return { ok: false, error: `${f.label} must be a number.` };
      if ((f.min !== undefined && n < f.min) || (f.maxValue !== undefined && n > f.maxValue)) return { ok: false, error: `${f.label} must be between ${f.min ?? "-"} and ${f.maxValue ?? "-"}.` };
      input[f.name] = n;
      continue;
    }
    if (v !== undefined && v !== null && typeof v !== "string") return { ok: false, error: `${f.label} must be text.` };
    const s = (v ?? "").trim();
    if (!s) {
      if (f.required) return { ok: false, error: `${f.label} is required.` };
      input[f.name] = "";
      continue;
    }
    if (f.max !== undefined && s.length > f.max) return { ok: false, error: `${f.label} is too long (at most ${f.max} characters).` };
    if (f.min !== undefined && s.length < f.min) return { ok: false, error: `${f.label} is too short (at least ${f.min} characters).` };
    if (f.kind === "url" && !/^https:\/\/[^\s/]+\.[^\s]+$/i.test(s)) return { ok: false, error: `${f.label} must be an https:// link.` };
    if (f.kind === "choice" && !f.options?.some((o) => o.value === s)) return { ok: false, error: `${f.label} must be one of: ${f.options?.map((o) => o.value).join(", ")}.` };
    input[f.name] = s;
  }
  const rule = w.check?.(input);
  if (rule) return { ok: false, error: rule };
  if (new TextEncoder().encode(JSON.stringify(input)).length > MAX_INPUT_BYTES) return { ok: false, error: "The input is too large." };
  return { ok: true, input };
}

/** What the site answers about one start. */
export interface StartAnswer {
  state: "accepted" | "refused" | "unknown";
  error?: string;
  duplicate?: boolean;
  executionId?: string;
  executionUrl?: string;
}

/** Idempotency keys look like task ids plus an attempt number, e.g. task_abc:2. */
export const validIdem = (k: unknown): k is string => typeof k === "string" && /^[\w:-]{3,120}$/.test(k);
