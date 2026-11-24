// Who may do what with the Atlas records. Khaneil, signed in through Cloudflare Access, may read
// and write everything. Each agent key may only touch the areas and tables listed for it here, so
// no agent sees every kind of data. The list lives in code so a change to it is reviewed in a pull
// request; the keys themselves are only in the site's secrets (ATLAS_DATA_KEYS).

import type { AccessCategory, Area, FactTable } from "../../src/data/records";
import { cleanKey } from "../live";
import { sameSecret } from "../usage";

export interface AgentPolicy {
  name: string;
  /** Areas whose records this agent may read or write. "finance" and "life" are left out unless needed. */
  areas: readonly Area[];
  /** Fact tables it may read for context. */
  read: readonly FactTable[];
  /** Fact tables it may create rows in, and update rows it created. Never rows Khaneil owns. */
  write: readonly FactTable[];
  /** Document categories it may see. "restricted" is never served to an agent, even if listed. */
  documents: readonly AccessCategory[];
  /**
   * Agent memory (server/memory/). "read": search memory and run the pre-run check. "write": also
   * record working and operational memory, run feedback and lessons, always unverified. Leave it out
   * for no memory access. Only Khaneil verifies, revises or retires memory.
   */
  memory?: "read" | "write";
  /** The catalog agent (catalog/*.yaml id) this key runs for, so its agent page shows the key's runs and memory. */
  catalogId?: string;
  /**
   * May read GET reports/agents: per-agent counts only (runs, failures, tokens, cost, memory items,
   * feedback), never a record's content. For the Data Intelligence Center's agent self-reports.
   */
  agentReports?: boolean;
}

/**
 * The agent keys Atlas accepts, by key id. A key in ATLAS_DATA_KEYS whose id isn't listed here
 * is ignored. Every agent may also record its own runs, add AI notes on records it can read, and
 * file approval requests in its areas.
 */
export const AGENT_POLICIES: Readonly<Record<string, AgentPolicy>> = {
  // The example n8n flow in docs/data-foundation.md: reads project context, files tasks, logs runs.
  "task-writer": { name: "Task writer (n8n)", areas: ["business", "projects", "career"], read: ["goals", "projects", "tasks", "decisions", "documents"], write: ["tasks"], documents: ["shared", "internal"], memory: "write", catalogId: "atlas-task-writer" },
  // n8n "Data Intelligence · Agent Self-Reports": counts about each agent for its daily self-report.
  // No areas, tables, documents or memory content: only GET reports/agents.
  "self-reports": { name: "Agent self-reports (n8n)", areas: [], read: [], write: [], documents: [], agentReports: true, catalogId: "agent-self-reports" },
};

export type Actor = { kind: "owner"; id: string; name: string } | { kind: "agent"; id: string; name: string; policy: AgentPolicy };

export const OWNER_ID = "owner";

export function ownerActor(email: string | null): Actor {
  return { kind: "owner", id: OWNER_ID, name: email?.slice(0, 120) || "Khaneil" };
}

/** ATLAS_DATA_KEYS: comma-separated "key-id:key" pairs. Keys shorter than 32 characters are ignored. */
export function parseKeys(raw: string | undefined): { id: string; key: string }[] {
  const out: { id: string; key: string }[] = [];
  for (const part of (raw ?? "").split(",")) {
    const i = part.indexOf(":");
    if (i <= 0) continue;
    const id = part.slice(0, i).trim();
    const key = cleanKey(part.slice(i + 1));
    if (AGENT_POLICIES[id] && key.length >= 32) out.push({ id, key });
  }
  return out;
}

/** The agent a request's bearer key belongs to, or null. Every key is compared, in constant time. */
export function agentFor(req: Request, raw: string | undefined): Actor | null {
  const auth = (req.headers.get("authorization") ?? "").trim();
  if (!/^bearer\s/i.test(auth)) return null;
  const token = cleanKey(auth);
  let found: string | null = null;
  for (const k of parseKeys(raw)) if (sameSecret(token, k.key) && !found) found = k.id;
  if (!found) return null;
  const policy = AGENT_POLICIES[found];
  return { kind: "agent", id: found, name: policy.name, policy };
}

export const canRead = (a: Actor, table: FactTable) => a.kind === "owner" || a.policy.read.includes(table) || a.policy.write.includes(table);
export const canWrite = (a: Actor, table: FactTable) => a.kind === "owner" || a.policy.write.includes(table);
export const inArea = (a: Actor, area: string) => a.kind === "owner" || (a.policy.areas as readonly string[]).includes(area);
export const areasOf = (a: Actor): readonly string[] | null => (a.kind === "owner" ? null : a.policy.areas);
export const canReadMemory = (a: Actor) => a.kind === "owner" || a.policy.memory === "read" || a.policy.memory === "write";
export const canReadAgentReports = (a: Actor) => a.kind === "owner" || a.policy.agentReports === true;
export const canWriteMemory = (a: Actor) => a.kind === "owner" || a.policy.memory === "write";
export const documentCategoriesOf = (a: Actor): readonly string[] | null => (a.kind === "owner" ? null : a.policy.documents.filter((c) => c !== "restricted"));
