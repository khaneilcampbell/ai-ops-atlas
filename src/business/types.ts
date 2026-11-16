import type { Actor } from "../tasks/types";

// Business Intelligence & Revenue Operations: the data model. Every record is plain data kept on
// this device (store.ts), never in the repository (it is public) and never invented: a record is
// either something a person entered or imported from a real source, or it is test data, and test
// data says so on screen and is left out of every real figure, goal and report.
//
// Money is always whole minor units (cents) in one currency per record. Atlas never converts
// between currencies, so totals are reported per currency.

/** real: entered or imported from a real source. test: practice data, shown labelled and never counted. */
export type Provenance = "real" | "test";

export interface RecordBase {
  id: string;
  provenance: Provenance;
  /** Where the record came from in plain words, such as "Stripe export 2026-11" or "Entered by hand". */
  source: string;
  createdAt: string;
  createdBy: Actor;
  updatedAt: string;
}

// ── Goals ────────────────────────────────────────────────────────────────────

export const GOAL_DOMAINS = ["revenue", "sales", "marketing", "product", "customer", "operations"] as const;
export type GoalDomain = (typeof GOAL_DOMAINS)[number];

/**
 * What a goal is measured by. Each metric is worked out from real records only (metrics.ts), so a
 * goal is met because the business moved, never because an agent finished a task.
 */
export const GOAL_METRICS = [
  "net_revenue",
  "paying_customers",
  "qualified_leads",
  "won_deals",
  "products_launched",
  "lead_response_hours",
  "ai_cost_per_completed_task",
  "manual",
] as const;
export type GoalMetric = (typeof GOAL_METRICS)[number];

/** Up: higher is better (revenue, customers). Down: lower is better (response time, cost). */
export type MetricDirection = "up" | "down";

export interface EvidenceRef {
  id: string;
  label: string;
  /** What the evidence points at. */
  kind: "sale" | "customer" | "lead" | "product" | "task" | "workflow_run" | "link" | "note";
  ref: string;
  at: string;
  addedBy: Actor;
}

export type GoalState = "draft" | "active" | "achieved" | "missed" | "cancelled";

export interface BusinessGoal extends RecordBase {
  title: string;
  domain: GoalDomain;
  targetOutcome: string;
  metric: GoalMetric;
  /** Only for metric "net_revenue": the currency the target is in. */
  currency?: string;
  /** Value of the metric when the goal was set, as recorded in Atlas. */
  baseline: number;
  target: number;
  /** Only for metric "manual": the latest measured value, with evidence. */
  manualValue?: number;
  startDate: string;
  targetDate: string;
  agentIds: string[];
  workflowRunIds: string[];
  /** Only a person can mark a goal achieved, and only once the metric is met. */
  requiresApproval: boolean;
  state: GoalState;
  evidence: EvidenceRef[];
  /** Who confirmed the outcome, and when. */
  achievedBy?: Actor;
  achievedAt?: string;
  rev: number;
}

// ── Revenue operations ───────────────────────────────────────────────────────

export const DEFAULT_STAGES = ["new", "qualified", "contacted", "proposal", "won", "lost"] as const;
export type LeadStage = (typeof DEFAULT_STAGES)[number];
export const STAGE_LABEL: Record<LeadStage, string> = { new: "New lead", qualified: "Qualified", contacted: "Contacted", proposal: "Proposal", won: "Won", lost: "Lost" };
export const CLOSED_STAGES: ReadonlySet<LeadStage> = new Set(["won", "lost"]);

export interface ContactPreferences {
  /** The person agreed to be contacted about their inquiry. */
  contactConsent: boolean;
  /** The person opted in to marketing messages. Off unless they said yes. */
  marketingOptIn: boolean;
  /** Never contact this person again. Blocks every follow-up. */
  doNotContact: boolean;
  /** How they asked to be reached. */
  channel: "email" | "phone" | "none";
}

export interface StageTransition {
  from: LeadStage | null;
  to: LeadStage;
  at: string;
  actor: Actor;
  note?: string;
}

export interface Interaction {
  id: string;
  at: string;
  kind: "inquiry" | "email" | "call" | "meeting" | "note";
  summary: string;
  actor: Actor;
}

export interface Lead extends RecordBase {
  /** Plain name or label for the lead. Personal details stay out of exports and summaries. */
  name: string;
  /**
   * Where to find the person, never the details themselves when avoidable: an Inquiry to Client id,
   * a CRM id, or "email on file".
   */
  contactRef: string;
  acquisitionSource: string;
  productInterest: string;
  stage: LeadStage;
  agentId?: string;
  followUpDate?: string;
  interactions: Interaction[];
  transitions: StageTransition[];
  preferences: ContactPreferences;
  /** Set when the lead is won and becomes a customer. */
  customerId?: string;
  lostReason?: string;
  rev: number;
}

