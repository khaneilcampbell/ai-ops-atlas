import { actionsApi } from "../actions/api";
import type { Catalog } from "../catalog/types";
import { fetchManageData } from "../manage/data";
import { managedAgent, MANIFEST } from "../manage/manifest";
import type { ExecContext } from "../tasks/adapters";
import { taskService } from "../tasks/store";
import { runStore } from "../workflows/runs";
import { adapterRouter, githubAdapter } from "./adapters";
import { bridgeAdapter, siteBridge } from "./bridgeClient";
import { ledgerStore } from "./ledger";
import { Orchestrator } from "./orchestrator";
import { intelStore } from "../intelligence/app";
import { buildStepContext } from "../intelligence/benjaire";
import { productStore } from "../product/workspace";
import { stepProblem } from "../product/templates";
import { emergencyStopReason } from "../operations/store";

// The app's orchestrator: the device's task, run and ledger stores, with the real adapters. GitHub
// runs keep their Touch ID path in the Task Center (a person starts them); n8n stays read-only.
// Recovery runs once per app start.

let shared: { orch: Orchestrator; key: string } | null = null;
let recovered = false;
/** Whether the site says the n8n bridge is set up; checked once per app start. */
let bridgeOn = false;
let bridgeChecked = false;

export function appOrchestrator(catalog: Catalog, ctx: ExecContext): Orchestrator {
  const key = `${ctx.desktop}:${ctx.agentsToken}`;
  if (!shared || shared.key !== key) {
    const github = githubAdapter({
      ctx,
      runNow: async (agentId) => {
        const data = await fetchManageData(MANIFEST).catch(() => null);
        const wf = managedAgent(agentId)?.workflow;
        return actionsApi.agentAction(agentId, "run_now", (wf && data?.workflows?.[wf]?.state) ?? null);
      },
      // Run lists for reconciliation come from the Task Center's GitHub poll; none here, so a stale
      // GitHub attempt is held for a person to check rather than guessed.
      listRuns: async () => [],
    });
    shared = {
      key,
      orch: new Orchestrator({
        tasks: taskService(),
        runs: runStore(),
        ledger: ledgerStore(),
        catalog,
        adapterFor: adapterRouter(github, bridgeAdapter(siteBridge, () => bridgeOn)),
        // The active workspace's agent switches and model limits, read fresh before every send.
        agentGate: (node) => {
          const f = productStore().snapshot;
          return stepProblem(node, f.workspaces.find((w) => w.id === f.activeId) ?? null, catalog);
        },
        // Retrieved knowledge, granted tools and the model route travel with each step sent.
        context: (run, nodeId, task, attempt) => buildStepContext(intelStore(catalog), run, nodeId, task, attempt),
        // Phase 9: Mission Control's emergency stop holds every new send and automatic retry.
        emergencyStop: emergencyStopReason,
      }),
    };
  }
  if (!bridgeChecked) {
    bridgeChecked = true;
    void siteBridge
      .status()
      .then((v) => (bridgeOn = v))
      .catch(() => (bridgeOn = false));
  }
  if (!recovered) {
    recovered = true;
    shared.orch.recover();
  }
  return shared.orch;
}
