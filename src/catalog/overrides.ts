import { useEffect, useState } from "react";
import { actionsApi } from "../actions/api";
import type { CatalogEdit } from "../actions/types";
import { AUTONOMY_LEVELS, type AutonomyLevel } from "../registry/types";
import type { Catalog } from "./types";

/**
 * Local catalog edits from the desktop app (name, owner, note, autonomy), laid over the
 * bundled manifests. They change only how this Mac shows an agent; the manifest name stays
 * visible as `originalName`. The web build has none.
 */
export function applyOverrides(catalog: Catalog, edits: Record<string, CatalogEdit>): Catalog {
  if (!Object.keys(edits).length) return catalog;
  return {
    ...catalog,
    agents: catalog.agents.map((a) => {
      const e = edits[a.id];
      if (!e) return a;
      const autonomy = (AUTONOMY_LEVELS as readonly number[]).includes(e.autonomy ?? -1) ? (e.autonomy as AutonomyLevel) : undefined;
      const governance = { ...a.registry?.governance, ...(e.owner ? { credentialOwner: e.owner } : {}), ...(autonomy !== undefined ? { autonomy } : {}) };
      return {
        ...a,
        name: e.name || a.name,
        originalName: e.name ? (a.originalName ?? a.name) : a.originalName,
        localNote: e.note || undefined,
        localEdit: e,
        registry: e.owner || autonomy !== undefined ? { ...a.registry, governance } : a.registry,
      };
    }),
  };
}

/** The saved edits, kept fresh from the Rust side's change events. Empty outside the desktop app. */
export function useCatalogOverrides(): Record<string, CatalogEdit> {
  const [edits, setEdits] = useState<Record<string, CatalogEdit>>({});
  useEffect(() => {
    if (!actionsApi.available()) return;
    let unlisten: (() => void) | undefined;
    let live = true;
    const load = () =>
      actionsApi
        .catalogOverrides()
        .then((e) => live && setEdits(e))
        // Older builds without the command: no edits.
        .catch(() => undefined);
    void load();
    void actionsApi.onChange(load).then((u) => (live ? (unlisten = u) : u()));
    return () => {
      live = false;
      unlisten?.();
    };
  }, []);
  return edits;
}
