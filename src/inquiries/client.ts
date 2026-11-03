import { useEffect, useState } from "react";
import { isHostedWeb, isTauri } from "../lib/env";
import { onLiveEvents } from "../live/feed";
import { validInquiry, type Inquiry } from "./model";

// Reads the inquiry inbox from the site (server/inquiries.ts): the signed-in page through
// /api/inquiries, the Mac app through its sync key. Refreshes when the live feed says one landed.

export interface InquiriesState {
  /** off: no site to ask (plain dev, or website sync not set up on the Mac). */
  state: "off" | "loading" | "ready" | "error";
  message: string | null;
  inquiries: Inquiry[];
  /** Whether the site can send a reviewed reply as the designed email (mail key + sender set). */
  canSend: boolean;
}

interface Page {
  configured: boolean;
  reply?: { enabled?: boolean };
  inquiries: unknown[];
}

async function fetchInquiries(): Promise<Page | null> {
  if (isHostedWeb()) {
    const r = await fetch("/api/inquiries", { credentials: "same-origin", cache: "no-store" });
    if (!r.ok) throw new Error(((await r.json().catch(() => null)) as { message?: string } | null)?.message ?? `The site answered ${r.status}.`);
    return (await r.json()) as Page;
  }
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<Page | null>("live_inquiries");
  }
  return null;
}

/** Only well-formed inquiries survive; the site checks too, this guards against an older site. */
export function cleanInquiries(page: Page): Inquiry[] {
  return (Array.isArray(page.inquiries) ? page.inquiries : []).filter(validInquiry);
}

export function useInquiries(): InquiriesState {
  const [s, setS] = useState<InquiriesState>({ state: "loading", message: null, inquiries: [], canSend: false });
  const [tick, setTick] = useState(0);

  useEffect(
    () =>
      onLiveEvents((events) => {
        if (events.some((e) => e.kind === "inquiry")) setTick((n) => n + 1);
      }),
    [],
  );

  useEffect(() => {
    let alive = true;
    fetchInquiries()
      .then((page) => {
        if (!alive) return;
        if (!page) setS({ state: "off", message: "The inbox needs website sync (Settings → Website sync).", inquiries: [], canSend: false });
        else if (!page.configured) setS({ state: "off", message: "The inquiry inbox isn't set up on the site yet.", inquiries: [], canSend: false });
        else setS({ state: "ready", message: null, inquiries: cleanInquiries(page), canSend: page.reply?.enabled === true });
      })
      .catch((e) => alive && setS((prev) => ({ state: "error", message: e instanceof Error ? e.message : String(e), inquiries: prev.inquiries, canSend: prev.canSend })));
    return () => {
      alive = false;
    };
  }, [tick]);

  return s;
}

export interface ReplyToSend {
  id: string;
  /** One per send attempt, so a double tap or retry reaches the client once. */
  key: string;
  subject: string;
  body: string;
}

/** Sends a reviewed reply from the site. Resolves with the address it went to; throws a readable message. */
export async function sendInquiryReply(r: ReplyToSend): Promise<string> {
  if (isHostedWeb()) {
    const res = await fetch("/api/inquiries/reply", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(r) });
    const j = (await res.json().catch(() => null)) as { message?: string; to?: string } | null;
    if (!res.ok) throw new Error(j?.message ?? `The site answered ${res.status}.`);
    return j?.to ?? "the client";
  }
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    const j = await invoke<{ to?: string }>("live_inquiry_reply", { ...r }).catch((e: unknown) =>
      Promise.reject(new Error(typeof e === "string" ? e : e instanceof Error ? e.message : "Couldn't send the reply.")),
    );
    return j.to ?? "the client";
  }
  throw new Error("Sending needs the Atlas app or the signed-in site.");
}

export const newReplyKey = () => (globalThis.crypto?.randomUUID?.() ?? `k${Date.now()}${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, "");
