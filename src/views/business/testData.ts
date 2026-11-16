import { newId } from "../../tasks/lifecycle";
import { ATLAS } from "../../tasks/types";
import type { BusinessStore } from "../../business/store";
import type { BusinessGoal, Customer, Expense, Lead, LeadStage, ProductOpportunity, Sale } from "../../business/types";

// Labelled test data, so the screens can be tried before real records exist. Every record is
// provenance "test", named "Test …", and kept out of every real figure. Only added when Khaneil
// presses "Add labelled test data" in Test data mode.

const SOURCE = "Test data (made by Atlas, not real)";

export function seedTestData(store: BusinessStore, now = new Date()) {
  const at = now.toISOString();
  const day = (offset: number) => new Date(now.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
  const base = { provenance: "test" as const, source: SOURCE, createdAt: at, createdBy: ATLAS, updatedAt: at, rev: 1 };

  const product: ProductOpportunity = {
    ...base, id: newId("prod"), title: "Test product: automation audit kit", targetCustomer: "Test: small agencies", competitors: ["Test competitor"], requirements: ["Test checklist"],
    mvpHours: 20, pricingHypothesis: "Test: $49 one-off", stage: "launch", approvals: [{ stage: "build", at, actor: ATLAS }, { stage: "launch", at, actor: ATLAS }], productRef: "test-audit-kit",
    feedback: [{ id: newId("fb"), at, kind: "note", summary: "Test feedback: wants a video walkthrough", actor: ATLAS }],
    listing: { state: "approved", versions: [{ version: 1, at, description: "Test listing", priceCents: 4900, currency: "USD", actor: ATLAS }] },
    history: (["research", "evaluate", "approve", "build", "test", "launch"] as const).map((to, i, all) => ({ from: i ? all[i - 1] : null, to, at, actor: ATLAS })),
  };
  store.create("products", product);

  const path: LeadStage[][] = [["new"], ["new", "qualified"], ["new", "qualified", "contacted"], ["new", "qualified", "contacted", "proposal"], ["new", "qualified", "contacted", "proposal", "won"], ["new", "qualified", "lost"]];
  const leads: Lead[] = path.map((stages, i) => ({
    ...base, id: newId("lead"), name: `Test lead ${String.fromCharCode(65 + i)}`, contactRef: "Test (no real person)", acquisitionSource: i % 2 ? "Test: referral" : "Test: website", productInterest: product.productRef,
    stage: stages[stages.length - 1], createdAt: new Date(now.getTime() - (10 - i) * 86_400_000).toISOString(), followUpDate: i < 3 ? day(-1) : undefined,
    interactions: stages.includes("contacted") ? [{ id: newId("int"), at, kind: "email", summary: "Test reply", actor: ATLAS }] : [],
    transitions: stages.map((to, j) => ({ from: j ? stages[j - 1] : null, to, at: new Date(now.getTime() - (10 - i - j) * 86_400_000).toISOString(), actor: ATLAS, ...(to === "lost" ? { note: "Test: no budget" } : {}) })),
    preferences: { contactConsent: true, marketingOptIn: false, doNotContact: false, channel: "email" }, ...(to(stages) === "lost" ? { lostReason: "Test: no budget" } : {}),
  }));
  const won = leads.find((l) => l.stage === "won")!;
  const customer: Customer = { ...base, id: newId("cust"), name: "Test customer", contactRef: "Test (no real person)", leadId: won.id, lifecycle: "active", productsOwned: [product.productRef], supportInteractions: [], preferences: won.preferences };
  won.customerId = customer.id;
  leads.forEach((l) => store.create("leads", l));
  store.create("customers", customer);

  const sales: Sale[] = [
    { ...base, id: newId("sale"), orderRef: "test-order-1", productRef: product.productRef, customerId: customer.id, date: day(-3), currency: "USD", grossCents: 4900, refundCents: 0, feeCents: 172, verification: "manual" },
    { ...base, id: newId("sale"), orderRef: "test-order-2", productRef: product.productRef, date: day(-1), currency: "USD", grossCents: 4900, refundCents: 4900, feeCents: 172, verification: "manual" },
  ];
  sales.forEach((s) => store.create("sales", s));
  const expenses: Expense[] = [
    { ...base, id: newId("exp"), date: day(-5), vendor: "Test hosting", category: "infrastructure", basis: "actual", currency: "USD", amountCents: 500 },
    { ...base, id: newId("exp"), date: day(-4), vendor: "Test AI provider", category: "ai", basis: "estimated", currency: "USD", amountCents: 1200, productRef: product.productRef },
  ];
  expenses.forEach((e) => store.create("expenses", e));
  const goal: BusinessGoal = { ...base, id: newId("goal"), title: "Test goal: first paying customer", domain: "customer", targetOutcome: "Test: one paid order", metric: "paying_customers", baseline: 0, target: 1, startDate: day(-30), targetDate: day(30), agentIds: [], workflowRunIds: [], requiresApproval: true, state: "active", evidence: [] };
  store.create("goals", goal);
}

const to = (stages: LeadStage[]) => stages[stages.length - 1];
