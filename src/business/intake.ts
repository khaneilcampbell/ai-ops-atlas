import { newId } from "../tasks/lifecycle";
import type { Actor } from "../tasks/types";
import type { Inquiry } from "../inquiries/model";
import { authorize } from "./access";
import { type Outcome } from "./revenue";
import type { Lead, Sale } from "./types";

// Revenue workflows that feed the business records. Each one is a pure step a person (or a later
// n8n run, through the same checks) triggers; none of them sends a message, spends or publishes.
//
// - Customer inquiry -> lead: the benjaire.com Inquiry to Client inbox (already validated by the
//   site and again by src/inquiries/model.ts) becomes a lead once, keyed by the inquiry id.
// - Verified purchase event -> sale: an event is only recorded when the payment provider's own
//   confirmation is present and matches. A webhook arriving is never proof by itself.

/** The lead an inquiry becomes. Idempotent: an inquiry that is already a lead is refused. */
export function leadFromInquiry(inq: Inquiry, existing: readonly Lead[], actor: Actor, at: string): Outcome<Lead> {
  const refused = authorize(actor, "record_real");
  if (refused) return { ok: false, error: refused };
  const ref = `inquiry:${inq.id}`;
  if (existing.some((l) => l.contactRef === ref)) return { ok: false, error: "This inquiry is already a lead." };
  return {
    ok: true,
    value: {
      id: newId("lead"),
      provenance: "real",
      source: `Inquiry to Client (${inq.host || "benjaire.com"})`,
      // The lead's age starts when the person wrote in, so response time is honest.
      createdAt: inq.received_at,
      createdBy: actor,
      updatedAt: at,
      name: inq.company ? `${inq.name} (${inq.company})` : inq.name,
      // The email stays in the inquiry inbox; the lead only points at it.
      contactRef: ref,
      acquisitionSource: "Website inquiry",
      productInterest: inq.category_label,
      stage: "new",
      interactions: [{ id: newId("int"), at: inq.received_at, kind: "inquiry", summary: `Inquiry: ${inq.category_label}`, actor }],
      transitions: [{ from: null, to: "new", at, actor }],
      // Writing in through the contact form is consent to a reply about it, and nothing more.
      preferences: { contactConsent: true, marketingOptIn: false, doNotContact: false, channel: "email" },
      rev: 1,
    },
  };
}

/** Inquiries not yet turned into leads, newest first. */
export const unconvertedInquiries = (inquiries: readonly Inquiry[], leads: readonly Lead[]) => {
  const done = new Set(leads.map((l) => l.contactRef));
  return inquiries.filter((i) => !done.has(`inquiry:${i.id}`)).sort((a, b) => b.received_at.localeCompare(a.received_at));
};

// ── Verified purchase events ─────────────────────────────────────────────────

/** A purchase event as it arrives from outside (a webhook, an n8n run, a CSV row). Untrusted. */
export interface PurchaseEvent {
  eventId: string;
  orderRef: string;
  productRef: string;
  currency: string;
  /** Minor units. */
  gross: number;
  refunds?: number;
  fees?: number;
  date: string;
  provider: string;
}

/** What the payment provider itself says about the order, fetched separately with a read key. */
export interface ProviderConfirmation {
  orderRef: string;
  status: "paid" | "refunded" | "partially_refunded" | "pending" | "failed" | "not_found";
  currency: string;
  gross: number;
  refunds: number;
}

export type ReconcileResult =
  | { kind: "recorded"; sale: Sale }
  | { kind: "updated"; sale: Sale; expectedRev: number }
  | { kind: "duplicate" }
  | { kind: "unverified"; reason: string }
  | { kind: "rejected"; reason: string };

const isInt = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;

/** Schema check for an incoming event. Anything malformed is rejected, never repaired. */
export function validPurchaseEvent(e: unknown): e is PurchaseEvent {
  if (!e || typeof e !== "object") return false;
  const x = e as Record<string, unknown>;
  const s = (v: unknown, max: number) => typeof v === "string" && v.trim().length > 0 && v.length <= max;
  return (
    s(x.eventId, 120) && s(x.orderRef, 120) && s(x.productRef, 80) && s(x.provider, 40) &&
    typeof x.currency === "string" && /^[A-Z]{3}$/.test(x.currency) &&
    isInt(x.gross) && x.gross > 0 &&
    (x.refunds === undefined || isInt(x.refunds)) && (x.fees === undefined || isInt(x.fees)) &&
    typeof x.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x.date)
  );
}

/**
 * Reconciles one purchase event. Recorded only when: the event is well formed, the provider's own
 * confirmation says paid (or refunded) for the same order, currency and gross, and the order isn't
 * already recorded. A refund on a known order updates it. Only a person may record it, because
 * Atlas has no server-verified purchase feed yet; a later one would call this with its own actor
 * after checking the webhook signature.
 */
export function reconcilePurchase(raw: unknown, confirmation: ProviderConfirmation | null, existing: readonly Sale[], actor: Actor, at: string): ReconcileResult {
  const refused = authorize(actor, "record_real");
  if (refused) return { kind: "rejected", reason: refused };
  if (!validPurchaseEvent(raw)) return { kind: "rejected", reason: "The event doesn't match the purchase schema." };
  const e = raw;
  if (!confirmation) return { kind: "unverified", reason: "The payment provider hasn't confirmed this order. A webhook alone isn't proof of payment." };
  if (confirmation.orderRef !== e.orderRef) return { kind: "rejected", reason: "The provider's confirmation is for a different order." };
  if (confirmation.status === "pending" || confirmation.status === "failed" || confirmation.status === "not_found") {
    return { kind: "unverified", reason: `The provider says the order is ${confirmation.status.replace("_", " ")}.` };
  }
  if (confirmation.currency !== e.currency || confirmation.gross !== e.gross) return { kind: "rejected", reason: "The amount or currency doesn't match what the provider confirmed." };
  if (confirmation.refunds > confirmation.gross) return { kind: "rejected", reason: "The provider's refund is larger than the order." };
  const fees = e.fees ?? 0;
  if (fees + confirmation.refunds > e.gross) return { kind: "rejected", reason: "Fees and refunds add up to more than the order." };

  const known = existing.find((s) => s.orderRef === e.orderRef && s.provenance === "real");
  if (known) {
    if (known.refundCents === confirmation.refunds) return { kind: "duplicate" };
    if (confirmation.refunds < known.refundCents) return { kind: "rejected", reason: "A refund can't go down." };
    return { kind: "updated", sale: { ...known, refundCents: confirmation.refunds, updatedAt: at, verification: "verified" }, expectedRev: known.rev };
  }
  return {
    kind: "recorded",
    sale: {
      id: newId("sale"),
      provenance: "real",
      source: `${e.provider} (event ${e.eventId})`,
      createdAt: at,
      createdBy: actor,
      updatedAt: at,
      orderRef: e.orderRef,
      productRef: e.productRef,
      date: e.date,
      currency: e.currency,
      grossCents: e.gross,
      refundCents: confirmation.refunds,
      feeCents: fees,
      verification: "verified",
      rev: 1,
    },
  };
}
