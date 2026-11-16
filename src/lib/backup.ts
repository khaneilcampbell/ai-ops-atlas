// Backup and restore for the records Atlas keeps only on this device (Task Center, workflow runs and
// their execution ledger, agent memory, business records, settings). The file is plain JSON the
// person saves themselves; nothing is uploaded. Caches that GitHub or the site can rebuild are left
// out, and a backup holding anything shaped like a credential is refused both ways: credentials
// live in the Keychain or Cloudflare secrets, never in this storage.

import { looksSecret } from "./secretPatterns";

export const BACKUP_FORMAT = "atlas-device-backup";
export const BACKUP_VERSION = 1;
const PREFIX = "atlas:";
/** Kept so the last restore can be undone; never itself backed up. */
export const UNDO_KEY = "atlas:backup-undo";
export const MAX_BACKUP_BYTES = 4_000_000;

/** Rebuilt from GitHub, the site or the app on the next refresh; restoring them would only serve stale data. */
const CACHE_KEYS = new Set(["repoCache", "etags", "rate", "checkedAt", "discovery", "n8n-steps-cursor", "tasks-probe", "backup-undo"]);

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: number;
  createdAt: string;
  app: string;
  /** Storage key (without "atlas:") to the stored string, exactly as saved. */
  entries: Record<string, string>;
}

export interface KeyValueStore {
  readonly length: number;
  key(i: number): string | null;
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

export const backedUp = (key: string) => key.startsWith(PREFIX) && !CACHE_KEYS.has(key.slice(PREFIX.length));

function keysOf(store: KeyValueStore): string[] {
  const out: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const k = store.key(i);
    if (k) out.push(k);
  }
  return out;
}

export type BackupResult = { ok: true; backup: Backup; json: string; keys: string[] } | { ok: false; error: string };

/** Everything worth keeping, as one JSON document. */
export function createBackup(store: KeyValueStore, app: string, now = new Date()): BackupResult {
  const entries: Record<string, string> = {};
  for (const k of keysOf(store).filter(backedUp).sort()) {
    const v = store.getItem(k);
    if (v !== null) entries[k.slice(PREFIX.length)] = v;
  }
  const backup: Backup = { format: BACKUP_FORMAT, version: BACKUP_VERSION, createdAt: now.toISOString(), app, entries };
  const json = JSON.stringify(backup, null, 1);
  if (looksSecret(json)) return { ok: false, error: "Something in this device's storage looks like a credential, so Atlas won't put it in a file. Nothing was saved." };
  if (json.length > MAX_BACKUP_BYTES) return { ok: false, error: "The backup is larger than 4 MB, which this device's storage can't hold back." };
  return { ok: true, backup, json, keys: Object.keys(entries) };
}

export type ParseResult = { ok: true; backup: Backup } | { ok: false; error: string };

/** Checks a backup file before anything is changed. Untrusted input: every field is validated. */
export function parseBackup(text: string): ParseResult {
  if (text.length > MAX_BACKUP_BYTES) return { ok: false, error: "That file is larger than any Atlas backup (4 MB)." };
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return { ok: false, error: "That file isn't JSON." };
  }
  const b = v as Partial<Backup> | null;
  if (!b || typeof b !== "object" || b.format !== BACKUP_FORMAT) return { ok: false, error: "That file isn't an Atlas device backup." };
  if (b.version !== BACKUP_VERSION) return { ok: false, error: `That backup is format version ${String(b.version)}; this Atlas reads version ${BACKUP_VERSION}.` };
  if (typeof b.createdAt !== "string" || Number.isNaN(Date.parse(b.createdAt))) return { ok: false, error: "That backup has no valid creation time." };
  if (!b.entries || typeof b.entries !== "object" || Array.isArray(b.entries)) return { ok: false, error: "That backup has no entries." };
  for (const [k, val] of Object.entries(b.entries)) {
    if (!/^[A-Za-z0-9][A-Za-z0-9:_.-]{0,80}$/.test(k) || !backedUp(PREFIX + k)) return { ok: false, error: `That backup has an entry Atlas doesn't restore ("${k.slice(0, 40)}").` };
    if (typeof val !== "string") return { ok: false, error: `The entry "${k}" isn't stored text.` };
    try {
      JSON.parse(val);
    } catch {
      return { ok: false, error: `The entry "${k}" is damaged (not JSON).` };
    }
  }
  if (looksSecret(text)) return { ok: false, error: "That file contains something shaped like a credential. Atlas never restores credentials from a file." };
  return { ok: true, backup: { format: BACKUP_FORMAT, version: BACKUP_VERSION, createdAt: b.createdAt, app: typeof b.app === "string" ? b.app.slice(0, 40) : "unknown", entries: b.entries as Record<string, string> } };
}

