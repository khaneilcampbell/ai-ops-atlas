import type { Inquiry } from "./model";

/** One inquiry as the benjaire.com Worker sends it (site/worker/lib.ts atlasInquiry). */
export const sample = (over: Partial<Inquiry> = {}): Inquiry => ({
  id: "0b6a1f9e-1111-4c2d-9e7a-123456789abc",
  received_at: "2026-11-01T06:00:00.000Z",
  category: "digital",
  category_label: "Digital Solutions",
  name: "Alex Chen",
  email: "alex@factory.example",
  company: "Factory Co",
  message: "We want to automate our order emails and would like a quote.",
  host: "benjaire.com",
  ...over,
});
