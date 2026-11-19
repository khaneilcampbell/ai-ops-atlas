import { catalog } from "../../catalog";
import { KHANEIL } from "../../tasks/types";
import { INTEGRATION_CATALOG } from "../../product/integrations";
import { TEMPLATES } from "../../product/templates";
import { productStore } from "../../product/workspace";
import { load } from "../../lib/storage";
import { DEFAULT_TIME_ZONE } from "../../lib/timezone";

// Atlas has one owner, so there is no first-run setup. On launch, a device with no workspace gets
// the Benjaire workspace built from the catalog, silently. A workspace that already exists is kept.

let done = false;
export function ensureWorkspace(now = new Date().toISOString()) {
  if (done) return;
  done = true;
  productStore().migrate(
    {
      projects: catalog.projects.map((p) => p.id),
      agents: catalog.agents.filter((a) => a.status !== "retired").map((a) => a.id),
      integrations: INTEGRATION_CATALOG.map((i) => i.id),
      templates: TEMPLATES.filter((t) => t.definitionId).map((t) => t.id),
      timeZone: load<string>("timeZone", DEFAULT_TIME_ZONE),
    },
    KHANEIL,
    now,
  );
}
