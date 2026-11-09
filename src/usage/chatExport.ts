// Chat usage from a Claude or ChatGPT data export (Settings → Privacy → Export data, then the
// conversations.json inside the zip). Neither chat product has a usage API, so this is the only
// record of chat use. The text is read here only to measure its length; it is never stored, and
// only counts leave this function. Tokens are estimated at about 4 characters per token, so the
// rows say "estimated tokens" in their name. Chat plans have no per-token price: no cost.
import type { UsageRecord } from "./model";

export const CHARS_PER_TOKEN = 4;
export type ChatSource = "claude" | "chatgpt";

type J = Record<string, unknown>;
const isObj = (v: unknown): v is J => !!v && typeof v === "object" && !Array.isArray(v);

/** Which product's export this is, from the shape of its first conversation. */
export function detectChatExport(data: unknown): ChatSource | null {
  if (!Array.isArray(data) || data.length === 0 || !isObj(data[0])) return null;
  if (Array.isArray(data[0].chat_messages)) return "claude";
  if (isObj(data[0].mapping)) return "chatgpt";
  return null;
}

interface Turn {
  at: number;
  role: "user" | "assistant";
  chars: number;
  model: string | null;
}

function textLength(v: unknown): number {
  if (typeof v === "string") return v.length;
  if (Array.isArray(v)) return v.reduce((s: number, x) => s + textLength(x), 0);
  if (isObj(v)) return textLength(v.text ?? v.parts ?? "");
  return 0;
}

function claudeTurns(c: J): Turn[] {
  const msgs = Array.isArray(c.chat_messages) ? c.chat_messages : [];
  return msgs.filter(isObj).flatMap((m): Turn[] => {
    const at = Date.parse(String(m.created_at ?? c.created_at ?? ""));
    const role = m.sender === "human" ? "user" : m.sender === "assistant" ? "assistant" : null;
    if (!role || Number.isNaN(at)) return [];
    const chars = Array.isArray(m.content) && m.content.length ? textLength(m.content) : textLength(m.text);
    return [{ at, role, chars, model: null }];
  });
}

function chatgptTurns(c: J): Turn[] {
  const mapping = isObj(c.mapping) ? c.mapping : {};
  return Object.values(mapping).flatMap((node): Turn[] => {
    const m = isObj(node) && isObj(node.message) ? node.message : null;
    if (!m) return [];
    const author = isObj(m.author) ? m.author.role : null;
    const role = author === "user" ? "user" : author === "assistant" ? "assistant" : null;
    const at = typeof m.create_time === "number" ? m.create_time * 1000 : typeof c.create_time === "number" ? c.create_time * 1000 : NaN;
    if (!role || Number.isNaN(at)) return [];
    const content = isObj(m.content) ? m.content : {};
    const meta = isObj(m.metadata) ? m.metadata : {};
    return [{ at, role, chars: textLength(content.parts ?? content.text ?? ""), model: typeof meta.model_slug === "string" ? meta.model_slug : null }];
  });
}

const day = (t: number) => {
  const d = new Date(t);
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
};

/**
 * One record per conversation per day: prompts sent (requests), estimated tokens in and out.
 * `project` is the conversation's title, so the table can group your prompt work by topic.
 */
export function chatExportRecords(data: unknown, fileName: string): { source: ChatSource; records: UsageRecord[] } | null {
  const source = detectChatExport(data);
  if (!source) return null;
  const agent = source === "claude" ? "Claude chat (estimated tokens)" : "ChatGPT chat (estimated tokens)";
  const provider = source === "claude" ? "anthropic" : "openai";
  const out = new Map<string, UsageRecord>();
  for (const c of (data as unknown[]).filter(isObj)) {
    const title = String((source === "claude" ? c.name : c.title) ?? "").trim().slice(0, 200) || "Untitled chat";
    const turns = source === "claude" ? claudeTurns(c) : chatgptTurns(c);
    for (const t of turns) {
      const key = `${title}|${day(t.at)}`;
      let r = out.get(key);
      if (!r) {
        r = { id: `import:${fileName}:${out.size}`, at: day(t.at), provider, model: null, agent, project: title, requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: null, costKind: "plan", source: "import" };
        out.set(key, r);
      }
      const tokens = Math.round(t.chars / CHARS_PER_TOKEN);
      if (t.role === "user") {
        r.requests++;
        r.input += tokens;
      } else {
        r.output += tokens;
        if (t.model) r.model = t.model;
      }
    }
  }
  const records = [...out.values()].filter((r) => r.requests > 0 || r.output > 0);
  for (const r of records) r.model ??= source === "claude" ? "claude.ai chat" : "chatgpt.com chat";
  return { source, records };
}