export const CUSTOMER_STATES = ["active", "at_risk", "churned"] as const;
export type CustomerState = (typeof CUSTOMER_STATES)[number];

export interface Customer extends RecordBase {
  name: string;
  contactRef: string;
  leadId?: string;
  lifecycle: CustomerState;
  productsOwned: string[];
  supportInteractions: Interaction[];
  preferences: ContactPreferences;
  rev: number;
}

export interface Sale extends RecordBase {
  /** The payment provider's or store's order id. */
  orderRef: string;
  productRef: string;
  customerId?: string;
  /** YYYY-MM-DD. */
  date: string;
  /** ISO 4217, upper case. */
  currency: string;
  grossCents: number;
  refundCents: number;
  feeCents: number;
  /**
   * manual: a person typed it in from a source they checked. verified: reconciled against the payment
   * provider (an order id the provider confirmed). Only a person can record either.
   */
  verification: "manual" | "verified";
  /**
   * Which agent helped, only with evidence. direct: the agent's own output closed the sale (for
   * example its checkout link). assisted: the agent worked the lead. Never inferred.
   */
  attribution?: { agentId: string; kind: "direct" | "assisted"; evidence: string };
  rev: number;
}

export const EXPENSE_CATEGORIES = ["ai", "infrastructure", "software", "marketing", "contractor", "fees", "other"] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export const EXPENSE_LABEL: Record<ExpenseCategory, string> = {
  ai: "AI and API",
  infrastructure: "Infrastructure and hosting",
  software: "Software and tools",
  marketing: "Marketing",
  contractor: "Contractors",
  fees: "Bank and platform fees",
  other: "Other",
};

export interface Expense extends RecordBase {
  date: string;
  vendor: string;
  category: ExpenseCategory;
  /** Estimated: a person's estimate (shown as one). Actual: from an invoice or statement. */
  basis: "actual" | "estimated";
  currency: string;
  amountCents: number;
  /** Optional: the product this cost belongs to. */
  productRef?: string;
  rev: number;
}

// ── Product intelligence ─────────────────────────────────────────────────────

export const PRODUCT_STAGES = ["research", "evaluate", "approve", "build", "test", "launch", "measure"] as const;
export type ProductStage = (typeof PRODUCT_STAGES)[number];
export const PRODUCT_STAGE_LABEL: Record<ProductStage, string> = {
  research: "Research",
  evaluate: "Evaluate",
  approve: "Approve",
  build: "Build",
  test: "Test",
  launch: "Launch",
  measure: "Measure",
};

/** Moving INTO these stages commits money, publishes, or releases, so a person must approve it. */
export const GATED_STAGES: Readonly<Partial<Record<ProductStage, string>>> = {
  build: "Starting development commits time and money",
  launch: "Launching publishes the product to the public",
  measure: "Measuring starts after a production release",
};

export interface ProductApproval {
  stage: ProductStage;
  at: string;
  actor: Actor;
  note?: string;
}

export interface ProductOpportunity extends RecordBase {
  title: string;
  /** Benjaire Product Lab brief this came from (report id on the site), when it came from one. */
  researchReportId?: number;
  researchMonth?: string;
  targetCustomer: string;
  competitors: string[];
  requirements: string[];
  /** Hours to a first version, as a person estimated it. */
  mvpHours?: number;
  pricingHypothesis: string;
  /** Scorecard total out of 5.00 from the research brief, when there is one. */
  researchScore?: number;
  stage: ProductStage;
  approvals: ProductApproval[];
  /** Product reference sales use (Sale.productRef). */
  productRef: string;
  feedback: Interaction[];
  /** The Product Marketplace listing: versions, prices and whether it is published. */
  listing: MarketplaceListing;
  history: { from: ProductStage | null; to: ProductStage; at: string; actor: Actor }[];
  rev: number;
}

export type ListingState = "draft" | "approved" | "published";

export interface ListingVersion {
  version: number;
  at: string;
  description: string;
  priceCents: number;
  currency: string;
  actor: Actor;
}

export interface MarketplaceListing {
  state: ListingState;
  versions: ListingVersion[];
  launchDate?: string;
  /**
   * The public page a person confirmed is live. Atlas has no verified publishing integration, so a
   * listing is only "published" when a person records this link.
   */
  publishedUrl?: string;
  approvedBy?: Actor;
  approvedAt?: string;
}

// ── The stored file ──────────────────────────────────────────────────────────

export interface BusinessData {
  goals: BusinessGoal[];
  leads: Lead[];
  customers: Customer[];
  sales: Sale[];
  expenses: Expense[];
  products: ProductOpportunity[];
}

export type Collection = keyof BusinessData;

export const EMPTY_DATA: BusinessData = { goals: [], leads: [], customers: [], sales: [], expenses: [], products: [] };
