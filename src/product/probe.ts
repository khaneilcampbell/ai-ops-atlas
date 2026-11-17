import { useCallback, useEffect, useMemo, useState } from "react";
import { anthropicKey, intelApi } from "../intel/api";
import { isHostedWeb, isTauri } from "../lib/env";
import { syncStatus } from "../lib/syncStatus";
import { tokenStore } from "../lib/token";
import { fetchHealth, type HealthLoad } from "../observability/health";
import { useAtlas } from "../state";
import { usageSync, syncConfigured } from "../usage/sync";
import { integrationStates, type Platform, type ProbeInput } from "./integrations";

// Gathers what the Integration Center needs from systems Atlas already has. One health read is
// shared by every panel for five minutes, so opening Setup, Integrations and Administration in turn
// doesn't hit the site again; "Check again" is the only way to force one. Nothing polls.

const HEALTH_TTL_MS = 5 * 60_000;
let cached: { at: number; load: Promise<HealthLoad> } | null = null;

export function sharedHealth(force = false): Promise<HealthLoad> {
  if (!force && cached && Date.now() - cached.at < HEALTH_TTL_MS) return cached.load;
  cached = { at: Date.now(), load: fetchHealth() };
  return cached.load;
}

export const platform = (): Platform => (isTauri() ? "desktop" : isHostedWeb() ? "web" : "local");

interface Local {
  githubToken: boolean | null;
  anthropicKey: boolean | null;
  intelLast: ProbeInput["intelLast"];
  siteLinked: boolean | null;
}

export function useIntegrationProbe() {
  const { catalog, repos, uncataloged } = useAtlas();
  const [health, setHealth] = useState<HealthLoad>({ kind: "loading" });
  const [local, setLocal] = useState<Local>({ githubToken: null, anthropicKey: null, intelLast: null, siteLinked: null });
  const [checking, setChecking] = useState(false);

  const check = useCallback(async (force = false) => {
    setChecking(true);
    const desktop = isTauri();
    const [h, gh, ak, intel, sync] = await Promise.all([
      sharedHealth(force),
      tokenStore.has().catch(() => false),
      desktop ? anthropicKey.has().catch(() => false) : Promise.resolve(false),
      desktop ? intelApi.status().catch(() => null) : Promise.resolve(null),
      desktop ? usageSync.status().catch(() => null) : Promise.resolve(null),
    ]);
    const last = intel?.runs.filter((r) => r.finished_at && (r.status === "succeeded" || r.status === "failed")).sort((a, b) => b.finished_at!.localeCompare(a.finished_at!))[0];
    setHealth(h);
    setLocal({
      githubToken: gh,
      anthropicKey: ak,
      intelLast: last ? { at: last.finished_at!, ok: last.status === "succeeded", error: last.error?.message } : null,
      siteLinked: desktop ? syncConfigured(sync) : null,
    });
    setChecking(false);
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  const tracked = useMemo(() => new Set([...catalog.projects.map((p) => p.repository), ...catalog.agents.map((a) => a.repository), ...uncataloged]), [catalog, uncataloged]);
  const gh = useMemo(() => syncStatus(tracked, repos), [tracked, repos]);
  const input: ProbeInput = useMemo(
    () => ({ platform: platform(), health, ...local, github: { loaded: gh.loaded, failing: gh.failing.length, lastFetched: gh.lastFetched ?? null, reasons: gh.reasons } }),
    [health, local, gh],
  );
  const states = useMemo(() => integrationStates(input), [input]);
  return { states, health, checking, check, input };
}
