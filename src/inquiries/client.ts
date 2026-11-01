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
}

interface Page {
  configured: boolean;
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
  const [s, setS] = useState<InquiriesState>({ state: "loading", message: null, inquiries: [] });
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
        if (!page) setS({ state: "off", message: "The inbox needs website sync (Settings → Website sync).", inquiries: [] });
        else if (!page.configured) setS({ state: "off", message: "The inquiry inbox isn't set up on the site yet.", inquiries: [] });
        else setS({ state: "ready", message: null, inquiries: cleanInquiries(page) });
      })
      .catch((e) => alive && setS((prev) => ({ state: "error", message: e instanceof Error ? e.message : String(e), inquiries: prev.inquiries })));
    return () => {
      alive = false;
    };
  }, [tick]);

  return s;
}
