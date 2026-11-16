import { describe, expect, it } from "vitest";
import { memoryBackend } from "../tasks/store";
import { KHANEIL, type Actor, type StoredTask } from "../tasks/types";
import type { WorkflowRun } from "../workflows/types";
import type { StoredReport } from "../reports/model";
import type { Inquiry } from "../inquiries/model";
import { authorize, redactPerson, retentionSweep } from "./access";
import { advise, evidenceBrief } from "./advisor";
import { isMissing, overview, scoped, type BusinessFilter } from "./dashboard";
import { aiCost, monthOf, productRevenue, statement } from "./finance";
import { confirmGoal, draftGoal, goalProgress, linkRun, metricValue, addEvidence } from "./goals";
import { agentImpact } from "./impact";
import { leadFromInquiry, reconcilePurchase, unconvertedInquiries, validPurchaseEvent } from "./intake";
import { addListingVersion, approveListing, draftProduct, moveProduct, productFromBrief, recordPublished } from "./products";
import { canContact, conversion, customerFromLead, draftSale, followUps, moveLead, netCents, parseMoney } from "./revenue";
import { BusinessStore, parseBusiness } from "./store";
import { EMPTY_DATA, type BusinessData, type Expense, type Lead, type Sale } from "./types";

const AT = "2026-11-10T12:00:00.000Z";
const AGENT: Actor = { kind: "agent", id: "benjaire-product-lab", name: "Product Lab" };
const N8N: Actor = { kind: "n8n", id: "wf", name: "Step Runner" };

function lead(over: Partial<Lead> = {}): Lead {
  return {
    id: `lead-${Math.random().toString(36).slice(2, 8)}`, provenance: "real", source: "Entered by hand", createdAt: AT, createdBy: KHANEIL, updatedAt: AT,
    name: "Ada", contactRef: "email on file", acquisitionSource: "Website inquiry", productInterest: "automation-audit", stage: "new",
    interactions: [], transitions: [{ from: null, to: "new", at: AT, actor: KHANEIL }],
    preferences: { contactConsent: true, marketingOptIn: false, doNotContact: false, channel: "email" }, rev: 1, ...over,
  };
}
function walk(l: Lead, stages: Lead["stage"][], note = "reason"): Lead {
  return stages.reduce((x, s) => { const r = moveLead(x, s, KHANEIL, AT, note); if (!r.ok) throw new Error(r.error); return r.value; }, l);
}
function sale(over: Partial<Sale> = {}): Sale {
  return { id: `sale-${Math.random().toString(36).slice(2, 8)}`, provenance: "real", source: "Stripe dashboard", createdAt: AT, createdBy: KHANEIL, updatedAt: AT, orderRef: `ord-${Math.random()}`, productRef: "kit", date: "2026-11-05", currency: "USD", grossCents: 4900, refundCents: 0, feeCents: 172, verification: "manual", rev: 1, ...over };
}
function expense(over: Partial<Expense> = {}): Expense {
  return { id: `exp-${Math.random()}`, provenance: "real", source: "Invoice", createdAt: AT, createdBy: KHANEIL, updatedAt: AT, date: "2026-11-03", vendor: "Cloudflare", category: "infrastructure", basis: "actual", currency: "USD", amountCents: 500, rev: 1, ...over };
}
function task(over: Partial<StoredTask> = {}): StoredTask {
  return {
    id: `task-${Math.random()}`, title: "t", description: "", status: "completed", priority: "medium", source: "manual", dependencyIds: [], requiresApproval: false, createdAt: AT, updatedAt: AT, completedAt: AT,
    rev: 1, createdBy: KHANEIL, categories: [], maxAttempts: 3, attempts: [], approvals: [], artifacts: [], usage: [], events: [], eventsTrimmed: 0, ...over,
  };
}
const data = (over: Partial<BusinessData> = {}): BusinessData => ({ ...EMPTY_DATA, ...over });
const NOV = { from: "2026-11-01", to: "2026-11-30" };
const FILTER: BusinessFilter = { period: NOV, product: "", area: "", source: "all", provenance: "real" };

