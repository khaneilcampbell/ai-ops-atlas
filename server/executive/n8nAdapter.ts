// The real execution adapter: sends ATLAS_EXECUTIVE_DISPATCH to the n8n "Atlas · Executive Dispatch"
// webhook. Reuses the n8n bridge's secrets (server/n8nBridge.ts): N8N_BRIDGE_TOKEN is the webhook's
// header key (n8n credential "Atlas bridge (webhook)") and N8N_BRIDGE_CALLBACK_TOKEN is the key n8n
// posts results with (credential "Atlas bridge (callback)"). Both live only on the site and in n8n;
// the page and the app never see them. Nothing here can reach any other n8n workflow.

import type { DispatchEnvelope, WorkflowRoute } from "../../src/executive/control/contracts";
import { instanceOf } from "../n8n";
import type { DispatchAnswer, ExecutionAdapter } from "./engine";

export interface N8nExecEnv {
  N8N_BASE_URL?: string;
  N8N_BRIDGE_TOKEN?: string;
  N8N_BRIDGE_CALLBACK_TOKEN?: string;
}

const TIMEOUT_MS = 15_000;
const longEnough = (s?: string) => (s ?? "").trim().length >= 32;
export const n8nConfigured = (env: N8nExecEnv) => longEnough(env.N8N_BRIDGE_TOKEN) && longEnough(env.N8N_BRIDGE_CALLBACK_TOKEN);

export function n8nAdapter(env: N8nExecEnv, fetcher: typeof fetch = fetch): ExecutionAdapter {
  return {
    name: "n8n",
    configured: n8nConfigured(env),
    async dispatch(route: WorkflowRoute, envelope: DispatchEnvelope): Promise<DispatchAnswer> {
      try {
        const r = await fetcher(`${instanceOf(env)}/webhook/${route.webhookPath}`, {
          method: "POST",
          headers: { authorization: `Bearer ${env.N8N_BRIDGE_TOKEN!.trim()}`, "content-type": "application/json", "idempotency-key": envelope.idempotencyKey },
          body: JSON.stringify(envelope),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (r.ok) return { state: "accepted" };
        // 404: the workflow isn't published (n8n only serves published webhooks). Not worth retrying.
        if (r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429) return { state: "refused", error: `n8n refused the dispatch (${r.status})${r.status === 404 ? ": the Executive Dispatch workflow isn't published" : ""}.` };
        return { state: "unknown", error: `n8n answered ${r.status}; the run may or may not have started.` };
      } catch (e) {
        return { state: "unknown", error: `No clear answer from n8n: ${e instanceof Error ? e.message : String(e)}` };
      }
    },
  };
}
