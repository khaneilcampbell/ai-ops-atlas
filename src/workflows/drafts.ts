import { useSyncExternalStore } from "react";
import { writeWithRoom } from "../lib/storage";
import type { Backend } from "../tasks/store";
import type { WorkflowDraft } from "./design";

// Saved Design-mode drafts, one per workflow (keyed by its definition id), kept on this device next
// to the live runs and in the same way. Saving never touches the template in the code or any run:
// a run keeps its own frozen copy, and Run mode keeps reading the template.

const KEY = "atlas:workflow-drafts";

interface DraftFile {
  version: 1;
  drafts: Record<string, WorkflowDraft>;
}

export const localDraftBackend: Backend = {
  read: () => {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  },
  write: (raw) => writeWithRoom(KEY, raw),
  watch: (fn) => {
    const on = (e: StorageEvent) => e.key === KEY && fn();
    window.addEventListener("storage", on);
    return () => window.removeEventListener("storage", on);
  },
};

const isDraft = (d: unknown): d is WorkflowDraft => {
  const x = d as Partial<WorkflowDraft> | null;
  return (
    !!x &&
    x.status === "draft" &&
    typeof x.definitionId === "string" &&
    typeof x.revision === "number" &&
    Array.isArray(x.steps) &&
    x.steps.every((s) => s && typeof s.id === "string" && Array.isArray(s.handoffs) && Array.isArray(s.outputs))
  );
};

function parse(raw: string | null): Record<string, WorkflowDraft> {
  if (!raw) return {};
  try {
    const f = JSON.parse(raw) as Partial<DraftFile>;
    if (f.version !== 1 || !f.drafts || typeof f.drafts !== "object") return {};
    return Object.fromEntries(Object.entries(f.drafts).filter(([id, d]) => isDraft(d) && d.definitionId === id));
  } catch {
    return {};
  }
}

export class DraftStore {
  private drafts: Record<string, WorkflowDraft>;
  private listeners = new Set<() => void>();
  constructor(private backend: Backend) {
    this.drafts = parse(backend.read());
    backend.watch?.(() => {
      this.drafts = parse(backend.read());
      this.emit();
    });
  }
  all(): Readonly<Record<string, WorkflowDraft>> {
    return this.drafts;
  }
  get(definitionId: string): WorkflowDraft | undefined {
    return this.drafts[definitionId];
  }
  /** Saves the draft as the next revision of its workflow. Returns the saved draft, or an error. */
  save(draft: WorkflowDraft, at = new Date().toISOString()): { draft: WorkflowDraft | null; error: string | null } {
    const current = parse(this.backend.read());
    const prev = current[draft.definitionId];
    const saved: WorkflowDraft = { ...draft, status: "draft", revision: Math.max(prev?.revision ?? 0, draft.revision) + 1, savedAt: at };
    return this.commit({ ...current, [draft.definitionId]: saved }) ?? { draft: saved, error: null };
  }
  /** Drops the saved draft, so Design mode starts again from the template. The template is unchanged. */
  discard(definitionId: string): string | null {
    const current = parse(this.backend.read());
    delete current[definitionId];
    return this.commit(current)?.error ?? null;
  }
  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private commit(next: Record<string, WorkflowDraft>): { draft: null; error: string } | null {
    try {
      this.backend.write(JSON.stringify({ version: 1, drafts: next } satisfies DraftFile));
    } catch {
      return { draft: null, error: "Couldn't save the draft: this device's storage is full or unavailable." };
    }
    this.drafts = next;
    this.emit();
    return null;
  }
  private emit() {
    this.listeners.forEach((l) => l());
  }
}

let shared: DraftStore | null = null;
export function draftStore(): DraftStore {
  if (!shared) shared = new DraftStore(localDraftBackend);
  return shared;
}

export function useDrafts(): Readonly<Record<string, WorkflowDraft>> {
  const s = draftStore();
  return useSyncExternalStore(
    (fn) => s.subscribe(fn),
    () => s.all(),
    () => s.all(),
  );
}