describe("goal calculations", () => {
  const base = { title: "First paying customer", domain: "customer" as const, targetOutcome: "One paid order", metric: "paying_customers" as const, baseline: 0, target: 1, startDate: "2026-11-01", targetDate: "2026-12-31", agentIds: [], requiresApproval: true, provenance: "real" as const };

  it("measures only real records dated after the start", () => {
    const g = draftGoal(base, KHANEIL, AT);
    if (!g.ok) throw new Error(g.error);
    const cust = { ...customerOf(walk(lead(), ["qualified", "contacted", "proposal", "won"])) };
    const d = data({ customers: [cust, { ...cust, id: "c-test", provenance: "test" }], sales: [sale({ customerId: cust.id }), sale({ customerId: "c-test", provenance: "test" }), sale({ customerId: cust.id, date: "2026-10-01" })] });
    expect(metricValue(g.value, { data: d, tasks: [], runs: [] })).toBe(1);
  });

  it("keeps workflow completion apart from the business outcome", () => {
    const g = draftGoal({ ...base, metric: "net_revenue", currency: "USD", domain: "revenue", target: 10_000 }, KHANEIL, AT);
    if (!g.ok) throw new Error(g.error);
    const t = task({ status: "completed" });
    const run = { id: "run-1", nodeTasks: { research: t.id } } as unknown as WorkflowRun;
    const goal = linkRun(g.value, "run-1", AT);
    const p = goalProgress(goal, { data: data(), tasks: [t], runs: [run] }, Date.parse(AT));
    expect(p.work).toBe(1);
    expect(p.met).toBe(false);
    expect(p.verdict).toBe("at_risk");
    const c = confirmGoal(goal, { data: data(), tasks: [t], runs: [run] }, KHANEIL, AT);
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.error).toMatch(/business result/);
  });

  it("can be confirmed only by a person, once met, with evidence", () => {
    const g = draftGoal({ ...base, metric: "net_revenue", currency: "USD", domain: "revenue", target: 4000 }, KHANEIL, AT);
    if (!g.ok) throw new Error(g.error);
    const ctx = { data: data({ sales: [sale()] }), tasks: [], runs: [] };
    expect(confirmGoal(g.value, ctx, AGENT, AT).ok).toBe(false);
    expect(confirmGoal(g.value, ctx, KHANEIL, AT).ok).toBe(false); // needs evidence (requiresApproval)
    const withEv = addEvidence(g.value, { label: "Stripe order", kind: "sale", ref: "ord-1" }, KHANEIL, AT);
    if (!withEv.ok) throw new Error(withEv.error);
    const done = confirmGoal(withEv.value, ctx, KHANEIL, AT);
    expect(done.ok && done.value.state).toBe("achieved");
  });

  it("rejects targets that point the wrong way and agent-made real goals", () => {
    expect(draftGoal({ ...base, target: 0 }, KHANEIL, AT).ok).toBe(false);
    expect(draftGoal({ ...base, metric: "lead_response_hours", baseline: 10, target: 20 }, KHANEIL, AT).ok).toBe(false);
    expect(draftGoal(base, AGENT, AT).ok).toBe(false);
    expect(draftGoal({ ...base, provenance: "test" }, AGENT, AT).ok).toBe(true);
  });
});

function customerOf(l: Lead) {
  const c = customerFromLead(l, KHANEIL, AT);
  if (!c.ok) throw new Error(c.error);
  return c.value;
}

