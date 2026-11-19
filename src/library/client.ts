import { useSyncExternalStore } from "react";
import { isHostedWeb, isTauri } from "../lib/env";
import { listParams, type ListPage, type ListQuery, type OutputDetail } from "./model";

// Reads the Output Library from the site (server/outputs.ts) through /api/outputs, behind
// Cloudflare Access. Files are fetched only from authorized same-origin endpoints; nothing is kept
// in browser storage. The Mac app doesn't read the Library yet (it would need its own sync-key
// route), so it says so instead of showing an empty Library.

export type LibraryAvailability = { ok: true } | { ok: false; message: string };

export function libraryAvailability(): LibraryAvailability {
  if (isHostedWeb()) return { ok: true };
  if (isTauri()) return { ok: false, message: "The Library is on the hosted Atlas page for now. The Mac app can't read it yet." };
  return { ok: false, message: "The Library reads from the hosted site. A plain local preview has no site to ask (npm run preview:library shows development examples)." };
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { credentials: "same-origin", cache: "no-store", ...init });
  const body = (await r.json().catch(() => null)) as (T & { message?: string }) | null;
  if (!r.ok) throw new Error(body?.message ?? `The site answered ${r.status}.`);
  return body as T;
}

export function fetchOutputs(q: ListQuery & { projectAgents?: string[] }, signal?: AbortSignal): Promise<ListPage> {
  const { projectAgents, ...rest } = q;
  const p = listParams(rest);
  if (rest.project && projectAgents?.length) p.set("projectAgents", projectAgents.join(","));
  const s = p.toString();
  return getJson<ListPage>(`/api/outputs${s ? `?${s}` : ""}`, { signal });
}

export const fetchOutput = (id: string, signal?: AbortSignal) => getJson<OutputDetail>(`/api/outputs/${encodeURIComponent(id)}`, { signal });

export const retryOutput = (id: string, version: number) => getJson<{ storage?: string; message?: string }>(`/api/outputs/${encodeURIComponent(id)}/versions/${version}/retry`, { method: "POST" });

/**
 * Archive the agent reports the site still holds, once per page load and only once file storage is
 * connected. The site skips reports it already archived, so a repeat is harmless.
 */
let reconciling: Promise<{ created: number } | null> | null = null;
export function reconcileReportsOnce(): Promise<{ created: number } | null> {
  reconciling ??= getJson<{ created: number }>("/api/outputs/reconcile", { method: "POST" }).catch(() => null);
  return reconciling;
}

export function fileUrl(id: string, version: number, mode: "inline" | "preview" | "download"): string {
  const base = `/api/outputs/${encodeURIComponent(id)}/versions/${version}/file`;
  return mode === "download" ? `${base}?download=1` : mode === "preview" ? `${base}?preview=1` : base;
}

/** The start of a text file (the site sends at most PREVIEW_BYTES) and whether it was cut. */
export async function fetchTextPreview(id: string, version: number, signal?: AbortSignal): Promise<{ text: string; truncatedFrom: number | null }> {
  const r = await fetch(fileUrl(id, version, "preview"), { credentials: "same-origin", cache: "no-store", signal });
  if (!r.ok) throw new Error(((await r.json().catch(() => null)) as { message?: string } | null)?.message ?? `The site answered ${r.status}.`);
  const cut = r.headers.get("x-atlas-truncated");
  return { text: await r.text(), truncatedFrom: cut ? Number(cut) : null };
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
