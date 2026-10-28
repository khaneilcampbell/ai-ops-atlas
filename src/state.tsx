import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { catalog, manifestIssues, type Catalog, type ManifestIssue } from "./catalog";
import { discoverRepos } from "./github/discover";
import { fetchRepo } from "./github/fetchRepo";
import { budgetExhausted, clearEtags, GithubError, PRIVATE_OR_MISSING, rateLimit, takeUsage, type RateLimit } from "./github/transport";
import { liveCatalog, type HiddenRepo } from "./lib/live";
import { tokenStore } from "./lib/token";
import type { RepoSnapshot, RepoState } from "./github/types";
import { load, save } from "./lib/storage";

export type View = "overview" | "agents" | "repos" | "map" | "grid" | "activity" | "intel" | "usage" | "settings";
export type Selection = { kind: "agent"; id: string } | { kind: "repo"; id: string } | null;

export interface Settings {
  refreshMinutes: number;
  refreshOnLaunch: boolean;
  showMapLabels: boolean;
  /** GitHub accounts whose repositories are discovered even without a manifest. */
  owners: string[];
  includeForks: boolean;
}

const DEFAULT_SETTINGS: Settings = { refreshMinutes: 30, refreshOnLaunch: true, showMapLabels: true, owners: ["khaneilcampbell"], includeForks: false };

export interface Filters {
  query: string;
  project: string;
  framework: string;
  status: string;
  language: string;
}

const EMPTY_FILTERS: Filters = { query: "", project: "", framework: "", status: "", language: "" };

interface AtlasState {
  /** The catalog minus projects whose repository GitHub reports deleted or archived. */
  catalog: Catalog;
  /** Cataloged repositories left out of `catalog`, and why. */
  hidden: HiddenRepo[];
  /** Cataloged repository -> the name GitHub now has for it, when it was renamed there. */
  renamed: Record<string, string>;
  manifestIssues: ManifestIssue[];
  repos: Record<string, RepoState>;
  /** Repositories found on GitHub that no manifest mentions. */
  uncataloged: string[];
  /** Outcome of the last look for new repositories. */
  discovery: { at: string; found: number; withToken: boolean; error?: string } | null;
  /** What the last refresh cost, and GitHub's hourly budget after it. */
  usage: { at: string; requests: number; counted: number; skipped: number; rate: RateLimit | null; paused?: boolean } | null;
  refreshing: boolean;
  refresh: (force?: boolean) => Promise<void>;
  view: View;
  setView: (v: View) => void;
  selection: Selection;
  select: (s: Selection) => void;
  filters: Filters;
  setFilters: (f: Partial<Filters>) => void;
  clearFilters: () => void;
  settings: Settings;
  setSettings: (s: Partial<Settings>) => void;
  clearCache: () => void;
}

const Ctx = createContext<AtlasState | null>(null);

const repoNames = [...new Set(catalog.projects.map((p) => p.repository).concat(catalog.agents.map((a) => a.repository)))];
const known = new Set(repoNames.map((n) => n.toLowerCase()));

function workflowsFor(repo: string): string[] {
  return [...new Set(catalog.agents.filter((a) => a.repository === repo && a.observe?.githubWorkflow).map((a) => a.observe!.githubWorkflow!))];
}

type Cache = Record<string, RepoSnapshot>;

/** Without a token every request counts, so unchanged repositories check runs less often. */
const ANON_RUNS_EVERY_MS = 3 * 3_600_000;

function fromCache(cache: Cache, extra: string[], maxAgeMs: number): Record<string, RepoState> {
  const now = Date.now();
  return Object.fromEntries(
    repoNames.concat(extra).map((n): [string, RepoState] => {
      const c = cache[n];
      return c ? [n, { kind: "ok", data: c, stale: now - Date.parse(c.fetchedAt) > maxAgeMs }] : [n, { kind: "loading" }];
    }),
  );
}