describe("lead lifecycle", () => {
  it("follows the configured stages and records each transition", () => {
    const l = walk(lead(), ["qualified", "contacted", "proposal", "won"]);
    expect(l.transitions.map((t) => t.to)).toEqual(["new", "qualified", "contacted", "proposal", "won"]);
    expect(moveLead(lead(), "won", KHANEIL, AT).ok).toBe(false);
    expect(moveLead(l, "new", KHANEIL, AT).ok).toBe(false);
  });
  it("needs a reason to lose a lead and consent to contact one", () => {
    expect(moveLead(lead(), "lost", KHANEIL, AT).ok).toBe(false);
    const noConsent = lead({ stage: "qualified", preferences: { contactConsent: false, marketingOptIn: false, doNotContact: false, channel: "email" } });
    expect(moveLead(noConsent, "contacted", KHANEIL, AT).ok).toBe(false);
    expect(canContact(lead({ preferences: { contactConsent: true, marketingOptIn: false, doNotContact: true, channel: "email" } }))).toBe(false);
  });
  it("only a won lead becomes a customer, once", () => {
    expect(customerFromLead(lead(), KHANEIL, AT).ok).toBe(false);
    const won = walk(lead(), ["qualified", "contacted", "proposal", "won"]);
    expect(customerFromLead({ ...won, customerId: "c1" }, KHANEIL, AT).ok).toBe(false);
  });
  it("lists due follow-ups only for leads that may be contacted", () => {
    const now = Date.parse("2026-11-12T00:00:00Z");
    const a = lead({ followUpDate: "2026-11-10" });
    const b = lead({ followUpDate: "2026-11-10", preferences: { contactConsent: true, marketingOptIn: false, doNotContact: true, channel: "email" } });
    const f = followUps([a, b], now);
    expect(f.map((x) => x.lead.id)).toEqual([a.id]);
    expect(f[0].overdueDays).toBe(2);
  });
});

describe("conversion metrics", () => {
  it("counts every stage a lead reached, real leads only", () => {
    const leads = [
      walk(lead(), ["qualified", "contacted", "proposal", "won"]),
      walk(lead(), ["qualified", "contacted", "lost"]),
      walk(lead(), ["qualified"]),
      lead(),
      walk(lead({ provenance: "test" }), ["qualified", "contacted", "proposal", "won"]),
    ];
    const c = conversion(leads);
    expect(c.total).toBe(4);
    expect(c.winRate).toBe(0.5);
    expect(c.stepRates.find((s) => s.from === "new")!.rate).toBe(0.75);
    expect(c.stepRates.find((s) => s.from === "proposal")!.rate).toBe(1);
  });
  it("has no rate rather than 0% when nothing closed", () => {
    expect(conversion([lead()]).winRate).toBeNull();
    expect(conversion([]).stepRates.every((s) => s.rate === null)).toBe(true);
  });
});

