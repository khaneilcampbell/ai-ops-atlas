import { AGENT_ID, type Checked } from "./records";

// Profile edits: text Khaneil changes in Atlas instead of asking for a pull request. They live in
// the Atlas database (atlas.profile_edits) and sit on top of the catalog files, which stay the
// defaults. Only display text is editable. Status, trigger, runs, tools, permissions, links and
// spend caps are never here: they follow n8n and the repository, and agents never read these rows.

export const PROFILE_FIELDS = ["display_name", "title", "summary", "intro", "voice"] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number];
export const isProfileField = (f: unknown): f is ProfileField => typeof f === "string" && (PROFILE_FIELDS as readonly string[]).includes(f);

export const PROFILE_FIELD_SPEC: Record<ProfileField, { label: string; max: number; multiline: boolean; hint: string }> = {
  display_name: { label: "Name", max: 60, multiline: false, hint: "The persona name shown with the agent, such as Samuel Asante." },
  title: { label: "Job title", max: 100, multiline: false, hint: "The role shown under the name on every tab." },
  summary: { label: "Description", max: 600, multiline: true, hint: "What it does, in a sentence or two." },
  intro: { label: "Intro", max: 600, multiline: true, hint: "How it introduces itself on its profile." },
  voice: { label: "Communication style", max: 200, multiline: false, hint: "One line on how it writes." },
};

/** A saved edit, as the data API returns it. */
export interface ProfileEdit {
  entity_id: string;
  field: ProfileField;
  value: string;
  updated_by: string;
  updated_at: string;
  version: number;
}

/** One line of the edit log: what changed, from what, to what, by whom. after null = put back to the repository text. */
export interface ProfileEditLogRow {
  entity_id: string;
  field: ProfileField;
  before: string | null;
  after: string | null;
  actor: string;
  at: string;
}

export interface ProfileEditWrite {
  entityId: string;
  field: ProfileField;
  /** The new text, or null to drop the edit and show the repository text again. */
  value: string | null;
  /** The version the editor last saw; a mismatch means it changed elsewhere since. */
  expectedVersion?: number;
}

// Control characters (other than newline and tab) never belong in display text.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/; // eslint-disable-line no-control-regex

/** Tidies text the way the editor and the server both store it. */
export function cleanProfileText(field: ProfileField, raw: string): string {
  const text = raw.replace(/\r\n?/g, "\n").trim();
  return PROFILE_FIELD_SPEC[field].multiline ? text.replace(/\n{3,}/g, "\n\n") : text.replace(/\s+/g, " ");
}

export function checkProfileText(field: ProfileField, text: string): string | null {
  const spec = PROFILE_FIELD_SPEC[field];
  if (!text) return `${spec.label} can't be empty. Use "Use repository text" to remove an edit.`;
  if (text.length > spec.max) return `${spec.label} can be at most ${spec.max} characters.`;
  if (CONTROL.test(text)) return `${spec.label} has characters Atlas doesn't store.`;
  return null;
}

export function parseProfileEditWrite(body: unknown): Checked<ProfileEditWrite> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Send a JSON object." };
  const b = body as Record<string, unknown>;
  const extra = Object.keys(b).filter((k) => !["entityId", "field", "value", "expectedVersion"].includes(k));
  if (extra.length) return { ok: false, error: `Unknown fields: ${extra.join(", ")}.` };
  if (typeof b.entityId !== "string" || !AGENT_ID.test(b.entityId)) return { ok: false, error: "entityId must be an agent id (lowercase letters, digits and dashes)." };
  if (!isProfileField(b.field)) return { ok: false, error: `field must be one of ${PROFILE_FIELDS.join(", ")}.` };
  if (b.expectedVersion !== undefined && (!Number.isInteger(b.expectedVersion) || (b.expectedVersion as number) < 1)) return { ok: false, error: "expectedVersion must be a whole number." };
  if (b.value === null) return { ok: true, value: { entityId: b.entityId, field: b.field, value: null, expectedVersion: b.expectedVersion as number | undefined } };
  if (typeof b.value !== "string") return { ok: false, error: "value must be text, or null to use the repository text." };
  const text = cleanProfileText(b.field, b.value);
  const problem = checkProfileText(b.field, text);
  if (problem) return { ok: false, error: problem };
  return { ok: true, value: { entityId: b.entityId, field: b.field, value: text, expectedVersion: b.expectedVersion as number | undefined } };
}
