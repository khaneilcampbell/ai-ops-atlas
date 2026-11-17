import { useMemo } from "react";
import { useActions } from "../../actions/state";
import { useProposals } from "../../approvals/state";
import type { AgentJob } from "../../catalog/agentJobs";
import { agentPlaces } from "../../catalog/agentPlaces";
import { useIntel } from "../../intel/state";
import { useAtlas } from "../../state";
import { officeRows } from "../office/officeRows";
import { buildAgentTag, type AgentTagInfo } from "./agentTagInfo";

/**
 * The card for the agent under the pointer on the map. Nothing is computed until an agent is
 * pointed at, and then only that agent's row, from the same sources as its desk (officeRows).
 */
export function useAgentTag(agentId: string | null, jobs: AgentJob[] | undefined): AgentTagInfo | null {
  const { catalog, repos } = useAtlas();
  const { telemetry: intel } = useIntel();
  const actions = useActions();
  const pending = useProposals();
  const places = useMemo(() => (agentId ? agentPlaces(catalog, jobs) : null), [agentId !== null, catalog, jobs]); // eslint-disable-line react-hooks/exhaustive-deps
  return useMemo(() => {
    const agent = agentId ? catalog.agents.find((a) => a.id === agentId) : undefined;
    if (!agent || !places) return null;
    const rows = officeRows(catalog.projects, [agent], repos, intel, { available: actions.available, status: actions.status, audit: actions.audit }, pending);
    const role = jobs?.find((j) => j.agentId === agent.id)?.role.value ?? null;
    return buildAgentTag(agent.id, rows.get(agent.id), places.get(agent.id), role);
  }, [agentId, catalog, places, repos, intel, actions.available, actions.status, actions.audit, pending, jobs]);
}
