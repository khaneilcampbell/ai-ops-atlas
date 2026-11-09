// Development session health: which Claude Code and Codex sessions on this Mac carried a heavy
// context. Each reply re-sends the whole conversation, so a long session costs more per reply the
// longer it runs. Fixed rules over the session logs' numbers (src/usage/local.ts), no AI.
import type { Finding } from "./insights";
import type { UsageRecord } from "./model";

export const SESSION_AGENTS = ["Claude Code", "Codex (ChatGPT)"];

/** Thresholds on the average prompt per reply; the last replies of a session run about twice this. */
export const SESSION_RULES = {
  /** Past this the session is near the context limit by its end: hand off to a fresh one. */
  freshContext: 80_000,
  /** Past this, or this many replies, compacting earlier would have saved most of the re-reading. */
  compactContext: 40_000,
  longReplies: 200,
  /** The worst sessions shown, so one busy week doesn't flood the list. */
  maxShown: 3,
} as const;

export interface SessionHealth {
  record: UsageRecord;
  /** Average prompt tokens per reply: uncached input plus cache reads and writes. */
  avgContext: number;
  level: "fresh" | "compact" | "ok";
}

export function sessionHealth(records: UsageRecord[]): SessionHealth[] {
  return records
    .filter((r) => SESSION_AGENTS.includes(r.agent) && r.requests > 0)
    .map((r) => {
      const avgContext = (r.input + r.cacheRead + r.cacheWrite) / r.requests;
      const level: SessionHealth["level"] =
        avgContext >= SESSION_RULES.freshContext ? "fresh" : avgContext >= SESSION_RULES.compactContext || r.requests >= SESSION_RULES.longReplies ? "compact" : "ok";
      return { record: r, avgContext, level };
    })
    .sort((a, b) => b.avgContext * b.record.requests - a.avgContext * a.record.requests);
}

const k = (v: number) => `${Math.round(v / 1000).toLocaleString()}k`;

/** "Where to optimize" entries for the heaviest sessions, plus one line on how many ran heavy. */
export function sessionFindings(records: UsageRecord[]): Finding[] {
  const all = sessionHealth(records);
  const heavy = all.filter((s) => s.level !== "ok");
  const out: Finding[] = heavy.slice(0, SESSION_RULES.maxShown).map(({ record: r, avgContext, level }) => {
    const where = `${r.agent} in ${r.project ?? "a folder"} on ${new Date(r.at).toLocaleDateString()}`;
    const reread = `${r.requests.toLocaleString()} replies re-read about ${k(avgContext)} tokens each`;
    return level === "fresh"
      ? {
          id: `session:${r.id}`,
          workflow: r.agent,
          impact: "high",
          title: `Start fresh sooner: ${where}`,
          detail: `${reread}, so the end of the session was near the context limit. When a task changes or the context passes about 100k, run \`npm run handoff -- "what's left"\`, start a new session and paste the handoff.`,
        }
      : {
          id: `session:${r.id}`,
          workflow: r.agent,
          impact: "medium",
          title: `Compact earlier: ${where}`,
          detail: `${reread}. Run /compact between steps of one task, and read big files in ranges or with grep. \`npm run ops\` reports git state and the checks to run in a few lines.`,
        };
  });
  if (heavy.length > SESSION_RULES.maxShown) {
    out.push({
      id: "session:summary",
      workflow: null,
      impact: "low",
      title: `${heavy.length} of ${all.length} coding sessions carried a heavy context`,
      detail: `The ${SESSION_RULES.maxShown} heaviest are listed above. A fresh session with a handoff costs a few thousand tokens; every reply in a long one costs the whole conversation again.`,
    });
  }
  return out;
}
