// The Agent Registry as it is on main, for agent selection. Atlas's rule is that only what is on
// main counts, so the site reads the catalog files from the public repository (the same files the
// app bundles). No second registry exists: this is a read of the one in catalog/*.yaml, taking only
// what selection needs (id, name, status, building). The app's full parser (src/catalog/parse.ts)
// pulls in Vite-only imports, so a Pages Function can't bundle it; a test checks both agree.
// Cached for 10 minutes per worker; a failed read throws, and the engine blocks the goal with the
// reason instead of guessing.

import * as yaml from "js-yaml";
import type { RosterAgent } from "../../src/executive/control/select";

const REPO = "khaneilcampbell/ai-ops-atlas";
const TTL_MS = 10 * 60_000;
let cached: { at: number; roster: RosterAgent[]; names: Map<string, string> } | null = null;

export interface RosterEnv {
  GITHUB_TOKEN?: string;
}

const ID = /^[a-z0-9][a-z0-9-]*$/;
const str = (v: unknown) => (typeof v === "string" ? v : "");

/** id, name, status and building of every agent in the catalog files. Malformed entries are left out. */
export function rosterFromFiles(files: Record<string, string>): RosterAgent[] {
  const out: RosterAgent[] = [];
  for (const name of Object.keys(files).sort()) {
    let doc: unknown;
    try {
      doc = yaml.load(files[name]);
    } catch {
      continue;
    }
    const d = (doc ?? {}) as { project?: { id?: unknown }; agents?: unknown };
    const projectId = str(d.project?.id);
    if (!ID.test(projectId) || !Array.isArray(d.agents)) continue;
    for (const a of d.agents as Record<string, unknown>[]) {
      const id = str(a?.id);
      if (!ID.test(id)) continue;
      out.push({ id, name: str(a.name) || id, status: str(a.status) || "unknown", projectId });
    }
  }
  return out;
}

export async function loadRoster(env: RosterEnv, fetcher: typeof fetch = fetch, now = Date.now()): Promise<{ roster: RosterAgent[]; names: Map<string, string> }> {
  if (cached && now - cached.at < TTL_MS) return cached;
  const headers: Record<string, string> = { accept: "application/vnd.github+json", "user-agent": "atlas-executive" };
  if (env.GITHUB_TOKEN) headers.authorization = `Bearer ${env.GITHUB_TOKEN}`;
  const list = await fetcher(`https://api.github.com/repos/${REPO}/contents/catalog?ref=main`, { headers, signal: AbortSignal.timeout(10_000) });
  if (!list.ok) throw new Error(`GitHub answered ${list.status} for the catalog list`);
  const entries = ((await list.json()) as { name: string; type: string; download_url: string | null }[]).filter((e) => e.type === "file" && e.name.endsWith(".yaml") && e.download_url?.startsWith("https://raw.githubusercontent.com/"));
  if (!entries.length) throw new Error("The catalog list was empty");
  const files: Record<string, string> = {};
  for (const e of entries.slice(0, 40)) {
    const r = await fetcher(e.download_url!, { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) throw new Error(`GitHub answered ${r.status} for ${e.name}`);
    files[e.name] = await r.text();
  }
  const roster = rosterFromFiles(files);
  cached = { at: now, roster, names: new Map(roster.map((a) => [a.id, a.name])) };
  return cached;
}

/** Tests only. */
export function clearRosterCache() {
  cached = null;
}
