import type { Deploy } from "../properties/deploys";
import { deployIncidents, type Incident } from "../properties/incidents";
import { HOSTS, type HostTarget } from "./hosts";

// Infrastructure incidents: the websites' own incidents (from their dashboards) plus failed or
// stuck deploys of the hosts no website dashboard watches (Atlas web and the Mac app). Same rules
// as the websites: only observed data, and the newest finished deploy decides.

const MAC_NOTE = "Installed Macs keep the last published build until a new one is published.";
const SITE_NOTE = "The site keeps serving the last good deploy until a new one succeeds.";

const newestFirst = (a: Deploy, b: Deploy) => Date.parse(b.at) - Date.parse(a.at);

export function hostIncidents(h: HostTarget, deploys: readonly Deploy[], now: number): Incident[] {
  const target = { id: h.id, domain: h.name, repository: h.repository, deployConsole: h.console };
  return deployIncidents(target, [...deploys].sort(newestFirst), now).map((i) => (h.id === "atlas-mac" ? { ...i, detail: i.detail.replace(SITE_NOTE, MAC_NOTE) } : i));
}

const RANK = { critical: 0, warning: 1 } as const;

/** Every open infrastructure incident, critical first, then newest. */
export function infraIncidents(websites: readonly Incident[], byHost: ReadonlyMap<string, readonly Deploy[] | null>, now: number): (Incident & { hostName: string })[] {
  const name = new Map(HOSTS.map((h) => [h.id, h.name]));
  const own = HOSTS.filter((h) => !h.propertyId).flatMap((h) => hostIncidents(h, byHost.get(h.id) ?? [], now));
  return [...websites, ...own]
    .map((i) => ({ ...i, hostName: name.get(i.propertyId) ?? i.propertyId }))
    .sort((a, b) => RANK[a.severity] - RANK[b.severity] || Date.parse(b.since) - Date.parse(a.since));
}
