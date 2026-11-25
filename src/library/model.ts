// The Output Library's shared rules: what an ingested deliverable looks like, which formats Atlas
// previews, and how a stored version is described. The site (server/outputs.ts) checks ingests and
// serves files with these rules; the drawer (src/views/library/OutputLibrary.tsx) draws with them.
// Metadata lives in the site's D1 database, file bytes in private object storage (R2), never in the
// browser. File storage state and approval state are separate: a file can be saved while it waits
// for approval, and an approved output can still be missing its file.

/**
 * Where the Library lives: the Knowledge & Research floor of the Atlas AI Operations Center (Nov 24), which
 * replaced the Knowledge & Research Center tower on the map (catalog/workspace/workspace.yaml `merged`).
 */
export const LIBRARY_BUILDING = "service:ai-operations-center";
export const LIBRARY_BUILDING_NAME = "Atlas AI Operations Center · Knowledge & Research";

export const STORAGE_STATES = ["pending", "saved", "failed"] as const;
export type StorageState = (typeof STORAGE_STATES)[number];
export const STORAGE_LABEL: Record<StorageState, string> = { pending: "Saving", saved: "Saved", failed: "File not saved" };

export const APPROVALS = ["awaiting", "approved", "rejected", "not_required"] as const;
export type Approval = (typeof APPROVALS)[number];
export const APPROVAL_LABEL: Record<Approval, string> = { awaiting: "Awaiting approval", approved: "Approved", rejected: "Rejected", not_required: "No approval needed" };

export const FORMATS = ["report", "text", "image", "pdf", "spreadsheet", "document", "data", "other"] as const;
export type OutputFormat = (typeof FORMATS)[number];
export const FORMAT_LABEL: Record<OutputFormat, string> = {
  report: "Report",
  text: "Text",
  image: "Image",
  pdf: "PDF",
  spreadsheet: "Spreadsheet",
  document: "Document",
  data: "Data",
  other: "Other",
};

/** How the drawer previews a format. Anything not listed downloads instead. */
export type PreviewKind = "text" | "markdown" | "table" | "image" | "pdf" | "none";

/** Limits: one ingest call carries at most this many files, each at most MAX_FILE_BYTES. */
export const MAX_ARTIFACTS = 10;
export const MAX_FILE_BYTES = 15 * 1024 * 1024;
export const MAX_INGEST_BYTES = 25 * 1024 * 1024;
/** Text previews read only the start of a file, so a large export never loads whole. */
export const PREVIEW_BYTES = 256 * 1024;
/** Searchable text kept with a version: the summary plus the start of a text file. */
export const SEARCH_TEXT_CHARS = 4000;
export const PAGE_SIZE = 20;
/** Storage attempts per version, across the ingest call and later retries. */
export const MAX_STORAGE_ATTEMPTS = 5;

const ID = /^[a-z0-9][a-z0-9._:-]{0,119}$/i;
export const validId = (s: unknown): s is string => typeof s === "string" && ID.test(s);
const text = (s: unknown, max: number): s is string => typeof s === "string" && s.trim().length > 0 && s.length <= max;
const optText = (s: unknown, max: number) => s == null || (typeof s === "string" && s.length <= max);

/** Safe MIME types for display in the browser. Everything else downloads as a file. */
const IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const TEXT_MIMES = new Set(["text/plain", "text/markdown", "text/csv", "application/json", "text/tab-separated-values"]);

export function normalMime(mime: string): string {
  return mime.split(";")[0].trim().toLowerCase();
}

export function formatOf(mime: string, kind?: string): OutputFormat {
  const m = normalMime(mime);
  if (kind === "report") return "report";
  if (m.startsWith("image/")) return "image";
  if (m === "application/pdf") return "pdf";
  if (m === "text/csv" || m === "text/tab-separated-values" || m.includes("spreadsheet") || m === "application/vnd.ms-excel") return "spreadsheet";
  if (m.includes("wordprocessingml") || m === "application/msword" || m.includes("presentation") || m === "application/rtf") return "document";
  if (m === "application/json") return "data";
  if (m.startsWith("text/")) return "text";
  return "other";
}

