import { describe, expect, it } from "vitest";
import { chatExportRecords, detectChatExport } from "./chatExport";

const claude = [
  {
    uuid: "c1",
    name: "Atlas map prompt",
    created_at: "2026-11-08T10:00:00Z",
    chat_messages: [
      { sender: "human", text: "x".repeat(400), content: [{ type: "text", text: "x".repeat(400) }], created_at: "2026-11-08T10:00:00Z" },
      { sender: "assistant", text: "y".repeat(800), content: [{ type: "text", text: "y".repeat(800) }], created_at: "2026-11-08T10:00:10Z" },
      { sender: "human", text: "z".repeat(40), content: [], created_at: "2026-11-08T11:00:00Z" },
    ],
  },
];

const chatgpt = [
  {
    title: "Codex prompt draft",
    create_time: 1762600000,
    mapping: {
      a: { message: null },
      b: { message: { author: { role: "system" }, content: { parts: ["sys"] }, create_time: 1762600000 } },
      c: { message: { author: { role: "user" }, content: { content_type: "text", parts: ["p".repeat(200)] }, create_time: 1762600001 } },
      d: { message: { author: { role: "assistant" }, content: { content_type: "text", parts: ["r".repeat(1000)] }, create_time: 1762600009, metadata: { model_slug: "gpt-6" } } },
    },
  },
];

describe("chat exports", () => {
  it("tells Claude and ChatGPT exports apart, and ignores usage files", () => {
    expect(detectChatExport(claude)).toBe("claude");
    expect(detectChatExport(chatgpt)).toBe("chatgpt");
    expect(detectChatExport([{ at: "2026-11-08", provider: "openai" }])).toBeNull();
    expect(detectChatExport({ records: [] })).toBeNull();
  });

  it("counts prompts and estimated tokens per conversation and day, with no text kept", () => {
    const res = chatExportRecords(claude, "conversations.json")!;
    expect(res.records).toHaveLength(1);
    expect(res.records[0]).toMatchObject({ agent: "Claude chat (estimated tokens)", provider: "anthropic", project: "Atlas map prompt", requests: 2, input: 110, output: 200, costUsd: null, costKind: "plan" });
    expect(JSON.stringify(res.records)).not.toMatch(/xxxx|yyyy/);
  });

  it("reads ChatGPT's tree of messages and its model", () => {
    const res = chatExportRecords(chatgpt, "conversations.json")!;
    expect(res.records[0]).toMatchObject({ agent: "ChatGPT chat (estimated tokens)", provider: "openai", model: "gpt-6", requests: 1, input: 50, output: 250 });
  });
});
