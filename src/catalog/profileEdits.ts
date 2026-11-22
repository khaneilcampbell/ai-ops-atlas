import { useSyncExternalStore } from "react";
import { isHostedWeb, isTauri } from "../lib/env";
import { PROFILE_FIELDS, type ProfileEdit, type ProfileEditLogRow, type ProfileEditWrite, type ProfileField } from "../data/profileEdits";
import type { Agent } from "./types";

// Agent profile text edited in Atlas, laid over the catalog so every tab shows it.
//
// The catalog files stay the defaults. Edits come from the Atlas database through /api/data
// (behind Cloudflare Access) and are written onto the same agent objects every tab reads, so the
// Agents tab, the map, offices, Task Center and reports all show the edited name at once. Only
// display text changes: ids, status, trigger, tools, permissions and links are never touched.

/** The repository text of each editable field, captured before any edit is applied. */
type Pristine = Record<ProfileField, string | null>;
const pristine = new Map<string, Pristine>();

/** Whether a field can be edited for this agent: persona fields need a persona in the catalog. */
export function editableFields(agent: Agent): ProfileField[] {
  const persona = !!agent.registry?.identity;
  return PROFILE_FIELDS.filter((f) => persona || (f !== "display_name" && f !== "intro" && f !== "voice"));
}

/** The text the catalog (not Atlas) gives this field. */
export function repositoryText(agent: Agent, field: ProfileField): string | null {
  return (pristine.get(agent.id) ?? readFields(agent))[field];
}

function readFields(a: Agent): Pristine {
  const idn = a.registry?.identity;
  return {
    display_name: idn?.displayName ?? null,
    title: a.name,
    summary: a.registry?.summary ?? a.purpose,
    intro: idn?.intro ?? null,
    voice: idn?.voice ?? null,
  };
}

function writeField(a: Agent, field: ProfileField, value: string | null) {
  const idn = a.registry?.identity;
  switch (field) {
    case "display_name":
      if (idn && value !== null) idn.displayName = value;
      break;
    case "title":
      if (value !== null) a.name = value;
      break;
    case "summary":
      if (value === null) break;
      if (a.registry) a.registry.summary = value;
      else a.purpose = value;
      break;
    case "intro":
      if (idn) idn.intro = value ?? undefined;
      break;
    case "voice":
      if (idn) idn.voice = value ?? undefined;
      break;
  }
}

/**
 * Puts every agent back to its repository text, then lays the edits on top. Edits for agents or
 * fields that don't exist (a removed agent, a persona field on an automation) are ignored.
 * Returns which fields of which agents show edited text.
 */
export function applyProfileEdits(agents: Agent[], edits: Pick<ProfileEdit, "entity_id" | "field" | "value">[]): Map<string, Set<ProfileField>> {
  for (const a of agents) if (!pristine.has(a.id)) pristine.set(a.id, readFields(a));
  for (const a of agents) {
    const base = pristine.get(a.id)!;
    for (const f of PROFILE_FIELDS) writeField(a, f, base[f]);
  }
  const byId = new Map(agents.map((a) => [a.id, a]));
  const edited = new Map<string, Set<ProfileField>>();
  for (const e of edits) {
    const a = byId.get(e.entity_id);
    if (!a || !editableFields(a).includes(e.field)) continue;
    writeField(a, e.field, e.value);
    if (!edited.has(a.id)) edited.set(a.id, new Set());
    edited.get(a.id)!.add(e.field);
  }
  return edited;
}

// ---- The live store -------------------------------------------------------------------------------

export type ProfileEditsState =
  | { state: "off"; message: string }
  | { state: "loading" }
  | { state: "unavailable"; message: string }
  | { state: "ready"; edits: ProfileEdit[]; log: ProfileEditLogRow[]; edited: Map<string, Set<ProfileField>> };

let agentsRef: Agent[] = [];
let current: ProfileEditsState = { state: "loading" };
let version = 0;
const listeners = new Set<() => void>();

function set(next: ProfileEditsState) {
  current = next;
  version += 1;
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Re-renders when edits arrive or change. */
export const useProfileEdits = (): ProfileEditsState => useSyncExternalStore(subscribe, () => current, () => current);
/** A number that changes whenever the edited text changes, for memo dependencies. */
export const useProfileEditsVersion = (): number => useSyncExternalStore(subscribe, () => version, () => version);

async function answerOf(r: Response): Promise<Record<string, unknown>> {
  return ((await r.json().catch(() => null)) as Record<string, unknown> | null) ?? {};
}

/** Reads the edits once (the Atlas web page only) and lays them over these agents. */
export async function loadProfileEdits(agents: Agent[], fetcher: typeof fetch = fetch): Promise<void> {
  agentsRef = agents;
  if (!isHostedWeb()) {
    set({ state: "off", message: isTauri() ? "Editing is on the Atlas web page for now. The Mac app shows the repository text." : "Editing works on the hosted Atlas page." });
    return;
  }
  try {
    const r = await fetcher("/api/data/profile-edits", { credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(15_000) });
    const body = await answerOf(r);
    if (!r.ok) {
      set({ state: "unavailable", message: String(body.message ?? `The site answered ${r.status}.`) });
      return;
    }
    const edits = (body.edits as ProfileEdit[]) ?? [];
    set({ state: "ready", edits, log: (body.log as ProfileEditLogRow[]) ?? [], edited: applyProfileEdits(agentsRef, edits) });
  } catch (e) {
    set({ state: "unavailable", message: e instanceof Error && e.name === "TimeoutError" ? "The site didn't answer within 15 seconds." : "Atlas couldn't reach its database." });
  }
}

/** Saves one field (value null puts the repository text back), then shows it everywhere. */
export async function saveProfileEdit(w: ProfileEditWrite, fetcher: typeof fetch = fetch): Promise<{ ok: true } | { ok: false; message: string }> {
  if (current.state !== "ready") return { ok: false, message: "Editing isn't available right now." };
  let r: Response;
  try {
    r = await fetcher("/api/data/profile-edits", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(w),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { ok: false, message: "Atlas couldn't reach the site. Nothing was saved." };
  }
  const body = await answerOf(r);
  if (!r.ok) return { ok: false, message: String(body.message ?? `The site answered ${r.status}. Nothing was saved.`) };
  const edit = body.edit as ProfileEdit | null;
  const prior = current.edits.find((e) => e.entity_id === w.entityId && e.field === w.field);
  const edits = [...current.edits.filter((e) => !(e.entity_id === w.entityId && e.field === w.field)), ...(edit ? [edit] : [])];
  const line: ProfileEditLogRow = { entity_id: w.entityId, field: w.field, before: prior?.value ?? null, after: edit?.value ?? null, actor: edit?.updated_by ?? "Khaneil", at: new Date().toISOString() };
  set({ state: "ready", edits, log: body.changed ? [line, ...current.log] : current.log, edited: applyProfileEdits(agentsRef, edits) });
  return { ok: true };
}

/** Tests only: forget captured repository text and state. */
export function resetProfileEditsForTests() {
  pristine.clear();
  agentsRef = [];
  current = { state: "loading" };
  version = 0;
}