export interface RestorePlan {
  /** Keys the backup brings back or replaces. */
  write: string[];
  /** Keys on this device that the backup doesn't have; they are removed so the device matches the backup. */
  remove: string[];
  /** Keys whose stored value is the same as the backup's. */
  unchanged: string[];
}

export function planRestore(store: KeyValueStore, backup: Backup): RestorePlan {
  const current = new Map(keysOf(store).filter(backedUp).map((k) => [k.slice(PREFIX.length), store.getItem(k)]));
  const write: string[] = [];
  const unchanged: string[] = [];
  for (const [k, v] of Object.entries(backup.entries)) (current.get(k) === v ? unchanged : write).push(k);
  const remove = [...current.keys()].filter((k) => !(k in backup.entries));
  return { write: write.sort(), remove: remove.sort(), unchanged: unchanged.sort() };
}

export type RestoreResult = { ok: true; plan: RestorePlan } | { ok: false; error: string };

/**
 * Makes this device's records match the backup. The current records are saved first under
 * UNDO_KEY, so one restore can always be undone; if any write fails, everything is put back.
 */
export function restoreBackup(store: KeyValueStore, backup: Backup, now = new Date()): RestoreResult {
  const before = createBackup(store, "undo", now);
  if (!before.ok) return { ok: false, error: `Couldn't save the current records first, so nothing was changed. ${before.error}` };
  const plan = planRestore(store, backup);
  try {
    store.setItem(UNDO_KEY, before.json);
  } catch {
    return { ok: false, error: "This device's storage is full, so the current records couldn't be kept for undo. Nothing was changed." };
  }
  try {
    for (const k of plan.remove) store.removeItem(PREFIX + k);
    for (const k of plan.write) store.setItem(PREFIX + k, backup.entries[k]);
  } catch {
    rollback(store, before.backup);
    return { ok: false, error: "Writing the backup failed part way, so the previous records were put back." };
  }
  return { ok: true, plan };
}

function rollback(store: KeyValueStore, previous: Backup) {
  for (const k of keysOf(store).filter(backedUp)) if (!(k.slice(PREFIX.length) in previous.entries)) store.removeItem(k);
  for (const [k, v] of Object.entries(previous.entries)) store.setItem(PREFIX + k, v);
}

/** The records as they were just before the last restore, if there was one. */
export function undoAvailable(store: KeyValueStore): Backup | null {
  const raw = store.getItem(UNDO_KEY);
  if (!raw) return null;
  const p = parseBackup(raw);
  return p.ok ? p.backup : null;
}

/** Puts back the records from before the last restore, then forgets the undo copy. */
export function undoRestore(store: KeyValueStore): RestoreResult {
  const prev = undoAvailable(store);
  if (!prev) return { ok: false, error: "There is no restore to undo." };
  const plan = planRestore(store, prev);
  try {
    for (const k of plan.remove) store.removeItem(PREFIX + k);
    for (const k of plan.write) store.setItem(PREFIX + k, prev.entries[k]);
    store.removeItem(UNDO_KEY);
  } catch {
    return { ok: false, error: "Undo failed part way; the undo copy is kept so you can try again." };
  }
  return { ok: true, plan };
}

export const backupFileName = (now = new Date()) => `atlas-backup-${now.toISOString().slice(0, 16).replace(/[:T]/g, "-")}.json`;
