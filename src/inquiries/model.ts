// Inquiry to Client (B1). The benjaire.com contact Worker copies each delivered inquiry to
// /api/hooks/inquiries (server/inquiries.ts); Atlas lists them in Mission Control, drafts a reply
// from a fixed template per category, and reminds KC to follow up on day 3 and day 7. Nothing
// here calls a model and nothing sends mail: "Reply" opens KC's own mail app with the draft, so
// every message a client gets is one KC read and sent. Zero running cost.

export const INQUIRY_AGENT = "benjaire-inquiry-to-client";
export const MAX_INQUIRY_BYTES = 12_000;
/** Stored inquiries older than this are deleted (personal data, so a fixed retention). */
export const KEEP_DAYS = 180;
/** Days after the first reply when a follow-up is due, if KC hasn't closed it. */
export const FOLLOW_UP_DAYS = [3, 7] as const;

export interface Inquiry {
  id: string;
  received_at: string;
  category: string;
  category_label: string;
  name: string;
  email: string;
  company: string;
  message: string;
  host: string;
}

const LIMITS = { id: 64, category: 40, label: 80, name: 120, email: 254, company: 160, message: 5000, host: 120 } as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const str = (v: unknown, max: number, min = 0) => typeof v === "string" && v.length >= min && v.length <= max;

/** Same limits as the Worker's validate(); anything else is refused. */
export function validInquiry(x: unknown): x is Inquiry {
  if (!x || typeof x !== "object") return false;
  const i = x as Record<string, unknown>;
  return (
    str(i.id, LIMITS.id, 8) &&
    /^[A-Za-z0-9-]+$/.test(i.id as string) &&
    str(i.received_at, 40, 10) &&
    !Number.isNaN(Date.parse(i.received_at as string)) &&
    str(i.category, LIMITS.category, 1) &&
    str(i.category_label, LIMITS.label, 1) &&
    str(i.name, LIMITS.name, 1) &&
    str(i.email, LIMITS.email) &&
    EMAIL_RE.test(i.email as string) &&
    str(i.company, LIMITS.company) &&
    str(i.message, LIMITS.message, 1) &&
    str(i.host, LIMITS.host)
  );
}

/** Where KC is with one inquiry. Kept on the device (src/inquiries/state.ts), not on the site. */
export type InquiryStage = "new" | "replied" | "closed";
export interface InquiryProgress {
  stage: InquiryStage;
  /** When KC marked the first reply sent. */
  repliedAt?: string;
  /** How many follow-ups KC has marked sent (0, 1 or 2). */
  followUps?: number;
}

export type NextStep =
  | { kind: "reply"; overdue: boolean }
  | { kind: "follow_up"; number: 1 | 2; due: boolean; dueAt: string }
  | { kind: "done" };

const DAY = 86_400_000;

/** What to do next with an inquiry: reply (late after a day), a follow-up (due on day 3 and 7), or nothing. */
export function nextStep(inquiry: Inquiry, p: InquiryProgress | undefined, now = Date.now()): NextStep {
  const stage = p?.stage ?? "new";
  if (stage === "closed") return { kind: "done" };
  if (stage === "new") return { kind: "reply", overdue: now - Date.parse(inquiry.received_at) > DAY };
  const sent = Math.min(p?.followUps ?? 0, FOLLOW_UP_DAYS.length);
  if (sent >= FOLLOW_UP_DAYS.length || !p?.repliedAt) return { kind: "done" };
  const dueAt = Date.parse(p.repliedAt) + FOLLOW_UP_DAYS[sent] * DAY;
  return { kind: "follow_up", number: (sent + 1) as 1 | 2, due: now >= dueAt, dueAt: new Date(dueAt).toISOString() };
}

/** First name for a greeting; the whole name if it is one word. */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || "there";
}

const OPENERS: Record<string, string> = {
  digital: "Thanks for reaching out about Digital Solutions. I'd be glad to help.",
  partnership: "Thanks for reaching out about a partnership with Benjaire.",
  supplier: "Thanks for reaching out about supply and manufacturing.",
  general: "Thanks for getting in touch with Benjaire.",
};

const ASKS: Record<string, string> = {
  digital: "To point you to the right option, could you share what you'd like to automate or build, roughly when you need it, and the budget range you have in mind?",
  partnership: "Could you tell me a little more about what you have in mind and what a good first step would look like for you?",
  supplier: "Could you send product details, minimum order quantities, lead times and pricing, plus any certifications?",
  general: "Could you share a bit more detail so I can get you the right answer?",
};

const quote = (message: string) => {
  const line = message.replace(/\s+/g, " ").trim();
  return line.length > 160 ? `${line.slice(0, 157)}...` : line;
};

/** The first reply, from a fixed template per category. KC edits it in the mail app before sending. */
export function replyDraft(i: Inquiry): { subject: string; body: string } {
  const opener = OPENERS[i.category] ?? OPENERS.general;
  const ask = ASKS[i.category] ?? ASKS.general;
  const company = i.company ? ` at ${i.company}` : "";
  return {
    subject: `Re: your ${i.category_label} inquiry`,
    body: [
      `Hi ${firstName(i.name)},`,
      "",
      `${opener} You wrote${company}: "${quote(i.message)}"`,
      "",
      ask,
      "",
      "If it's easier to talk it through, reply with two or three times that suit you this week and I'll send an invite.",
      "",
      "Best,",
      "KC",
      "Benjaire",
    ].join("\n"),
  };
}

/** Follow-up 1 (day 3) and 2 (day 7, the last one). */
export function followUpDraft(i: Inquiry, n: 1 | 2): { subject: string; body: string } {
  const lines =
    n === 1
      ? [`Hi ${firstName(i.name)},`, "", `Just following up on your ${i.category_label} inquiry in case my last note got buried. Happy to help whenever you're ready.`, "", "Best,", "KC"]
      : [`Hi ${firstName(i.name)},`, "", `I'll close out your ${i.category_label} inquiry for now so I don't keep filling your inbox. If anything changes, just reply here and I'll pick it straight back up.`, "", "Best,", "KC"];
  return { subject: `Re: your ${i.category_label} inquiry`, body: lines.join("\n") };
}

/** A Gmail compose link (opens in the browser, where KC's signature and logo are added) with the draft filled in. */
export function gmailCompose(to: string, draft: { subject: string; body: string }): string {
  return `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`;
}

/** A mailto: link that opens KC's mail app with the draft filled in. */
export function mailto(to: string, draft: { subject: string; body: string }): string {
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`;
}
