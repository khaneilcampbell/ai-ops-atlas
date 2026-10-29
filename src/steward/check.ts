import { forgetEtags, githubGet, GithubError } from "../github/transport";

export const STEWARD_REPO = "khaneilcampbell/ai-ops-atlas";
export type CheckState = "clear" | "attention" | "unknown";
export interface Check {
  id: string;
  label: string;
  state: CheckState;
  detail: string;
  url: string;
  signature?: string;
}
export interface StewardRun {
  id: string;
  startedAt: string;
  finishedAt: string;
  status: "completed" | "partial" | "paused" | "failed" | "interrupted";
  trigger?: "manual" | "schedule";
  changes?: string[];
  commit?: string;
  requests: number;
  checks: Check[];
  /** Desktop runs: GitHub's remaining hourly budget and a fixed error label, never raw text. */
  rateRemaining?: number;
  errorClass?: string;
}
const record = (v: unknown): Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const text = (v: unknown) => typeof v === "string" ? v : undefined;
const root = `https://github.com/${STEWARD_REPO}`;

/** Earlier builds cached alert bodies (advisory text, affected paths) in local storage. */
export const isAlertPath = (path: string) => /\/(dependabot|code-scanning|secret-scanning)\/alerts/.test(path);

/**
 * Browser preview only: the desktop app runs the Steward in Rust (src-tauri/src/steward).
 * Reads bypass the shared ETag cache, so alert content is never written to disk.
 */
export async function stewardGet(path: string): Promise<unknown> {
  forgetEtags(isAlertPath);
  return githubGet(path, { cache: false });
}

/** Fixed scope, GET-only transport, at most seven sequential requests, no repository code execution. */
export async function checkSteward(options: {
  stopped?: () => boolean;
  get?: (path: string) => Promise<unknown>;
  now?: () => number;
} = {}): Promise<StewardRun> {
  const get = options.get ?? stewardGet;
  const now = options.now ?? Date.now;
  const started = now();
  const run: StewardRun = { id: `${started}`, startedAt: new Date(started).toISOString(), finishedAt: "", status: "completed", requests: 0, checks: [] };
  const base = `/repos/${STEWARD_REPO}`;
  const stopped = () => !!options.stopped?.() || now() - started >= 180_000;
  const read = async (id: string, label: string, suffix: string, url: string, assess: (value: unknown) => Omit<Check, "id" | "label" | "url">) => {
    if (stopped()) return;
    run.requests++;
    try {
      const value = await get(base + suffix);
      if (stopped()) return;
      run.checks.push({ id, label, url, ...assess(value) });
    } catch (error) {
      if (stopped()) return;
      const missingFile = (id === "readme" || id === "dependabot-config") && error instanceof GithubError && error.status === 404;
      run.checks.push({ id, label, url, state: missingFile ? "attention" : "unknown", detail: missingFile ? "File not found or not accessible. Verify access before adding it." : "Could not verify this check. Check connection, token permissions and GitHub availability." });
    }
  };
  let branch: string | undefined;
  await read("repository", "Repository", "", root, (value) => {
    const meta = record(value);
    const verifiedBranch = text(meta.default_branch);
    if (!verifiedBranch || meta.full_name !== STEWARD_REPO) throw new Error("Invalid metadata");
    branch = verifiedBranch;
    return { state: meta.archived === true ? "attention" : "clear", detail: meta.archived === true ? "Repository is archived." : `Default branch: ${branch}.` };
  });
  if (branch) {
    await read("commit", "Examined commit", `/commits/${encodeURIComponent(branch)}`, `${root}/commits/${encodeURIComponent(branch)}`, (value) => {
      const sha = text(record(value).sha);
      if (!sha || !/^[a-f0-9]{40}$/i.test(sha)) throw new Error("Invalid commit");
      run.commit = sha;
      return { state: "clear", detail: sha.slice(0, 12) };
    });
    const commitCheck = run.checks.find((c) => c.id === "commit");
    if (commitCheck && run.commit) commitCheck.url = `${root}/commit/${run.commit}`;
    await read("ci", "CI on default branch", `/actions/runs?per_page=30&branch=${encodeURIComponent(branch)}`, `${root}/actions`, (value) => {
      const runs = record(value).workflow_runs;
      if (!Array.isArray(runs)) throw new Error("Invalid runs");
      // Only the newest run for each workflow counts, so an old failure cannot hide a recovery.
      const latest = new Map<string, Record<string, unknown>>();
      for (const raw of runs) {
        const r = record(raw);
        if (typeof r.workflow_id !== "number" || r.head_branch !== branch) continue;
        const key = String(r.workflow_id);
        const prev = latest.get(key);
        if (!prev || String(r.created_at) > String(prev.created_at) || (r.created_at === prev.created_at && Number(r.id) > Number(prev.id))) latest.set(key, r);
      }
      const sampled = [...latest.values()];
      if (!sampled.length) return { state: "unknown", detail: "No workflow runs observed on the default branch in this sample." };
      const failed = sampled.filter((r) => ["failure", "timed_out", "action_required", "startup_failure"].includes(String(r.conclusion)));
      if (failed.length) return { state: "attention", signature: JSON.stringify(failed.map((r) => [r.workflow_id, r.conclusion]).sort()), detail: `${failed.length} of ${sampled.length} sampled workflows have a failing latest run. Open Actions to investigate.` };
      const pending = sampled.filter((r) => r.status !== "completed" || !["success", "neutral", "skipped"].includes(String(r.conclusion)));
      return pending.length ? { state: "unknown", detail: `${pending.length} sampled workflows are unfinished, cancelled or inconclusive.` } : { state: "clear", detail: `Latest runs for ${sampled.length} sampled workflows passed or were neutral/skipped. Sample: up to 30 runs; required checks and uptime are not assessed.` };
    });
  } else if (!stopped()) {
    for (const id of ["commit", "ci"]) run.checks.push({ id, label: id === "commit" ? "Examined commit" : "CI on default branch", state: "unknown", detail: "Default branch could not be verified.", url: root });
  }
  for (const [id, label, endpoint, url] of [
    ["dependabot", "Dependency security", "/dependabot/alerts?state=open&per_page=20", `${root}/security/dependabot`],
    ["code-scanning", "Code scanning", "/code-scanning/alerts?state=open&per_page=20", `${root}/security/code-scanning`],
  ]) {
    await read(id, label, endpoint, url, (value) => {
      if (!Array.isArray(value)) throw new Error("Invalid alerts");
      return value.length ? { state: "attention", signature: JSON.stringify(value.map((a) => record(a).number).filter((n) => typeof n === "number").sort((a, b) => Number(a) - Number(b))), detail: `${value.length}${value.length === 20 ? "+" : ""} open alerts observed. Review privately in GitHub; exploitability has not been assessed.` } : { state: "clear", detail: "No open alerts returned. This does not establish that scanning is enabled or comprehensive." };
    });
  }
  for (const [id, label, endpoint] of [
    ["readme", "Setup documentation", "/readme"],
    ["dependabot-config", "Dependency update configuration", "/contents/.github/dependabot.yml"],
  ]) {
    await read(id, label, endpoint, id === "readme" ? `${root}#readme` : `${root}/blob/${encodeURIComponent(branch ?? "HEAD")}/.github/dependabot.yml`, (value) => {
      if (record(value).type !== "file") throw new Error("Not a file");
      return { state: "clear", detail: "File is present. Content quality and configuration behavior have not been assessed." };
    });
  }
  run.finishedAt = new Date(now()).toISOString();
  run.status = stopped() ? "paused" : run.checks.some((c) => c.state === "unknown") ? "partial" : "completed";
  return run;
}