describe("sales: deduplication, revenue, refunds, currency", () => {
  const input = { orderRef: "ord-9", productRef: "kit", date: "2026-11-05", currency: "usd", gross: "49.00", refunds: "", fees: "1.72", provenance: "real" as const, source: "Stripe dashboard" };
  it("parses money into whole cents without floating point", () => {
    expect(parseMoney("0.10")).toBe(10);
    expect(parseMoney("1,234.5")).toBe(123450);
    expect(parseMoney("19.999")).toBeNull();
    expect(parseMoney("-3")).toBeNull();
    // 0.1 + 0.2 in floats is 0.30000000000000004; in cents it's exact.
    expect(parseMoney("0.1")! + parseMoney("0.2")!).toBe(30);
  });
  it("refuses a duplicate order and impossible refunds", () => {
    const s = draftSale(input, [], KHANEIL, AT);
    expect(s.ok && s.value.currency).toBe("USD");
    if (!s.ok) return;
    expect(draftSale(input, [s.value], KHANEIL, AT).ok).toBe(false);
    expect(draftSale({ ...input, orderRef: "x", refunds: "50" }, [], KHANEIL, AT).ok).toBe(false);
    expect(draftSale({ ...input, orderRef: "y", source: "" }, [], KHANEIL, AT).ok).toBe(false);
    expect(draftSale({ ...input, orderRef: "z", currency: "dollars" }, [], KHANEIL, AT).ok).toBe(false);
  });
  it("works out net revenue, profit and contribution per currency", () => {
    const st = statement(
      [sale({ grossCents: 4900, refundCents: 900, feeCents: 172, productRef: "kit" }), sale({ currency: "EUR", grossCents: 1000 }), sale({ provenance: "test", grossCents: 99_999 })],
      [expense({ amountCents: 500 }), expense({ category: "ai", amountCents: 300, basis: "estimated", productRef: "kit" })],
      [],
      NOV,
    );
    const usd = st.currencies.find((c) => c.currency === "USD")!;
    expect(netCents({ grossCents: 4900, refundCents: 900, feeCents: 172 })).toBe(3828);
    expect(usd.netRevenueCents).toBe(3828);
    expect(usd.operatingExpenseCents).toBe(800);
    expect(usd.estimatedExpenseCents).toBe(300);
    expect(usd.productCostCents).toBe(300);
    expect(usd.contributionCents).toBe(3528);
    expect(usd.profitCents).toBe(3028);
    expect(st.currencies.map((c) => c.currency)).toEqual(["EUR", "USD"]);
    expect(st.testRecordsIgnored).toBe(1);
  });
  it("splits revenue by product", () => {
    const rows = productRevenue([], [sale({ productRef: "a" }), sale({ productRef: "a" }), sale({ productRef: "b", grossCents: 100, feeCents: 0 })], []);
    expect(rows[0]).toMatchObject({ productRef: "a", orders: 2, netRevenueCents: 2 * (4900 - 172) });
  });
  it("AI cost per completed task uses only reported costs", () => {
    const t1 = task({ usage: [{ model: "m", provider: "anthropic", recordedAt: AT, cost: { usd: 0.3, basis: "estimated" } }] });
    const t2 = task({ status: "failed", completedAt: undefined, usage: [{ model: "m", provider: "anthropic", recordedAt: AT, cost: { usd: 0.1, basis: "billed" } }] });
    const a = aiCost([t1, t2], NOV);
    expect(a).toMatchObject({ usd: 0.4, completedTasks: 1, perCompletedTaskUsd: 0.4, estimated: true });
  });
  it("month periods cover the whole month", () => {
    expect(monthOf(new Date("2026-02-14T00:00:00Z"))).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });
});

describe("verified purchase events", () => {
  const ev = { eventId: "evt_1", orderRef: "pi_1", productRef: "kit", currency: "USD", gross: 4900, fees: 172, date: "2026-11-05", provider: "Stripe" };
  const paid = { orderRef: "pi_1", status: "paid" as const, currency: "USD", gross: 4900, refunds: 0 };
  it("never records a sale from a webhook alone", () => {
    expect(reconcilePurchase(ev, null, [], KHANEIL, AT).kind).toBe("unverified");
    expect(reconcilePurchase(ev, { ...paid, status: "pending" }, [], KHANEIL, AT).kind).toBe("unverified");
  });
  it("rejects malformed events, mismatches and automated writers", () => {
    expect(validPurchaseEvent({ ...ev, gross: 49.0001 })).toBe(false);
    expect(reconcilePurchase({ ...ev, currency: "usd" }, paid, [], KHANEIL, AT).kind).toBe("rejected");
    expect(reconcilePurchase(ev, { ...paid, gross: 5000 }, [], KHANEIL, AT).kind).toBe("rejected");
    expect(reconcilePurchase(ev, { ...paid, orderRef: "pi_2" }, [], KHANEIL, AT).kind).toBe("rejected");
    expect(reconcilePurchase(ev, paid, [], N8N, AT).kind).toBe("rejected");
  });
  it("records once, dedupes repeats and applies refunds", () => {
    const r = reconcilePurchase(ev, paid, [], KHANEIL, AT);
    expect(r.kind).toBe("recorded");
    if (r.kind !== "recorded") return;
    expect(r.sale.verification).toBe("verified");
    expect(reconcilePurchase(ev, paid, [r.sale], KHANEIL, AT).kind).toBe("duplicate");
    const refunded = reconcilePurchase(ev, { ...paid, status: "partially_refunded", refunds: 1000 }, [r.sale], KHANEIL, AT);
    expect(refunded.kind === "updated" && refunded.sale.refundCents).toBe(1000);
    expect(reconcilePurchase(ev, paid, [{ ...r.sale, refundCents: 1000 }], KHANEIL, AT).kind).toBe("rejected");
  });
});

