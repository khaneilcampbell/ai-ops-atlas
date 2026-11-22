import { REPORT_SECTION_LABEL, REPORT_SECTIONS, type OpportunityReport, type ReportSection, type Verification } from "./types";

// Atlas's own checks on a returned research report. A task completes only when every check passes;
// what the workflow or model says about its own success is never enough. Sources must be links the
// research run's own web search returned (n8n passes that list beside the report), so a made-up
// citation fails here.

const PLACEHOLDER = /\b(lorem ipsum|tbd|todo|to be determined|n\/a|not available|placeholder|insert here)\b/i;
const MIN_SECTION_CHARS = 60;
const MAX_SECTION_CHARS = 3000;
const MIN_SOURCES = 3;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function httpsUrl(u: unknown): string | null {
  if (typeof u !== "string" || u.length > 2000) return null;
  try {
    const x = new URL(u);
    return x.protocol === "https:" && !!x.hostname && x.hostname.includes(".") ? x.toString() : null;
  } catch {
    return null;
  }
}

/** Normalises a URL for comparison (no fragment, no trailing slash, lowercase host). */
export function sameUrlKey(u: string): string {
  try {
    const x = new URL(u);
    x.hash = "";
    return `${x.hostname.toLowerCase()}${x.pathname.replace(/\/+$/, "")}${x.search}`;
  } catch {
    return u;
  }
}

/** Shape check and cleaning of an untrusted report: unknown fields are dropped, sizes bounded. */
export function parseReport(raw: unknown): { ok: true; report: OpportunityReport } | { ok: false; error: string } {
  if (!isObj(raw)) return { ok: false, error: "The report isn't an object." };
  if (raw.schema !== "opportunity-report/1") return { ok: false, error: "Unknown report schema." };
  const name = typeof raw.productName === "string" ? raw.productName.trim().slice(0, 120) : "";
  if (!name) return { ok: false, error: "The report doesn't name the product." };
  if (!isObj(raw.sections)) return { ok: false, error: "The report has no sections." };
  const rawSections = raw.sections;
  const sections = {} as OpportunityReport["sections"];
  for (const k of REPORT_SECTIONS) {
    const s = rawSections[k];
    const text = isObj(s) && typeof s.text === "string" ? s.text.trim().slice(0, MAX_SECTION_CHARS) : "";
    const sources = isObj(s) && Array.isArray(s.sources) ? s.sources.filter((x): x is string => typeof x === "string" && /^S\d{1,2}$/.test(x)).slice(0, 10) : [];
    sections[k] = { text, sources };
  }
  const sources = (Array.isArray(raw.sources) ? raw.sources : [])
    .slice(0, 20)
    .map((s) => (isObj(s) ? { id: typeof s.id === "string" ? s.id : "", title: typeof s.title === "string" ? s.title.trim().slice(0, 200) : "", url: httpsUrl(s.url) ?? "" } : null))
    .filter((s): s is { id: string; title: string; url: string } => !!s && /^S\d{1,2}$/.test(s.id));
  return { ok: true, report: { schema: "opportunity-report/1", productName: name, sections, sources } };
}

/** RESULTS_VERIFIED needs every check here to pass. `searched` = URLs the run's web search returned. */
export function verifyReport(report: OpportunityReport, searched: readonly string[], at: string): Verification {
  const checks: Verification["checks"] = [];
  const add = (name: string, passed: boolean, detail?: string) => checks.push({ name, passed, ...(detail && !passed ? { detail } : {}) });
  const found = new Set(searched.map((u) => httpsUrl(u)).filter((u): u is string => !!u).map(sameUrlKey));

  const missing = REPORT_SECTIONS.filter((k) => report.sections[k].text.length < MIN_SECTION_CHARS);
  add("All 7 sections are written", missing.length === 0, missing.length ? `Too short or missing: ${missing.map((k) => REPORT_SECTION_LABEL[k]).join(", ")}` : undefined);

  const placeholders = REPORT_SECTIONS.filter((k) => PLACEHOLDER.test(report.sections[k].text));
  add("No placeholder text", placeholders.length === 0, placeholders.length ? `Placeholder wording in: ${placeholders.map((k) => REPORT_SECTION_LABEL[k]).join(", ")}` : undefined);

  const ids = new Set<string>();
  const dupIds = report.sources.filter((s) => (ids.has(s.id) ? true : (ids.add(s.id), false)));
  add("Source ids are unique", dupIds.length === 0, dupIds.length ? `Repeated: ${dupIds.map((s) => s.id).join(", ")}` : undefined);

  const badLinks = report.sources.filter((s) => !s.url);
  add("Every source is an https link", badLinks.length === 0 && report.sources.length > 0, badLinks.length ? `${badLinks.length} source(s) without a valid https link` : "No sources");

  const real = report.sources.filter((s) => s.url && found.has(sameUrlKey(s.url)));
  const invented = report.sources.filter((s) => s.url && !found.has(sameUrlKey(s.url)));
  add("Sources came from the run's own web search", invented.length === 0 && report.sources.length > 0, invented.length ? `Not returned by the search: ${invented.map((s) => s.id).join(", ")}` : "No sources");
  add(`At least ${MIN_SOURCES} verified sources`, real.length >= MIN_SOURCES, `${real.length} verified`);

  const known = new Set(report.sources.map((s) => s.id));
  const dangling = REPORT_SECTIONS.flatMap((k) => report.sections[k].sources.filter((id) => !known.has(id)).map((id) => `${REPORT_SECTION_LABEL[k]} → ${id}`));
  add("Every citation points to a listed source", dangling.length === 0, dangling.length ? dangling.join("; ") : undefined);

  const needCitations: ReportSection[] = ["competitorOverview", "marketEvidence"];
  const uncited = needCitations.filter((k) => !report.sections[k].sources.some((id) => known.has(id)));
  add("Competitor overview and market evidence cite sources", uncited.length === 0, uncited.length ? `No citation in: ${uncited.map((k) => REPORT_SECTION_LABEL[k]).join(", ")}` : undefined);

  return { passed: checks.every((c) => c.passed), checkedAt: at, checks };
}

/** A plain summary built from the verified report. No model writes it. */
export function summarise(report: OpportunityReport): string {
  const first = (t: string, n = 220) => {
    const s = t.split(/(?<=[.!?])\s/)[0] ?? t;
    return s.length > n ? `${s.slice(0, n - 1)}…` : s;
  };
  return [`${report.productName}.`, `Problem: ${first(report.sections.targetCustomerProblem.text)}`, `Recommended next step: ${first(report.sections.recommendedNextStep.text, 300)}`, `${report.sources.length} sources.`].join(" ");
}
