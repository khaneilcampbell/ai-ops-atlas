import { newId } from "../tasks/lifecycle";
import type { Actor } from "../tasks/types";
import { CLOSED_STAGES, DEFAULT_STAGES, type Customer, type Lead, type LeadStage, type Provenance, type Sale } from "./types";

// Revenue operations: the lead pipeline, customers and sales. Plain functions with no I/O; the
// screens save what they return. Every figure comes from records, never from a model.

export type Outcome<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Which stage can follow which. The order of the pipeline is New lead -> Qualified -> Contacted ->
 * Proposal -> Won / Lost; a lead can be lost from any open stage, and a lost lead can be reopened
 * as New. A won lead is closed: its next life is as a customer.
 */
export const LEAD_TRANSITIONS: Readonly<Record<LeadStage, readonly LeadStage[]>> = {
  new: ["qualified", "lost"],
  qualified: ["contacted", "lost"],
  contacted: ["proposal", "lost"],
  proposal: ["won", "lost", "contacted"],
  won: [],
  lost: ["new"],
};

/** A pipeline order that can be changed later (configurable stages), checked against the transitions. */
export interface PipelineConfig {
  stages: readonly LeadStage[];
  transitions: Readonly<Record<LeadStage, readonly LeadStage[]>>;
}
export const DEFAULT_PIPELINE: PipelineConfig = { stages: DEFAULT_STAGES, transitions: LEAD_TRANSITIONS };

export function moveLead(lead: Lead, to: LeadStage, actor: Actor, at: string, note?: string, cfg: PipelineConfig = DEFAULT_PIPELINE): Outcome<Lead> {
  if (lead.stage === to) return { ok: false, error: "The lead is already at that stage." };
  if (!cfg.transitions[lead.stage].includes(to)) return { ok: false, error: `A lead can't go from ${lead.stage} to ${to}.` };
  if (to === "contacted" && !canContact(lead)) return { ok: false, error: "This person hasn't agreed to be contacted, or asked not to be. Record consent first." };
  if (to === "lost" && !note?.trim()) return { ok: false, error: "Say why the lead was lost." };
  return {
    ok: true,
    value: {
      ...lead,
      stage: to,
      updatedAt: at,
      ...(to === "lost" ? { lostReason: note!.trim() } : {}),
      ...(to === "new" ? { lostReason: undefined } : {}),
      transitions: [...lead.transitions, { from: lead.stage, to, at, actor, ...(note?.trim() ? { note: note.trim() } : {}) }],
    },
  };
}

/** Contact is allowed only with consent and no do-not-contact request. */
export const canContact = (p: Pick<Lead, "preferences">) => p.preferences.contactConsent && !p.preferences.doNotContact && p.preferences.channel !== "none";

export interface FollowUp {
  lead: Lead;
  due: boolean;
  overdueDays: number;
}

const DAY = 86_400_000;

/** Open leads with a follow-up date that may be contacted, soonest first. */
export function followUps(leads: readonly Lead[], now: number): FollowUp[] {
  return leads
    .filter((l) => !CLOSED_STAGES.has(l.stage) && l.followUpDate && canContact(l))
    .map((l) => {
      const at = Date.parse(l.followUpDate!);
      return { lead: l, due: now >= at, overdueDays: Math.max(0, Math.floor((now - at) / DAY)) };
    })
    .sort((a, b) => Date.parse(a.lead.followUpDate!) - Date.parse(b.lead.followUpDate!));
}

/** Turns a won lead into a customer, keeping its consent. The lead must be won and not yet linked. */
export function customerFromLead(lead: Lead, actor: Actor, at: string): Outcome<Customer> {
  if (lead.stage !== "won") return { ok: false, error: "Only a won lead becomes a customer." };
  if (lead.customerId) return { ok: false, error: "This lead is already a customer." };
  return {
    ok: true,
    value: {
      id: newId("cust"),
      provenance: lead.provenance,
      source: `Won lead ${lead.id}`,
      createdAt: at,
      createdBy: actor,
      updatedAt: at,
      name: lead.name,
      contactRef: lead.contactRef,
      leadId: lead.id,
      lifecycle: "active",
      productsOwned: lead.productInterest ? [lead.productInterest] : [],
      supportInteractions: [],
      preferences: lead.preferences,
      rev: 1,
    },
  };
}

// ── Conversion ───────────────────────────────────────────────────────────────

export interface StageCount {
  stage: LeadStage;
  /** Leads that ever reached the stage. */
  reached: number;
  /** Leads at the stage now. */
  current: number;
}

export interface Conversion {
  stages: StageCount[];
  /** Won / (won + lost), or null with no closed leads. */
  winRate: number | null;
  /** Leads that reached each stage as a share of those that reached the one before (null when none did). */
  stepRates: { from: LeadStage; to: LeadStage; rate: number | null }[];
  total: number;
}