describe("customer inquiry intake", () => {
  const inq: Inquiry = { id: "inq-abcdef12", received_at: "2026-11-09T08:00:00.000Z", category: "automation", category_label: "AI automation", name: "Grace", email: "g@example.com", company: "Hopper Co", message: "Hi", host: "benjaire.com" };
  it("makes one lead per inquiry, pointing at it instead of copying the email", () => {
    const l = leadFromInquiry(inq, [], KHANEIL, AT);
    expect(l.ok).toBe(true);
    if (!l.ok) return;
    expect(l.value.contactRef).toBe("inquiry:inq-abcdef12");
    expect(JSON.stringify(l.value)).not.toContain("g@example.com");
    expect(l.value.preferences.marketingOptIn).toBe(false);
    expect(leadFromInquiry(inq, [l.value], KHANEIL, AT).ok).toBe(false);
    expect(unconvertedInquiries([inq], [l.value])).toEqual([]);
    expect(leadFromInquiry(inq, [], AGENT, AT).ok).toBe(false);
  });
});

describe("product lifecycle and marketplace", () => {
  const make = () => {
    const p = draftProduct({ title: "Automation Audit Kit", targetCustomer: "Agencies", pricingHypothesis: "$49 one-off", provenance: "real", source: "" }, [], KHANEIL, AT);
    if (!p.ok) throw new Error(p.error);
    return p.value;
  };
  const step = (p: ReturnType<typeof make>, to: Parameters<typeof moveProduct>[1], actor: Actor = KHANEIL) => moveProduct(p, to, actor, AT);
  it("moves one stage at a time and needs a person for build, launch and measure", () => {
    let p = make();
    expect(step(p, "build").ok).toBe(false);
    for (const s of ["evaluate", "approve"] as const) { const r = step(p, s); if (!r.ok) throw new Error(r.error); p = r.value; }
    expect(step(p, "build").ok).toBe(false); // no requirements yet
    p = { ...p, requirements: ["Checklist PDF"] };
    expect(step(p, "build", AGENT).ok).toBe(false);
    const b = step(p, "build");
    expect(b.ok && b.value.approvals.map((a) => a.stage)).toEqual(["build"]);
  });
  it("won't launch without an approved listing or measure without a confirmed page", () => {
    let p = { ...make(), stage: "test" as const };
    expect(step(p, "launch").ok).toBe(false);
    const v = addListingVersion(p, "A kit", "49", "usd", KHANEIL, AT);
    if (!v.ok) throw new Error(v.error);
    expect(v.value.listing.versions[0]).toMatchObject({ priceCents: 4900, currency: "USD" });
    expect(approveListing(v.value, AGENT, AT).ok).toBe(false);
    const a = approveListing(v.value, KHANEIL, AT);
    if (!a.ok) throw new Error(a.error);
    const l = step(a.value, "launch");
    if (!l.ok) throw new Error(l.error);
    p = l.value;
    expect(step(p, "measure").ok).toBe(false);
    expect(recordPublished(p, "http://insecure", "2026-11-10", KHANEIL, AT).ok).toBe(false);
    expect(recordPublished(p, "https://benjaire.com/kit", "2026-11-10", N8N, AT).ok).toBe(false);
    const pub = recordPublished(p, "https://benjaire.com/kit", "2026-11-10", KHANEIL, AT);
    expect(pub.ok && pub.value.listing.state).toBe("published");
    if (!pub.ok) return;
    // A new version of a live listing waits for approval again.
    const v2 = addListingVersion(pub.value, "A better kit", "59", "USD", KHANEIL, AT);
    expect(v2.ok && v2.value.listing.state).toBe("approved");
  });
  it("turns a Product Lab brief into an opportunity once, from the brief's own fields", () => {
    const report = { id: 7, at: AT, body: { agent: "benjaire-product-lab", month: "2026-11", top: { title: "Audit Kit", pillar: "digital_product", offer: "$49 kit", risk: "Crowded" }, scorecard: [{ idea: "Audit Kit", total: 4.1 }] } } as unknown as StoredReport;
    const p = productFromBrief(report, [], KHANEIL, AT);
    expect(p.ok && p.value).toMatchObject({ researchReportId: 7, researchScore: 4.1, pricingHypothesis: "$49 kit", stage: "research" });
    if (!p.ok) return;
    expect(productFromBrief(report, [p.value], KHANEIL, AT).ok).toBe(false);
  });
});

