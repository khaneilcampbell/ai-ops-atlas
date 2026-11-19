import { describe, expect, it } from "vitest";
import { KHANEIL, type Actor } from "../tasks/types";
import { confirmationOf, parseSalesFeed, planSync, syncRange, type SalesFeed } from "./stripeFeed";
import type { Sale } from "./types";

const AT = "2026-11-16T05:00:00Z";
const row = (over: Record<string, unknown> = {}) => ({ provider: "stripe", orderRef: "cs_live_abc123", paymentRef: "pi_1", productRef: "flow_starter_v1", date: "2026-10-17", currency: "USD", grossCents: 7900, refundCents: 0, feeCents: 259, chargeStatus: "succeeded", livemode: true, ...over });
const body = (sales: unknown[]) => ({ ok: true, fetchedAt: AT, since: "2025-11-01T00:00:00Z", until: AT, sales });
const feedOf = (sales: unknown[]): SalesFeed => {
  const p = parseSalesFeed(body(sales));
  if (!p.ok) throw new Error(p.error);
  return p.feed;
};

describe("Stripe sales feed", () => {
  it("accepts only well-formed rows, drops the rest and never repairs them", () => {
    const f = feedOf([row(), row({ orderRef: "pi_wrong" }), row({ orderRef: "cs_live_b", grossCents: 10.5 }), row({ orderRef: "cs_live_c", refundCents: 9000 }), row({ orderRef: "cs_live_d", currency: "usd" }), row()]);
    expect(f.sales.map((s) => s.orderRef)).toEqual(["cs_live_abc123"]);
    expect(f.dropped).toBe(5);
  });

  it("passes on an error from n8n instead of inventing an empty result", () => {
    expect(parseSalesFeed({ ok: false, error: "Stripe refused the read: permission" })).toEqual({ ok: false, error: "Stripe refused the read: permission" });
    expect(parseSalesFeed({ sales: [] }).ok).toBe(false);
    expect(parseSalesFeed("nope").ok).toBe(false);
  });

  it("brings no buyer details through, even if n8n sent them", () => {
    const f = feedOf([row({ email: "buyer@example.com", name: "Buyer" })]);
    expect(JSON.stringify(f)).not.toContain("example.com");
    expect(JSON.stringify(f)).not.toContain("Buyer");
  });

  it("treats Stripe's own read as the confirmation: refunded, partly refunded, failed", () => {
    expect(confirmationOf(feedOf([row({ refundCents: 7900 })]).sales[0]).status).toBe("refunded");
    expect(confirmationOf(feedOf([row({ refundCents: 100 })]).sales[0]).status).toBe("partially_refunded");
    expect(confirmationOf(feedOf([row({ chargeStatus: "failed" })]).sales[0]).status).toBe("failed");
  });

  it("plans new sales as verified real records in whole cents, once", () => {
    const plan = planSync(feedOf([row()]), [], KHANEIL, AT);
    expect(plan.create).toHaveLength(1);
    const s = plan.create[0];
    expect(s).toMatchObject({ provenance: "real", verification: "verified", grossCents: 7900, feeCents: 259, refundCents: 0, currency: "USD", productRef: "flow_starter_v1" });
    expect(s.source).toContain("Stripe via n8n");
    const again = planSync(feedOf([row()]), [{ ...s, rev: 1 }], KHANEIL, AT);
    expect(again.create).toHaveLength(0);
    expect(again.unchanged).toBe(1);
  });

  it("updates a refund upward and fills a fee Stripe settled later, never the other way", () => {
    const first = planSync(feedOf([row({ feeCents: null })]), [], KHANEIL, AT);
    expect(first.feesPending).toBe(1);
    const saved: Sale = { ...first.create[0], rev: 1 };
    const later = planSync(feedOf([row({ feeCents: 259 })]), [saved], KHANEIL, AT);
    expect(later.update[0].sale.feeCents).toBe(259);
    const refunded = planSync(feedOf([row({ refundCents: 7900 })]), [saved], KHANEIL, AT);
    expect(refunded.update[0].sale.refundCents).toBe(7900);
    const down = planSync(feedOf([row({ refundCents: 0 })]), [{ ...saved, refundCents: 7900 }], KHANEIL, AT);
    expect(down.skipped[0].reason).toMatch(/can't go down/);
  });

  it("skips Stripe test mode and unpaid checkouts", () => {
    const plan = planSync(feedOf([row({ livemode: false }), row({ orderRef: "cs_live_x", chargeStatus: "pending" })]), [], KHANEIL, AT);
    expect(plan.create).toHaveLength(0);
    expect(plan.skipped.map((s) => s.reason)).toEqual([expect.stringMatching(/test mode/), expect.stringMatching(/pending/)]);
  });

  it("lets only a person record, so an agent or n8n can't add revenue", () => {
    const agent: Actor = { kind: "agent", id: "a", name: "Agent" };
    const plan = planSync(feedOf([row()]), [], agent, AT);
    expect(plan.create).toHaveLength(0);
    expect(plan.skipped).toHaveLength(1);
  });

  it("caps the range", () => {
    const r = syncRange(10_000, Date.parse(AT));
    expect((Date.parse(r.until) - Date.parse(r.since)) / 86_400_000).toBe(400);
  });
});
