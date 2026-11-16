import type { Actor } from "../tasks/types";
import { reconcilePurchase, type ProviderConfirmation, type PurchaseEvent } from "./intake";
import type { Sale } from "./types";

// Stripe sales, read through n8n. n8n already holds a restricted Stripe read key (the one Shop
// delivery uses to check each checkout). The "Atlas · Sales feed" n8n workflow reads paid checkouts
// with it and answers the site, which asks with the n8n bridge key (server/stripeSales.ts). Nothing
// here can write to Stripe, and no buyer name or email comes back: only ids, amounts and dates.
//
// This file is shared by the site and the app and holds no secret.

/** n8n webhook path of the sales feed workflow. */
export const SALES_FEED_PATH = "atlas-sales-feed";
/** Longest range one sync can ask for; n8n clamps to the same. */
export const MAX_RANGE_DAYS = 400;
export const MAX_FEED_BYTES = 512_000;
export const SOURCE = "Stripe via n8n";

export interface StripeSaleRow {
  orderRef: string;
  paymentRef: string;
  productRef: string;
  date: string;
  currency: string;
  grossCents: number;
  refundCents: number;
  /** Null when Stripe hasn't settled the fee yet. */
  feeCents: number | null;
  chargeStatus: string;
  livemode: boolean;
}

export interface SalesFeed {
  fetchedAt: string;
  since: string;
  until: string;
  sales: StripeSaleRow[];
  /** Rows that didn't match the schema. They are left out, never repaired. */
  dropped: number;
}

const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isInt = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
const str = (v: unknown, max = 200) => (typeof v === "string" && v.length <= max ? v : null);
const iso = (v: unknown) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : null);

function row(v: unknown): StripeSaleRow | null {
  if (!obj(v)) return null;
  const orderRef = str(v.orderRef, 120);
  if (!orderRef || !/^cs_(live|test)_[A-Za-z0-9]+$/.test(orderRef)) return null;
  const currency = str(v.currency, 3);
  if (!currency || !/^[A-Z]{3}$/.test(currency)) return null;
  const date = str(v.date, 10);
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (!isInt(v.grossCents) || v.grossCents <= 0) return null;
  const refund = v.refundCents === null || v.refundCents === undefined ? 0 : v.refundCents;
  if (!isInt(refund) || refund > v.grossCents) return null;
  const fee = v.feeCents === null || v.feeCents === undefined ? null : v.feeCents;
  if (fee !== null && (!isInt(fee) || fee > v.grossCents)) return null;
  return {
    orderRef,
    paymentRef: str(v.paymentRef, 120) ?? "",
    productRef: (str(v.productRef, 80) ?? "").trim(),
    date,
    currency,
    grossCents: v.grossCents,
    refundCents: refund,
    feeCents: fee,
    chargeStatus: str(v.chargeStatus, 40) ?? "",
    livemode: v.livemode === true,
  };
}

/** Checks n8n's answer. Anything that isn't the expected shape is refused or dropped. */
export function parseSalesFeed(body: unknown): { ok: true; feed: SalesFeed } | { ok: false; error: string } {
  if (!obj(body)) return { ok: false, error: "The sales feed didn't answer with JSON." };
  if (body.ok === false) return { ok: false, error: str(body.error, 400) ?? "The sales feed reported an error." };
  if (body.ok !== true || !Array.isArray(body.sales)) return { ok: false, error: "The sales feed's answer isn't in the expected shape." };
  const fetchedAt = iso(body.fetchedAt), since = iso(body.since), until = iso(body.until);
  if (!fetchedAt || !since || !until) return { ok: false, error: "The sales feed's answer has no dates." };
  const sales: StripeSaleRow[] = [];
  let dropped = 0;
  const seen = new Set<string>();
  for (const v of body.sales.slice(0, 5000)) {
    const r = row(v);
    if (!r || seen.has(r.orderRef)) dropped++;
    else {
      seen.add(r.orderRef);
      sales.push(r);
    }
  }
  return { ok: true, feed: { fetchedAt, since, until, sales, dropped } };
}

/** The range one sync asks for: `days` back from now, at most MAX_RANGE_DAYS. */
export function syncRange(days: number, now = Date.now()) {
  const d = Math.min(MAX_RANGE_DAYS, Math.max(1, Math.floor(days)));
  return { since: new Date(now - d * 86_400_000).toISOString(), until: new Date(now).toISOString() };
}

/** Stripe's own read is the provider confirmation: it isn't a webhook, it's the order as Stripe has it now. */
export function confirmationOf(r: StripeSaleRow): ProviderConfirmation {
  const status: ProviderConfirmation["status"] =
    r.chargeStatus && r.chargeStatus !== "succeeded" ? (r.chargeStatus === "pending" ? "pending" : "failed")
    : r.refundCents >= r.grossCents ? "refunded"
    : r.refundCents > 0 ? "partially_refunded"
    : "paid";
  return { orderRef: r.orderRef, status, currency: r.currency, gross: r.grossCents, refunds: r.refundCents };
}

export function eventOf(r: StripeSaleRow): PurchaseEvent {
  return {
    eventId: r.paymentRef || r.orderRef,
    orderRef: r.orderRef,
    // A checkout with no product in shop_orders is still a real sale; it's shown as unassigned.
    productRef: r.productRef || "unassigned",
    currency: r.currency,
    gross: r.grossCents,
    refunds: r.refundCents,
    ...(r.feeCents === null ? {} : { fees: r.feeCents }),
    date: r.date,
    provider: SOURCE,
  };
}

export interface SyncPlan {
  create: Sale[];
  update: { sale: Sale; expectedRev: number }[];
  unchanged: number;
  skipped: { orderRef: string; reason: string }[];
  feesPending: number;
}

/**
 * What a sync would change. Every row goes through reconcilePurchase, so only a person can record
 * it, refunds only go up, and an order already in Atlas is never added twice. Stripe test-mode
 * checkouts are skipped: they aren't money.
 */
export function planSync(feed: SalesFeed, existing: readonly Sale[], actor: Actor, at: string): SyncPlan {
  const plan: SyncPlan = { create: [], update: [], unchanged: 0, skipped: [], feesPending: 0 };
  for (const r of feed.sales) {
    if (!r.livemode) {
      plan.skipped.push({ orderRef: r.orderRef, reason: "Stripe test mode, not real money." });
      continue;
    }
    const res = reconcilePurchase(eventOf(r), confirmationOf(r), existing, actor, at);
    if (res.kind === "recorded") {
      plan.create.push({ ...res.sale, source: `${SOURCE} (checkout ${r.orderRef})` });
      if (r.feeCents === null) plan.feesPending++;
    } else if (res.kind === "updated") plan.update.push({ sale: res.sale, expectedRev: res.expectedRev });
    else if (res.kind === "duplicate") {
      // A fee Stripe settled after an earlier sync fills in a fee saved as 0; it never changes a known fee.
      const known = existing.find((s) => s.orderRef === r.orderRef && s.provenance === "real");
      if (known && known.feeCents === 0 && r.feeCents && r.feeCents <= known.grossCents) {
        plan.update.push({ sale: { ...known, feeCents: r.feeCents, updatedAt: at, verification: "verified" }, expectedRev: known.rev });
      } else plan.unchanged++;
    }
    else plan.skipped.push({ orderRef: r.orderRef, reason: res.reason });
  }
  return plan;
}