export function previewKind(mime: string): PreviewKind {
  const m = normalMime(mime);
  if (IMAGE_MIMES.has(m)) return "image";
  if (m === "application/pdf") return "pdf";
  if (m === "text/csv" || m === "text/tab-separated-values") return "table";
  if (m === "text/markdown") return "markdown";
  if (TEXT_MIMES.has(m)) return "text";
  return "none";
}

/**
 * The Content-Type a file is served with. Previewable text is always text/plain, so HTML, SVG or
 * script inside it is shown as characters, never run; everything not previewable is a download.
 */
export function servedType(mime: string): { type: string; inline: boolean } {
  const kind = previewKind(mime);
  if (kind === "image") return { type: normalMime(mime), inline: true };
  if (kind === "pdf") return { type: "application/pdf", inline: true };
  if (kind === "text" || kind === "markdown" || kind === "table") return { type: "text/plain; charset=utf-8", inline: true };
  return { type: "application/octet-stream", inline: false };
}

/** A filename safe for Content-Disposition: no paths, quotes or control characters. */
export function safeFilename(title: string, mime: string): string {
  const ext: Record<string, string> = {
    "text/plain": "txt", "text/markdown": "md", "text/csv": "csv", "application/json": "json", "application/pdf": "pdf",
    "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  };
  const base = title.replace(/[^\w .()-]+/g, " ").replace(/\s+/g, " ").replace(/^[. ]+/, "").trim().slice(0, 80) || "output";
  const e = ext[normalMime(mime)];
  return e && !base.toLowerCase().endsWith(`.${e}`) ? `${base}.${e}` : base;
}

/** One deliverable in an ingest call. Exactly one of text or base64 carries the bytes. */
export interface IngestArtifact {
  /** The artifact's identity inside its execution (a filename or a node output name). */
  id: string;
  title: string;
  mime: string;
  summary?: string | null;
  /** "report" marks a structured agent report; otherwise the format comes from the MIME type. */
  kind?: "report" | null;
  text?: string;
  base64?: string;
  /** The logical output this is a version of. Defaults to `<agent>:<id>`, so a weekly report keeps one history. */
  outputKey?: string | null;
  /** True when a person must approve the deliverable before it's used. */
  requiresApproval?: boolean;
  /** Where the producer got it (an n8n binary property, a GitHub artifact). Kept as provenance only. */
  sourceUrl?: string | null;
}

export interface IngestSource {
  agent: string;
  /** The workflow execution or run that produced the files: an n8n execution id, a GitHub run id. */
  execution: string;
  workflow?: string | null;
  task?: string | null;
  runUrl?: string | null;
  project?: string | null;
  building?: string | null;
  producedAt?: string | null;
  /** What called the hook: "n8n", "github-actions", "agent_report". */
  via?: string | null;
}

export interface IngestBody {
  source: IngestSource;
  artifacts: IngestArtifact[];
}

const https = (s: unknown) => s == null || (typeof s === "string" && s.length <= 500 && /^https:\/\/[^\s]+$/.test(s));

/** Why an ingest body is refused, or null when it's well formed. */
export function ingestProblem(body: unknown): string | null {
  if (!body || typeof body !== "object") return "Body isn't an object.";
  const { source, artifacts } = body as Partial<IngestBody>;
  if (!source || typeof source !== "object") return "source is missing.";
  if (!validId(source.agent)) return "source.agent must be an agent id.";
  if (!validId(source.execution)) return "source.execution must identify the run (letters, digits, . _ : -).";
  for (const k of ["workflow", "task", "project", "building", "via"] as const) if (source[k] != null && !validId(source[k])) return `source.${k} must be an id.`;
  if (!https(source.runUrl)) return "source.runUrl must be an https link.";
  if (source.producedAt != null && Number.isNaN(Date.parse(String(source.producedAt)))) return "source.producedAt must be a date.";
  if (!Array.isArray(artifacts) || artifacts.length === 0) return "artifacts must list at least one file.";
  if (artifacts.length > MAX_ARTIFACTS) return `At most ${MAX_ARTIFACTS} files per call.`;
  const seen = new Set<string>();
  for (const [i, a] of artifacts.entries()) {
    const at = `artifacts[${i}]`;
    if (!a || typeof a !== "object") return `${at} isn't an object.`;
    if (!validId(a.id)) return `${at}.id must identify the file within its run.`;
    if (seen.has(a.id)) return `${at}.id repeats another file in this call.`;
    seen.add(a.id);
    if (!text(a.title, 200)) return `${at}.title is required (200 characters at most).`;
    if (!text(a.mime, 120) || !/^[a-z]+\/[a-z0-9.+-]+$/i.test(normalMime(a.mime))) return `${at}.mime must be a MIME type.`;
    if (!optText(a.summary, 2000)) return `${at}.summary is 2000 characters at most.`;
    if (a.outputKey != null && !validId(a.outputKey)) return `${at}.outputKey must be an id.`;
    if (!https(a.sourceUrl)) return `${at}.sourceUrl must be an https link.`;
    const hasText = typeof a.text === "string";
    const hasB64 = typeof a.base64 === "string";
    if (hasText === hasB64) return `${at} needs exactly one of text or base64.`;
    if (hasB64 && !/^[A-Za-z0-9+/]*={0,2}$/.test(a.base64!)) return `${at}.base64 isn't base64.`;
  }
  return null;
}

/** A stored version as the site describes it. Never includes the file itself. */
export interface OutputVersion {
  version: number;
  title: string;
  format: OutputFormat;
  mime: string;
  size: number;
  summary: string | null;
  agent: string;
  task: string | null;
  workflow: string | null;
  execution: string;
  runUrl: string | null;
  project: string | null;
  building: string | null;
  via: string | null;
  sourceUrl: string | null;
  checksum: string | null;
  storage: StorageState;
  storageError: string | null;
  storageAttempts: number;
  /** Set only after the stored file was read back and its checksum matched. */
  verifiedAt: string | null;
  approval: Approval;
  producedAt: string;
  createdAt: string;
  /** Development example from the local preview; never set on the hosted site. */
  sample: boolean;
}

export interface OutputSummary {
  id: string;
  outputKey: string;
  latest: OutputVersion;
  versions: number;
  updatedAt: string;
}

export interface OutputDetail extends OutputSummary {
  history: OutputVersion[];
}

export interface ListQuery {
  q?: string;
  format?: OutputFormat | "";
  agent?: string;
  project?: string;
  approval?: Approval | "";
  storage?: StorageState | "";
  page?: number;
}

export interface ListPage {
  configured: boolean;
  /** Whether file storage (the OUTPUTS bucket) is connected on the site. */
  storageConnected: boolean;
  /** "development" only on the local preview server, whose records are examples. */
  environment: "production" | "development";
  total: number;
  page: number;
  pageSize: number;
  outputs: OutputSummary[];
  facets: { agents: string[]; projects: string[] };
}

export function listParams(q: ListQuery): URLSearchParams {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== "" && !(k === "page" && v === 1)) p.set(k, String(v));
  return p;
}

/** Bytes as people read them. */
export function sizeLabel(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** A small CSV/TSV parser for previews: quotes, escaped quotes, at most `maxRows` rows. */
export function parseDelimited(src: string, delimiter = ",", maxRows = 200): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length && rows.length < maxRows; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === delimiter) {
      row.push(cell);
      cell = "";
    }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if ((cell || row.length) && rows.length < maxRows) rows.push([...row, cell]);
  return rows;
}
