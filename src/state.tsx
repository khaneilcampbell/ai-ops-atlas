import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { catalog, manifestIssues, type Catalog, type ManifestIssue } from "./catalog";
import { discoverRepos } from "./github/discover";
import { fetchRepo } from "./github/fetchRepo";
import { clearEtags } from "./github/transport";
import { tokenStore } from "./lib/token";
import type { RepoSnapshot, RepoState } from "./github/types";
import { load, save } from "./lib/storage";

export type View = "overview" | "agents" | "repos" | "map" | "settings";
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
  catalog: Catalog;
  manifestIssues: ManifestIssue[];
  repos: Record<string, RepoState>;
  /** Repositories found on GitHub that no manifest mentions. */
  uncataloged: string[];
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
  const [repos, setRepos] = useState<Record<string, RepoState>>(() => fromCache(load<Cache>("repoCache", {}), uncataloged, settings.refreshMinutes * 60_000));
  const [refreshing, setRefreshing] = useState(false);
  const [view, setViewState] = useState<View>(() => load<View>("view", "overview"));
  const [selection, select] = useState<Selection>(null);
  const [filters, setFiltersState] = useState<Filters>(EMPTY_FILTERS);
  const inflight = useRef(false);

  const refresh = useCallback(
    async (force = false) => {
      if (inflight.current) return;
      inflight.current = true;
      setRefreshing(true);
      const cache = load<Cache>("repoCache", {});
      const maxAge = settings.refreshMinutes * 60_000;
      let extra = load<string[]>("uncataloged", []);
      if (settings.owners.length) {
        try {
          const found = await discoverRepos(settings.owners, await tokenStore.has().catch(() => false));
          extra = found
            .filter((r) => !known.has(r.fullName.toLowerCase()) && (settings.includeForks || !r.fork))
            .map((r) => r.fullName)
            .sort((a, b) => a.localeCompare(b));
          save("uncataloged", extra);
          setUncataloged(extra);
        } catch {
          /* discovery is best effort; cataloged repositories still load */
        }
      }
      await Promise.all(
        repoNames.concat(extra).map(async (name) => {
          const cached = cache[name];
          if (!force && cached && Date.now() - Date.parse(cached.fetchedAt) < maxAge) return;
          try {
            const data = await fetchRepo(name, workflowsFor(name));
            cache[name] = data;
            setRepos((r) => ({ ...r, [name]: { kind: "ok", data, stale: false } }));
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            setRepos((r) => ({ ...r, [name]: { kind: "error", message, data: cached } }));
          }
        }),
      );
      save("repoCache", cache);
      inflight.current = false;
      setRefreshing(false);
    },
    [settings.refreshMinutes, settings.owners, settings.includeForks],
  );

  useEffect(() => {
    if (settings.refreshOnLaunch) void refresh();
    else setRepos((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.kind === "loading" ? { kind: "error", message: "Not loaded yet. Use Refresh." } : v])));
    const t = setInterval(() => void refresh(), settings.refreshMinutes * 60_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh]);

  const value = useMemo<AtlasState>(
    () => ({
      catalog,
      manifestIssues,
      repos,
      uncataloged,
      refreshing,
      refresh,
      view,
      setView: (v) => {
        setViewState(v);
        save("view", v === "settings" ? "overview" : v);
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
        clearEtags();
        void refresh(true);
      },
    }),
    [repos, uncataloged, refreshing, refresh, view, selection, filters, settings],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAtlas(): AtlasState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAtlas outside AtlasProvider");
  return v;
}
