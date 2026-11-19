import { newId } from "../tasks/lifecycle";
import type { Actor } from "../tasks/types";
import type { StoredReport } from "../reports/model";
import { PRODUCT_LAB_AGENT, type ProductLabReport } from "../reports/productLab";
import { authorize } from "./access";
import { parseMoney, type Outcome } from "./revenue";
import { GATED_STAGES, PRODUCT_STAGES, type ProductOpportunity, type ProductStage } from "./types";

// Product intelligence: one lifecycle for every product, Research -> Evaluate -> Approve -> Build ->
// Test -> Launch -> Measure, and its Product Marketplace listing. Moving into Build, Launch or
// Measure commits money, publishes or releases, so only a person can do it and the approval is
// recorded. A listing is "published" only when a person records the live page: Atlas has no
// verified publishing integration, so it never claims one succeeded.

const idx = (s: ProductStage) => PRODUCT_STAGES.indexOf(s);

/** The stages a product can move to next: one step forward, or back to any earlier stage. */
export function nextStages(p: Pick<ProductOpportunity, "stage">): ProductStage[] {
  const i = idx(p.stage);
  return PRODUCT_STAGES.filter((_, j) => j === i + 1 || j < i);
}

export function moveProduct(p: ProductOpportunity, to: ProductStage, actor: Actor, at: string, note?: string): Outcome<ProductOpportunity> {
  if (!nextStages(p).includes(to)) return { ok: false, error: `A product can't go from ${p.stage} to ${to}.` };
  const forward = idx(to) > idx(p.stage);
  const gate = GATED_STAGES[to];
  if (forward && gate) {
    const refused = authorize(actor, "approve_stage");
    if (refused) return { ok: false, error: `${gate}. ${refused}` };
  } else {
    const refused = authorize(actor, "edit");
    if (refused) return { ok: false, error: refused };
  }
  if (to === "evaluate" && !p.targetCustomer.trim()) return { ok: false, error: "Add the target customer before evaluating." };
  if (to === "approve" && !p.pricingHypothesis.trim()) return { ok: false, error: "Add a pricing hypothesis before asking for approval." };
  if (to === "build" && !p.requirements.length) return { ok: false, error: "List the requirements before committing to build." };
  if (to === "launch" && p.listing.state !== "approved" && p.listing.state !== "published") return { ok: false, error: "Approve the marketplace listing before launch." };
  if (to === "measure" && !p.listing.publishedUrl) return { ok: false, error: "Record the live product page before measuring. Atlas can't confirm a release by itself." };
  return {
    ok: true,
    value: {
      ...p,
      stage: to,
      updatedAt: at,
      history: [...p.history, { from: p.stage, to, at, actor }],
      approvals: forward && gate ? [...p.approvals, { stage: to, at, actor, ...(note?.trim() ? { note: note.trim() } : {}) }] : p.approvals,
    },
  };
}