describe("agent outcome attribution", () => {
  it("keeps direct and assisted apart and never counts a sale without evidence", () => {
    const t = task({ agentId: "sales-agent", agentName: "Sales Agent" });
    const d = data({
      sales: [
        sale({ attribution: { agentId: "sales-agent", kind: "direct", evidence: "checkout link from task" } }),
        sale({ attribution: { agentId: "sales-agent", kind: "assisted", evidence: "worked the lead" } }),
        sale({ attribution: { agentId: "sales-agent", kind: "direct", evidence: " " } }),
        sale({ provenance: "test", attribution: { agentId: "sales-agent", kind: "direct", evidence: "x" } }),
      ],
      leads: [walk(lead({ agentId: "sales-agent" }), ["qualified", "contacted", "proposal", "won"])],
    });
    const [a] = agentImpact(d, [t, task({ agentId: "sales-agent", status: "failed" })], []);
    expect(a.direct.sales).toBe(1);
    expect(a.assisted).toMatchObject({ sales: 1, wonLeads: 1 });
    expect(a.reliability).toBe(0.5);
  });
});

describe("dashboard aggregation and missing metrics", () => {
  it("says why a metric is missing instead of showing zero", () => {
    const o = overview(data(), [], [], FILTER);
    expect(isMissing(o.revenue)).toBe(true);
    expect(isMissing(o.winRate)).toBe(true);
    expect(isMissing(o.activeLeads)).toBe(true);
    expect(isMissing(o.cac)).toBe(true);
    expect(isMissing(o.goalSummary)).toBe(true);
  });
  it("aggregates real records and keeps test data in its own mode", () => {
    const d = data({ sales: [sale({ grossCents: 10_000, feeCents: 0 }), sale({ provenance: "test", grossCents: 50_000, feeCents: 0 })], leads: [lead(), lead({ provenance: "test" })] });
    const real = overview(d, [], [], FILTER);
    expect(real.revenue).toEqual([{ currency: "USD", cents: 10_000 }]);
    expect(real.activeLeads).toBe(1);
    const test = overview(d, [], [], { ...FILTER, provenance: "test" });
    expect(test.revenue).toEqual([{ currency: "USD", cents: 50_000 }]);
    expect(real.revenueByMonth).toEqual([{ month: "2026-11", currency: "USD", cents: 10_000 }]);
  });
  it("filters by product and source", () => {
    const d = data({ sales: [sale({ productRef: "a", verification: "verified" }), sale({ productRef: "b" })] });
    expect(scoped(d, { ...FILTER, product: "a" }).sales).toHaveLength(1);
    expect(scoped(d, { ...FILTER, source: "verified" }).sales.map((s) => s.productRef)).toEqual(["a"]);
  });
  it("works out CAC only with marketing spend and new paying customers", () => {
    const d = data({ sales: [sale({ customerId: "c1" }), sale({ customerId: "c2" })], expenses: [expense({ category: "marketing", amountCents: 3000 })] });
    expect(overview(d, [], [], FILTER).cac).toEqual([{ currency: "USD", cents: 1500, customers: 2 }]);
  });
});

