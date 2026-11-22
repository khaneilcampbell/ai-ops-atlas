import { workflow, node, trigger } from "@n8n/workflow-sdk";

const every = trigger({ type: "n8n-nodes-base.scheduleTrigger", version: 1.2, config: { name: "Every 30 minutes", parameters: { rule: { interval: [{ field: "minutes", minutesInterval: 30 }] } } } });

const tick = node({ type: "n8n-nodes-base.httpRequest", version: 4.2, config: { name: "Ask Atlas to reconcile", parameters: { method: "POST", url: "https://ai-ops-atlas.pages.dev/api/hooks/executive-tick", authentication: "genericCredentialType", genericAuthType: "httpBearerAuth", sendBody: true, specifyBody: "json", jsonBody: "{\"contract\":\"ATLAS_EXECUTIVE_SCHEDULE\",\"version\":1}", options: { timeout: 30000 } }, credentials: { httpBearerAuth: { id: "itbZy0VhTp6mx3Kc", name: "Atlas bridge (callback)" } } } });

export default workflow("atlas-executive-schedule", "Atlas · Executive Schedule").add(every).to(tick);
