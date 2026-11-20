import { useSyncExternalStore } from "react";
import { isHostedWeb, isTauri } from "../lib/env";
import { listParams, type ListPage, type ListQuery, type OutputDetail } from "./model";

// Reads the Output Library from the site (server/outputs.ts). The web page asks /api/outputs, behind
// Cloudflare Access. The Mac app has no Access session, so it asks the same site through its Rust
// shell (src-tauri/src/library.rs) with the website sync key it already keeps in the Keychain; that
// route (/api/hooks/library) is read-only, so retry and reconcile stay on the web page. Files are
// fetched only from those authorized endpoints; nothing is kept in browser storage.

export type LibraryAvailability = { ok: true } | { ok: false; message: string };

export function libraryAvailability(): LibraryAvailability {
  if (isHostedWeb() || isTauri()) return { ok: true };
  return { ok: false, message: "The Library reads from the hosted site. A plain local preview has no site to ask (npm run preview:library shows development examples)." };
}

/** Retry and reconcile change the Library, so only the signed-in web page offers them. */
export const canChangeLibrary = (): boolean => !isTauri();

/** Calls a Rust command of the Mac app. Tests pass their own. */
export type Ask = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

async function invokeCommand(command: string, args?: Record<string, unknown>): Promise<unknown> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke(command, args);
}

export const WEBSITE_SYNC_OFF = "The Mac app reads the Library through website sync. Turn it on in Settings → Website sync.";

/** Rust errors arrive as strings; keep the site's own words, without the live-updates wording. */
const appError = (e: unknown) => new Error((e instanceof Error ? e.message : String(e)).replace(/^The site refused live updates/, "The site refused the Library"));

/** The Mac app's answer, or a plain error when website sync is off or the page moved on. */
async function fromApp<T>(ask: Ask, command: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  let value: unknown;
  try {
    value = await ask(command, args);
  } catch (e) {
    throw appError(e);
  }
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  if (value == null) throw new Error(WEBSITE_SYNC_OFF);
  return value as T;
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { credentials: "same-origin", cache: "no-store", ...init });
  const body = (await r.json().catch(() => null)) as (T & { message?: string }) | null;
  if (!r.ok) throw new Error(body?.message ?? `The site answered ${r.status}.`);
  return body as T;
}

export function fetchOutputs(q: ListQuery & { projectAgents?: string[] }, signal?: AbortSignal, ask: Ask = invokeCommand): Promise<ListPage> {
  const { projectAgents, ...rest } = q;
  const p = listParams(rest);
  if (rest.project && projectAgents?.length) p.set("projectAgents", projectAgents.join(","));
  if (isTauri()) return fromApp<ListPage>(ask, "library_list", { query: [...p.entries()] }, signal);
  const s = p.toString();
  return getJson<ListPage>(`/api/outputs${s ? `?${s}` : ""}`, { signal });
}

export const fetchOutput = (id: string, signal?: AbortSignal, ask: Ask = invokeCommand) =>
  isTauri() ? fromApp<OutputDetail>(ask, "library_output", { id }, signal) : getJson<OutputDetail>(`/api/outputs/${encodeURIComponent(id)}`, { signal });

export const retryOutput = (id: string, version: number) => getJson<{ storage?: string; message?: string }>(`/api/outputs/${encodeURIComponent(id)}/versions/${version}/retry`, { method: "POST" });

/**
 * Archive the agent reports the site still holds, once per page load and only once file storage is
 * connected. The site skips reports it already archived, so a repeat is harmless. Web page only.
 */
let reconciling: Promise<{ created: number } | null> | null = null;
export function reconcileReportsOnce(): Promise<{ created: number } | null> {
  if (!canChangeLibrary()) return Promise.resolve(null);
  reconciling ??= getJson<{ created: number }>("/api/outputs/reconcile", { method: "POST" }).catch(() => null);
  return reconciling;
}

export function fileUrl(id: string, version: number, mode: "inline" | "preview" | "download"): string {
  const base = `/api/outputs/${encodeURIComponent(id)}/versions/${version}/file`;
  return mode === "download" ? `${base}?download=1` : mode === "preview" ? `${base}?preview=1` : base;
}

type AppFile = { mime: string; base64: string; truncatedFrom: number | null };

function bytesOf(base64: string): Uint8Array {
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** The start of a text file (the site sends at most PREVIEW_BYTES) and whether it was cut. */
export async function fetchTextPreview(id: string, version: number, signal?: AbortSignal, ask: Ask = invokeCommand): Promise<{ text: string; truncatedFrom: number | null }> {
  if (isTauri()) {
    const f = await fromApp<AppFile>(ask, "library_file", { id, version, preview: true }, signal);
    return { text: new TextDecoder().decode(bytesOf(f.base64)), truncatedFrom: f.truncatedFrom ?? null };
  }
  const r = await fetch(fileUrl(id, version, "preview"), { credentials: "same-origin", cache: "no-store", signal });
  if (!r.ok) throw new Error(((await r.json().catch(() => null)) as { message?: string } | null)?.message ?? `The site answered ${r.status}.`);
  const cut = r.headers.get("x-atlas-truncated");
  return { text: await r.text(), truncatedFrom: cut ? Number(cut) : null };
}

/**
 * Where an image preview loads from: the authorized file route on the web page; in the Mac app the
 * bytes come through the Rust shell as a data: URL (the app's CSP allows data: images only), and
 * only when the site served it as an image.
 */
export async function imageSource(id: string, version: number, signal?: AbortSignal, ask: Ask = invokeCommand): Promise<string> {
  if (!isTauri()) return fileUrl(id, version, "inline");
  const f = await fromApp<AppFile>(ask, "library_file", { id, version, preview: false }, signal);
  if (!/^image\/(png|jpeg|gif|webp)$/.test(f.mime)) throw new Error("This image downloads instead of previewing.");
  return `data:${f.mime};base64,${f.base64}`;
}

/** Formats the Mac app opens in their default app (mirrors src-tauri/src/library.rs OPENABLE). */
const OPENABLE = new Set(["pdf", "png", "jpg", "jpeg", "gif", "webp", "txt", "md", "csv", "tsv", "json", "docx", "xlsx", "pptx"]);
export const canOpenOnMac = (fileName: string): boolean => OPENABLE.has(fileName.split(".").pop()?.toLowerCase() ?? "");

/** Mac app: opens the file in its default app (Preview for a PDF). */
export async function openOnMac(id: string, version: number, name: string, ask: Ask = invokeCommand): Promise<void> {
  await ask("library_open", { id, version, name }).catch((e) => Promise.reject(appError(e)));
}

/** Mac app: asks where to save, then saves the whole file. `false` when cancelled. */
export async function saveOnMac(id: string, version: number, name: string, ask: Ask = invokeCommand): Promise<boolean> {
  return (await ask("library_save", { id, version, name }).catch((e) => Promise.reject(appError(e)))) === true;
}

// --- Drawer open state, shared by the map toolbar and the Knowledge & Research Center. ---

let open = false;
let returnFocus: HTMLElement | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export function openLibrary() {
  if (open) return;
  returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  open = true;
  emit();
}

/** Close and hand focus back to whatever opened it (the toolbar button or the building's entry). */
export function closeLibrary() {
  if (!open) return;
  open = false;
  emit();
  const el = returnFocus;
  returnFocus = null;
  if (el?.isConnected) requestAnimationFrame(() => el.focus());
}

export function useLibraryOpen(): boolean {
  return useSyncExternalStore(
    (f) => (subs.add(f), () => subs.delete(f)),
    () => open,
    () => false,
  );
}