export interface ProductInput {
  title: string;
  targetCustomer: string;
  pricingHypothesis: string;
  provenance: "real" | "test";
  source: string;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "product";

export function draftProduct(input: ProductInput, existing: readonly ProductOpportunity[], actor: Actor, at: string, extra: Partial<ProductOpportunity> = {}): Outcome<ProductOpportunity> {
  const refused = authorize(actor, input.provenance === "real" ? "record_real" : "record_test");
  if (refused) return { ok: false, error: refused };
  const title = input.title.trim();
  if (!title) return { ok: false, error: "A product needs a title." };
  let ref = slug(title);
  for (let n = 2; existing.some((p) => p.productRef === ref); n++) ref = `${slug(title)}-${n}`;
  return {
    ok: true,
    value: {
      id: newId("prod"),
      provenance: input.provenance,
      source: input.source.trim() || (input.provenance === "test" ? "Test data" : "Entered by hand"),
      createdAt: at,
      createdBy: actor,
      updatedAt: at,
      title,
      targetCustomer: input.targetCustomer.trim(),
      competitors: [],
      requirements: [],
      pricingHypothesis: input.pricingHypothesis.trim(),
      stage: "research",
      approvals: [],
      productRef: ref,
      feedback: [],
      listing: { state: "draft", versions: [] },
      history: [{ from: null, to: "research", at, actor }],
      ...extra,
      rev: 1,
    },
  };
}

/**
 * A product opportunity from a Benjaire Product Lab brief (a validated, structured report the site
 * already stores). Uses the brief's own fields; nothing is made up. One record per brief top pick.
 */
export function productFromBrief(report: StoredReport, existing: readonly ProductOpportunity[], actor: Actor, at: string): Outcome<ProductOpportunity> {
  const body = report.body as Partial<ProductLabReport>;
  if (body.agent !== PRODUCT_LAB_AGENT || !body.top || !body.scorecard) return { ok: false, error: "That report isn't a Product Lab brief." };
  if (existing.some((p) => p.researchReportId === report.id)) return { ok: false, error: "This brief is already a product opportunity." };
  const top = body.top;
  const row = body.scorecard.find((r) => r.idea === top.title);
  return draftProduct(
    { title: top.title, targetCustomer: "", pricingHypothesis: top.offer, provenance: "real", source: `Product Lab brief ${body.month} (report ${report.id})` },
    existing,
    actor,
    at,
    {
      researchReportId: report.id,
      researchMonth: body.month,
      researchScore: row?.total,
      competitors: [],
      requirements: [],
      feedback: [{ id: newId("fb"), at, kind: "note", summary: `Research risk: ${top.risk}`, actor }],
    },
  );
}

/** Adds a listing version (description and price). Prices are minor units in an explicit currency. */
export function addListingVersion(p: ProductOpportunity, description: string, price: string, currency: string, actor: Actor, at: string): Outcome<ProductOpportunity> {
  const refused = authorize(actor, "edit");
  if (refused) return { ok: false, error: refused };
  const cents = parseMoney(price);
  if (cents === null) return { ok: false, error: "The price must be a number with at most two decimals." };
  const cur = currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(cur)) return { ok: false, error: "Use a three-letter currency code such as USD." };
  if (!description.trim()) return { ok: false, error: "Add a description." };
  const version = (p.listing.versions[p.listing.versions.length - 1]?.version ?? 0) + 1;
  // A new version of a published product goes back to approved: the change itself isn't live until a person publishes it.
  const state = p.listing.state === "published" ? "approved" : p.listing.state;
  return { ok: true, value: { ...p, updatedAt: at, listing: { ...p.listing, state, versions: [...p.listing.versions, { version, at, description: description.trim(), priceCents: cents, currency: cur, actor }] } } };
}

export function approveListing(p: ProductOpportunity, actor: Actor, at: string): Outcome<ProductOpportunity> {
  const refused = authorize(actor, "approve_stage");
  if (refused) return { ok: false, error: refused };
  if (!p.listing.versions.length) return { ok: false, error: "Add a description and price first." };
  if (p.listing.state !== "draft") return { ok: false, error: "Only a draft listing can be approved." };
  return { ok: true, value: { ...p, updatedAt: at, listing: { ...p.listing, state: "approved", approvedBy: actor, approvedAt: at } } };
}

/**
 * Records that a person published the listing themselves and confirmed it is live at `url`. This is
 * the manual, approval-ready path: Atlas doesn't publish anything.
 */
export function recordPublished(p: ProductOpportunity, url: string, launchDate: string, actor: Actor, at: string): Outcome<ProductOpportunity> {
  const refused = authorize(actor, "publish_listing");
  if (refused) return { ok: false, error: refused };
  if (p.provenance === "test") return { ok: false, error: "Test products can't be published." };
  if (p.listing.state !== "approved") return { ok: false, error: "Approve the listing before recording it as published." };
  let ok: boolean;
  try {
    ok = new URL(url).protocol === "https:";
  } catch {
    ok = false;
  }
  if (!ok) return { ok: false, error: "Give the live page's https link." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(launchDate)) return { ok: false, error: "Use a launch date like 2026-11-16." };
  return { ok: true, value: { ...p, updatedAt: at, listing: { ...p.listing, state: "published", publishedUrl: url, launchDate } } };
}

export function addFeedback(p: ProductOpportunity, summary: string, actor: Actor, at: string): Outcome<ProductOpportunity> {
  if (!summary.trim()) return { ok: false, error: "Write the feedback." };
  return { ok: true, value: { ...p, updatedAt: at, feedback: [...p.feedback, { id: newId("fb"), at, kind: "note", summary: summary.trim().slice(0, 600), actor }] } };
}

/** Launch milestones for the product analytics view. */
export function milestones(p: ProductOpportunity): { stage: ProductStage; at: string | null; approvedBy: string | null }[] {
  return PRODUCT_STAGES.map((stage) => {
    const h = [...p.history].reverse().find((x) => x.to === stage);
    const a = [...p.approvals].reverse().find((x) => x.stage === stage);
    return { stage, at: h?.at ?? null, approvedBy: a?.actor.name ?? null };
  });
}
