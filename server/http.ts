// Shared plumbing for the Pages functions: every API answer is JSON that must never be cached.

export const noStore = { "cache-control": "no-store" };

/** A JSON answer with the given status that browsers and the edge must not cache. */
export const reply = (status: number, body: unknown) => Response.json(body, { status, headers: noStore });

/** Loosely shaped JSON from an outside API (GitHub, Cloudflare, n8n). Read fields defensively. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = Record<string, any>;