const reachedStages = (l: Lead) => new Set<LeadStage>([...l.transitions.map((t) => t.to), l.stage]);

/** Conversion over real leads only. Test leads never count toward a real rate. */
export function conversion(leads: readonly Lead[], cfg: PipelineConfig = DEFAULT_PIPELINE): Conversion {
  const real = leads.filter((l) => l.provenance === "real");
  const sets = real.map(reachedStages);
  const stages = cfg.stages.map((stage) => ({ stage, reached: sets.filter((s) => s.has(stage)).length, current: real.filter((l) => l.stage === stage).length }));
  const won = real.filter((l) => l.stage === "won").length;
  const lost = real.filter((l) => l.stage === "lost").length;
  const open = cfg.stages.filter((s) => !CLOSED_STAGES.has(s));
  const path: LeadStage[] = [...open, "won"];
  const stepRates = path.slice(1).map((to, i) => {
    const from = path[i];
    const a = stages.find((s) => s.stage === from)!.reached;
    const b = stages.find((s) => s.stage === to)!.reached;
    return { from, to, rate: a ? b / a : null };
  });
  return { stages, winRate: won + lost ? won / (won + lost) : null, stepRates, total: real.length };
}

/** Hours from a lead's first recorded moment to its first outgoing contact, for real leads that were contacted. */
export function responseHours(leads: readonly Lead[]): number[] {
  return leads
    .filter((l) => l.provenance === "real")
    .flatMap((l) => {
      const contacted = l.transitions.find((t) => t.to === "contacted");
      const reply = l.interactions.find((i) => i.kind !== "inquiry" && i.kind !== "note");
      const first = [contacted?.at, reply?.at].filter((x): x is string => !!x).sort()[0];
      return first ? [(Date.parse(first) - Date.parse(l.createdAt)) / 3_600_000] : [];
    })
    .filter((h) => h >= 0);
}

export function median(xs: readonly number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ── Sales ────────────────────────────────────────────────────────────────────

const CURRENCY_RE = /^[A-Z]{3}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Net revenue of a sale: gross less refunds and fees, in minor units. */
export const netCents = (s: Pick<Sale, "grossCents" | "refundCents" | "feeCents">) => s.grossCents - s.refundCents - s.feeCents;

export interface SaleInput {
  orderRef: string;
  productRef: string;
  customerId?: string;
  date: string;
  currency: string;
  gross: string;
  refunds: string;
  fees: string;
  provenance: Provenance;
  source: string;
}

/** Parses a money amount typed by a person ("12", "12.5", "1,234.56") into minor units. */
export function parseMoney(text: string): number | null {
  const t = text.replace(/,/g, "").trim();
  if (!t) return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const [whole, frac = ""] = t.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

export function draftSale(input: SaleInput, existing: readonly Sale[], actor: Actor, at: string): Outcome<Sale> {
  const orderRef = input.orderRef.trim();
  if (!orderRef) return { ok: false, error: "An order reference is required, so the sale can be traced to its source." };
  if (existing.some((s) => s.orderRef === orderRef && s.provenance === input.provenance)) return { ok: false, error: "That order is already recorded." };
  if (!input.productRef.trim()) return { ok: false, error: "Say which product was sold." };
  if (!DATE_RE.test(input.date) || Number.isNaN(Date.parse(input.date))) return { ok: false, error: "Use a date like 2026-11-16." };
  const currency = input.currency.trim().toUpperCase();
  if (!CURRENCY_RE.test(currency)) return { ok: false, error: "Use a three-letter currency code such as USD." };
  const gross = parseMoney(input.gross), refunds = parseMoney(input.refunds), fees = parseMoney(input.fees);
  if (gross === null || refunds === null || fees === null) return { ok: false, error: "Amounts must be numbers with at most two decimals." };
  if (gross <= 0) return { ok: false, error: "Gross revenue must be more than zero." };
  if (refunds > gross) return { ok: false, error: "Refunds can't be more than the gross amount." };
  if (input.provenance === "real" && !input.source.trim()) return { ok: false, error: "Say where this sale came from (for example the Stripe dashboard), so it can be checked." };
  return {
    ok: true,
    value: {
      id: newId("sale"),
      provenance: input.provenance,
      source: input.source.trim() || (input.provenance === "test" ? "Test data" : ""),
      createdAt: at,
      createdBy: actor,
      updatedAt: at,
      orderRef,
      productRef: input.productRef.trim(),
      ...(input.customerId ? { customerId: input.customerId } : {}),
      date: input.date,
      currency,
      grossCents: gross,
      refundCents: refunds,
      feeCents: fees,
      verification: "manual",
      rev: 1,
    },
  };
}

/** "$1,234.56"-style text for minor units in a currency. */
export function money(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}
