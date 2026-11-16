import { isHostedWeb, isTauri } from "../lib/env";
import { parseSalesFeed, type SalesFeed } from "./stripeFeed";

// The app side of the Stripe sales feed. The page asks the site behind Access; the Mac app asks
// through its Rust shell with the website sync key. Neither holds a Stripe or n8n key.

export type SalesAnswer = { state: "ok"; feed: SalesFeed } | { state: "unconfigured" | "error"; error: string };

function toAnswer(body: unknown): SalesAnswer {
  if (!body || typeof body !== "object") return { state: "error", error: "The site's answer wasn't readable." };
  const b = body as { state?: string; error?: string };
  if (b.state === "unconfigured") return { state: "unconfigured", error: b.error ?? "The Stripe sales feed isn't set up." };
  if (b.state !== "ok") return { state: "error", error: b.error ?? "The sync failed." };
  // Checked again here: the app never trusts a shape it didn't check.
  const parsed = parseSalesFeed({ ...b, ok: true });
  return parsed.ok ? { state: "ok", feed: parsed.feed } : { state: "error", error: parsed.error };
}

export async function fetchStripeSales(since: string, until: string): Promise<SalesAnswer> {
  try {
    if (isHostedWeb()) {
      const r = await fetch("/api/n8n/sales", { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify({ since, until }) });
      return toAnswer(await r.json().catch(() => null));
    }
    if (isTauri()) {
      const { invoke } = await import("@tauri-apps/api/core");
      const v = await invoke<unknown>("live_stripe_sales", { since, until });
      return v === null ? { state: "unconfigured", error: "Website sync isn't set up in the Mac app." } : toAnswer(v);
    }
    return { state: "unconfigured", error: "Stripe sales sync from the hosted site or the Mac app." };
  } catch (e) {
    return { state: "error", error: e instanceof Error ? e.message : String(e) };
  }
}