describe("advisor", () => {
  it("grounds every recommendation in evidence and asks before acting", () => {
    const leads = [1, 2, 3, 4].map(() => lead()).concat([walk(lead(), ["qualified"])]);
    const recs = advise(data({ leads }), [], [], FILTER);
    expect(recs.find((r) => r.key === "data:no-sales")).toBeTruthy();
    const conv = recs.find((r) => r.area === "conversion");
    expect(conv?.title).toMatch(/New lead and Qualified/);
    for (const r of recs) {
      expect(r.evidence.length).toBeGreaterThan(0);
      expect(r.approval).toBeTruthy();
      expect(r.nextAction).toBeTruthy();
      expect(r.period.from).toBeTruthy();
    }
  });
  it("gives no rate-based advice on tiny samples, and its brief has no personal details", () => {
    const recs = advise(data({ leads: [lead({ name: "Secret Person" })] }), [], [], FILTER);
    expect(recs.some((r) => r.area === "conversion")).toBe(false);
    expect(evidenceBrief(recs, FILTER)).not.toContain("Secret Person");
  });
});

describe("approval enforcement and data access isolation", () => {
  it("lets automations only propose or add test data", () => {
    expect(authorize(KHANEIL, "record_real")).toBeNull();
    expect(authorize(AGENT, "record_test")).toBeNull();
    for (const a of ["record_real", "approve_stage", "publish_listing", "confirm_goal", "delete", "view_personal"] as const) expect(authorize(AGENT, a)).toMatch(/only a person/);
  });
  it("hides personal details when a record is shared", () => {
    const l = lead({ name: "Grace Hopper", contactRef: "inquiry:abc", interactions: [{ id: "i", at: AT, kind: "email", summary: "call me on 555", actor: KHANEIL }] });
    const r = redactPerson(l);
    expect(JSON.stringify(r)).not.toMatch(/Grace|inquiry:abc|555/);
  });
  it("removes old lost leads and clears contact for do-not-contact", () => {
    const now = Date.parse("2027-08-01T00:00:00Z");
    const old = lead({ stage: "lost", updatedAt: "2026-11-01T00:00:00Z" });
    const dnc = lead({ preferences: { contactConsent: false, marketingOptIn: false, doNotContact: true, channel: "none" } });
    const s = retentionSweep([old, dnc, lead()], [], now);
    expect(s.removeLeads).toEqual([old.id]);
    expect(s.scrubLeads.map((l) => l.id)).toEqual([dnc.id]);
  });
});

describe("store and external failures", () => {
  it("is compare-and-set and survives corrupt or blocked storage", () => {
    const backend = memoryBackend();
    const s = new BusinessStore(backend);
    const l = lead();
    expect(s.create("leads", l).ok).toBe(true);
    expect(s.put("leads", { ...l, name: "B" }, 1).ok).toBe(true);
    expect(s.put("leads", { ...l, name: "C" }, 1).ok).toBe(false);
    expect(parseBusiness("{not json").leads).toEqual([]);
    expect(parseBusiness(JSON.stringify({ version: 1, leads: [{ id: "x", rev: 1, provenance: "fake" }] })).leads).toEqual([]);
    const blocked = new BusinessStore({ read: () => null, write: () => { throw new Error("quota"); } });
    const r = blocked.create("leads", l);
    expect(r.ok).toBe(false);
  });
  it("clears test data and nothing else", () => {
    const s = new BusinessStore(memoryBackend());
    s.create("sales", sale());
    s.create("sales", sale({ provenance: "test" }));
    s.clearTestData();
    expect(s.snapshot().sales.map((x) => x.provenance)).toEqual(["real"]);
  });
});
