import type { Actor } from "../tasks/types";
import type { Customer, Lead, Provenance } from "./types";

// Who may do what with business records. Atlas has one owner (Khaneil), so the roles are about the
// kind of actor: a person can do everything; an agent, a workflow or Atlas itself can only propose
// (create test records, add notes, suggest), and can never record real money, approve a gate,
// publish, or confirm a goal. Every screen and intake path goes through `authorize`.

export const BUSINESS_ACTIONS = [
  "record_real",
  "record_test",
  "edit",
  "move_lead",
  "approve_stage",
  "publish_listing",
  "confirm_goal",
  "delete",
  "view_personal",
  "propose",
] as const;
export type BusinessAction = (typeof BUSINESS_ACTIONS)[number];

const AUTOMATED_ALLOWED: ReadonlySet<BusinessAction> = new Set(["record_test", "propose"]);

/** Null when allowed, otherwise the reason it isn't. */
export function authorize(actor: Actor, action: BusinessAction): string | null {
  if (actor.kind === "person") return null;
  if (AUTOMATED_ALLOWED.has(action)) return null;
  return `${actor.name} is ${actor.kind === "agent" ? "an agent" : "an automation"}; only a person can ${ACTION_WORDS[action]}.`;
}

const ACTION_WORDS: Record<BusinessAction, string> = {
  record_real: "record real business data",
  record_test: "add test data",
  edit: "change a record",
  move_lead: "move a lead through the pipeline",
  approve_stage: "approve a product stage",
  publish_listing: "publish a product",
  confirm_goal: "confirm a goal was achieved",
  delete: "delete a record",
  view_personal: "see personal contact details",
  propose: "make a suggestion",
};

/** May this actor create a record with this provenance? */
export const createRefusal = (actor: Actor, provenance: Provenance) => authorize(actor, provenance === "real" ? "record_real" : "record_test");

/**
 * A lead or customer as it may be shared with an agent, an export or a model prompt: no contact
 * reference, no interaction text, only the business facts.
 */
export function redactPerson<T extends Lead | Customer>(r: T): Omit<T, "contactRef" | "name"> & { name: string; contactRef: string } {
  const masked = { ...r, name: `${r.provenance === "test" ? "Test " : ""}${r.id.slice(-6)}`, contactRef: "(hidden)" };
  if ("interactions" in masked) (masked as Lead).interactions = (masked as Lead).interactions.map((i) => ({ ...i, summary: "(hidden)" }));
  if ("supportInteractions" in masked) (masked as Customer).supportInteractions = (masked as Customer).supportInteractions.map((i) => ({ ...i, summary: "(hidden)" }));
  return masked;
}

/** How long closed records with personal details are kept, in days (same as client inquiries). */
export const RETENTION_DAYS = 180;
const DAY = 86_400_000;

/**
 * Lost leads untouched for RETENTION_DAYS are removed, and anyone who asked not to be contacted has
 * their contact reference cleared. Customers stay (they have purchases), but a churned customer
 * untouched that long loses its contact reference too. Returns what to save.
 */
export function retentionSweep(leads: readonly Lead[], customers: readonly Customer[], now: number): { removeLeads: string[]; scrubLeads: Lead[]; scrubCustomers: Customer[] } {
  const old = (iso: string) => now - Date.parse(iso) > RETENTION_DAYS * DAY;
  const removeLeads = leads.filter((l) => l.stage === "lost" && old(l.updatedAt)).map((l) => l.id);
  const scrubLeads = leads.filter((l) => !removeLeads.includes(l.id) && l.preferences.doNotContact && l.contactRef !== "(removed)").map((l) => ({ ...l, contactRef: "(removed)" }));
  const scrubCustomers = customers.filter((c) => c.contactRef !== "(removed)" && ((c.lifecycle === "churned" && old(c.updatedAt)) || c.preferences.doNotContact)).map((c) => ({ ...c, contactRef: "(removed)" }));
  return { removeLeads, scrubLeads, scrubCustomers };
}