export function AtlasProvider({ children }: { children: ReactNode }) {
  const [settings, setSettingsState] = useState<Settings>(() => ({ ...DEFAULT_SETTINGS, ...load("settings", {}) }));
  const [uncataloged, setUncataloged] = useState<string[]>(() => load<string[]>("uncataloged", []));
  const [discovery, setDiscoveryState] = useState<AtlasState["discovery"]>(() => load("discovery", null));
  const [usage, setUsage] = useState<AtlasState["usage"]>(() => load("usage", null));
  const [repos, setRepos] = useState<Record<string, RepoState>>(() => fromCache(load<Cache>("repoCache", {}), uncataloged, settings.refreshMinutes * 60_000));
  const [refreshing, setRefreshing] = useState(false);
  // Cataloged repositories GitHub has confirmed no longer exist, with when that was seen.
  const [deleted, setDeleted] = useState<Record<string, string>>(() => load("deletedRepos", {}));
  // The map is the landing view on every launch.
  const [view, setViewState] = useState<View>("map");
  const [selection, select] = useState<Selection>(null);
  const [filters, setFiltersState] = useState<Filters>(EMPTY_FILTERS);
  const inflight = useRef(false);

  const refresh = useCallback(
    async (force = false) => {
      if (inflight.current) return;
      const cache = load<Cache>("repoCache", {});
      const maxAge = settings.refreshMinutes * 60_000;
      const now = Date.now();
      let extra = load<string[]>("uncataloged", []);
      const lastDiscovery = load<AtlasState["discovery"]>("discovery", null);
      // When each repository was last looked at, including ones that turned out private or missing.
      const checked = load<Record<string, string>>("checkedAt", {});
      const lastCheck = (name: string) => Date.parse(checked[name] ?? cache[name]?.fetchedAt ?? "") || 0;
      const isDue = (name: string) => force || now - lastCheck(name) >= maxAge;
      const discoveryDue = force || !lastDiscovery || !!lastDiscovery.error || now - Date.parse(lastDiscovery.at) >= maxAge;
      // Nothing is old enough to ask about: skip the round trip entirely.
      if (!discoveryDue && !repoNames.concat(extra).some(isDue)) return;
      if (budgetExhausted()) {
        setUsage((u) => ({ at: new Date().toISOString(), requests: 0, counted: 0, skipped: repoNames.length + extra.length, rate: rateLimit() ?? u?.rate ?? null, paused: true }));
        return;
      }
      inflight.current = true;
      setRefreshing(true);
      takeUsage();
      const withToken = await tokenStore.has().catch(() => false);
      const metas = new Map<string, Record<string, unknown>>();
      let listedAll = false;
      if (settings.owners.length) {
        const setDiscovery = (d: AtlasState["discovery"]) => {
          save("discovery", d);
          setDiscoveryState(d);
        };
        try {
          const found = await discoverRepos(settings.owners, withToken);
          for (const r of found) metas.set(r.fullName.toLowerCase(), r.meta);
          listedAll = found.complete;
          // A cataloged repository renamed on GitHub is listed under its new name; it isn't new.
          const renamedTo = new Set(repoNames.map((n) => cache[n]?.fullName?.toLowerCase()).filter((n): n is string => !!n && !known.has(n)));
          extra = found
            .filter((r) => !known.has(r.fullName.toLowerCase()) && !renamedTo.has(r.fullName.toLowerCase()) && !r.archived && (settings.includeForks || !r.fork))
            .map((r) => r.fullName)
            .sort((a, b) => a.localeCompare(b));
          save("uncataloged", extra);
          setUncataloged(extra);
          setDiscovery({ at: new Date().toISOString(), found: found.length, withToken });
        } catch (e) {
          // Cataloged repositories still load; the Repositories view shows why discovery failed.
          setDiscovery({ at: new Date().toISOString(), found: 0, withToken, error: e instanceof Error ? e.message : String(e) });
        }
      }
      const due = repoNames.concat(extra).filter(isDue);
      const gone = load<Record<string, string>>("deletedRepos", {});
      for (const name of due) checked[name] = new Date().toISOString();
      save("checkedAt", checked);
      await Promise.all(
        due.map(async (name) => {
          const cached = cache[name];
          const owner = name.split("/")[0].toLowerCase();
          // Without a token, a complete public listing of the owner that lacks this repository
          // means GitHub would answer 404, so don't spend a request finding that out.
          if (!withToken && listedAll && !metas.has(name.toLowerCase()) && settings.owners.some((o) => o.toLowerCase() === owner)) {
            setRepos((r) => ({ ...r, [name]: { kind: "error", message: PRIVATE_OR_MISSING, data: cached } }));
            return;
          }
          try {
            const data = await fetchRepo(name, workflowsFor(name), {
              meta: metas.get(name.toLowerCase()),
              prev: cached,
              runsEveryMs: force || withToken ? 0 : ANON_RUNS_EVERY_MS,
            });
            cache[name] = data;
            delete gone[name];
            setRepos((r) => ({ ...r, [name]: { kind: "ok", data, stale: false } }));
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            // With a token that sees every repository the owner has, a 404 for one missing from
            // the complete listing means it was deleted (or transferred away), not that it's private.
            if (e instanceof GithubError && e.status === 404 && withToken && listedAll && !metas.has(name.toLowerCase()) && settings.owners.some((o) => o.toLowerCase() === owner))
              gone[name] ??= new Date().toISOString();
            setRepos((r) => ({ ...r, [name]: { kind: "error", message, data: cached } }));
          }
        }),
      );
      save("repoCache", cache);
      save("deletedRepos", gone);
      setDeleted({ ...gone });
      const u = { at: new Date().toISOString(), ...takeUsage(), skipped: repoNames.length + extra.length - due.length, rate: rateLimit() };
      save("usage", u);
      setUsage(u);
      inflight.current = false;
      setRefreshing(false);
    },
    [settings.refreshMinutes, settings.owners, settings.includeForks],
  );

  useEffect(() => {
    if (settings.refreshOnLaunch) void refresh();
    else setRepos((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.kind === "loading" ? { kind: "error", message: "Not loaded yet. Use Refresh." } : v])));
    // Only refresh on a timer while the window is visible; catch up when it comes back.
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, settings.refreshMinutes * 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh]);

  const live = useMemo(() => liveCatalog(catalog, repos, deleted), [repos, deleted]);

  const value = useMemo<AtlasState>(
    () => ({
      catalog: live.catalog,
      hidden: live.hidden,
      renamed: live.renamed,
      manifestIssues,
      repos,
      uncataloged,
      discovery,
      usage,
      refreshing,
      refresh,
      view,
      // A selection belongs to the view it was made in.
      setView: (v) => {
        setViewState(v);
        select(null);
      },
      selection,
      select,
      filters,
      setFilters: (f) => setFiltersState((prev) => ({ ...prev, ...f })),
      clearFilters: () => setFiltersState(EMPTY_FILTERS),
      settings,
      setSettings: (s) =>
        setSettingsState((prev) => {
          const next = { ...prev, ...s };
          save("settings", next);
          return next;
        }),
      clearCache: () => {
        save("repoCache", {});
        save("discovery", null);
        save("checkedAt", {});
        save("deletedRepos", {});
        setDeleted({});
        clearEtags();
        void refresh(true);
      },
    }),
    [live, repos, uncataloged, discovery, usage, refreshing, refresh, view, selection, filters, settings],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAtlas(): AtlasState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAtlas outside AtlasProvider");
  return v;
}
