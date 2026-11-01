import { useSyncExternalStore } from "react";
import { load, save } from "../lib/storage";
import type { InquiryProgress } from "./model";

// Where KC is with each inquiry (replied, follow-ups sent, closed), remembered on this device by
// inquiry id. The site only stores what the client wrote; nothing here is sent anywhere.

const KEY = "inquiryProgress";
const KEEP = 300;

let progress = load<Record<string, InquiryProgress>>(KEY, {});
const watchers = new Set<() => void>();
const subscribe = (w: () => void) => {
  watchers.add(w);
  return () => watchers.delete(w);
};

function set(id: string, next: InquiryProgress) {
  const entries = Object.entries({ ...progress, [id]: next });
  progress = Object.fromEntries(entries.slice(-KEEP));
  save(KEY, progress);
  watchers.forEach((w) => w());
}

export const markReplied = (id: string, now = Date.now()) => set(id, { stage: "replied", repliedAt: new Date(now).toISOString(), followUps: 0 });
export const markFollowedUp = (id: string) => {
  const p = progress[id];
  if (p?.stage === "replied") set(id, { ...p, followUps: (p.followUps ?? 0) + 1 });
};
export const markClosed = (id: string) => set(id, { ...(progress[id] ?? {}), stage: "closed" });
export const reopen = (id: string) => set(id, { stage: "new" });

export function useInquiryProgress(): Record<string, InquiryProgress> {
  return useSyncExternalStore(subscribe, () => progress);
}
