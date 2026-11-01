import { useMemo } from "react";
import { useActions } from "../../actions/state";
import { useProposals } from "../../approvals/state";
import { projectOfficeAgents } from "../../catalog/workplaces";
import { useIntel } from "../../intel/state";
import { useAtlas } from "../../state";
import { accentFor, planOffice } from "../office/model";
import { officeRows } from "../office/officeRows";
import type { InsideOffice } from "./InsideView";

/**
 * Every headquarters' office for the Inside view: the same desk plan the office draws, and each
 * desk's state from the same verified sources (officeRows). Nothing is computed while Inside is off.
 */
export function useInsideOffices(on: boolean): Map<string, InsideOffice> {
  const { catalog, repos } = useAtlas();
  const { telemetry: intel } = useIntel();
  const actions = useActions();
  const pending = useProposals();
  return useMemo(() => {
    const out = new Map<string, InsideOffice>();
    if (!on) return out;
    const rows = officeRows(catalog.projects, catalog.agents, repos, intel, { available: actions.available, status: actions.status, audit: actions.audit }, pending);
    for (const project of catalog.projects) {
      const agents = projectOfficeAgents(catalog.agents, project.id);
      if (!agents.length) continue;
      const plan = planOffice(project, agents);
      out.set(project.id, {
        plan,
        desks: plan.workstations.map((ws) => ({ ws, state: rows.get(ws.agentId)?.runtime.state ?? "unknown", accent: accentFor(ws.slot, project.id) })),
      });
    }
    return out;
  }, [on, catalog, repos, intel, actions.available, actions.status, actions.audit, pending]);
}
