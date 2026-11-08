import { useMemo } from "react";
import { categoryLabel, districtLabel, organize, tierLabel, type Decided, type OrgRecord } from "../catalog/organization";
import { AGENT_TIERS, AUTOMATION_CATEGORIES } from "../catalog/taxonomy";
import type { Agent, Project } from "../catalog/types";
import type { ActivityItem } from "../lib/derive";
import { formatDate, relative } from "../lib/time";
import { useAtlas } from "../state";
import { frameworkColor } from "../views/mapLayout";
import { ExternalLink, StatusPill, statusLabel } from "./bits";

// How a building fits the organization: district, agent tiers, automation categories and the
// latest activity Atlas actually recorded. Everything comes from manifests or synced GitHub data.

export function useOrganization() {
  const { catalog } = useAtlas();
  return useMemo(() => organize(catalog), [catalog]);
}

const how = (d: Decided<unknown>) => (d.provenance === "declared" ? "Declared in the manifest" : `Inferred: ${d.reason}`);

/** "2 Central Operations · 1 Specialized Agent", in tier order. */
function countBy<K extends string>(records: OrgRecord[], keys: readonly K[], of: (r: OrgRecord) => K, label: (k: K) => string) {
  return keys
    .map((k) => [k, records.filter((r) => of(r) === k).length] as const)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} ${label(k)}`)
    .join(" · ");
}

const ACTIVITY_SOURCE: Record<ActivityItem["kind"], string> = { commit: "GitHub commit", run: "GitHub Actions run", agent: "Manifest history" };

export function ProjectOrganization({ project, agents, latest }: { project: Project; agents: Agent[]; latest?: ActivityItem }) {
  const org = useOrganization();
  const district = org.districts.get(project.id);
  const records = agents.map((a) => org.records.get(a.id)).filter((r): r is OrgRecord => !!r);
  const ai = records.filter((r) => r.kind === "ai-agent");
  const automations = records.filter((r) => r.kind === "automation");
  return (
    <section>
      <div className="section-head">
        <div className="section-title">Organization</div>
        <span className="source">Manifests and synced GitHub data</span>
      </div>
      <dl className="kv">
        {district && (
          <>
            <dt>District</dt>
            <dd title={how(district)}>
              {districtLabel(district.value)}
              {district.provenance === "inferred" && <span className="muted small"> · inferred</span>}
            </dd>
          </>
        )}
        <dt>Status</dt>
        <dd>
          {statusLabel(project.status)} <span className="muted small">· declared in the manifest</span>
        </dd>
        <dt>AI agents</dt>
        <dd>{ai.length ? countBy(ai, AGENT_TIERS, (r) => r.tier.value, tierLabel) : <span className="muted">None registered</span>}</dd>
        <dt>Automations</dt>
        <dd>{automations.length ? countBy(automations, AUTOMATION_CATEGORIES, (r) => r.category.value, categoryLabel) : <span className="muted">None registered</span>}</dd>
        <dt>Latest activity</dt>
        <dd>
          {latest ? (
            <>
              {latest.url ? <ExternalLink href={latest.url}>{latest.title}</ExternalLink> : latest.title}
              <div className="muted small" title={formatDate(latest.at)}>
                {ACTIVITY_SOURCE[latest.kind]} · {relative(latest.at)}
              </div>
            </>
          ) : (
            <span className="muted">Nothing recorded yet</span>
          )}
        </dd>
      </dl>
    </section>
  );
}

/** District, tier, role and category rows for an agent's details. */
export function AgentOrganizationRows({ id }: { id: string }) {
  const r = useOrganization().records.get(id);
  if (!r) return null;
  return (
    <>
      <dt>District</dt>
      <dd title={how(r.district)}>{districtLabel(r.district.value)}</dd>
      <dt>Role</dt>
      <dd>{r.role}</dd>
      <dt>Tier</dt>
      <dd title={how(r.tier)}>{tierLabel(r.tier.value)}</dd>
      <dt>Function</dt>
      <dd title={how(r.category)}>{categoryLabel(r.category.value)}</dd>
    </>
  );
}

/** A project's items in two lists: AI agents with their tier, automations with their function. */
export function GroupedAgents({ agents, onPick }: { agents: Agent[]; onPick: (id: string) => void }) {
  const org = useOrganization();
  const groups = [
    { title: "AI agents", kind: "ai-agent" as const, meta: (r: OrgRecord) => tierLabel(r.tier.value) },
    { title: "Automations", kind: "automation" as const, meta: (r: OrgRecord) => categoryLabel(r.category.value) },
  ];
  return (
    <>
      {groups.map((g) => {
        const items = agents.filter((a) => org.records.get(a.id)?.kind === g.kind);
        if (!items.length) return null;
        return (
          <section key={g.kind}>
            <div className="section-head">
              <div className="section-title">
                {g.title} ({items.length})
              </div>
              <span className="source">Declared in the manifest</span>
            </div>
            <ul className="list" style={{ padding: 0 }}>
              {items.map((a) => {
                const r = org.records.get(a.id)!;
                return (
                  <li key={a.id}>
                    <button className="list-row" onClick={() => onPick(a.id)}>
                      <i className="roof" style={{ background: a.status === "attention" ? "var(--gold)" : frameworkColor(a.framework) }} />
                      <span className="grow">
                        <div className="title">{a.name}</div>
                        <div className="meta">
                          {g.meta(r)} · {a.framework}
                          {a.trigger ? ` · ${a.trigger}` : ""}
                        </div>
                      </span>
                      <StatusPill status={a.status} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </>
  );
}
