// TEST ONLY. A deterministic stand-in for n8n, used by server/executive/executive.test.ts and the
// local preview script. Never imported by a Pages function: nothing here reaches production, and a
// report it builds is labelled as a development example, never real research.

import type { DispatchEnvelope, ResultBody, WorkflowRoute } from "../../src/executive/control/contracts";
import { REPORT_SECTIONS } from "../../src/executive/control/types";
import type { DispatchAnswer, ExecutionAdapter } from "./engine";

export interface MockAdapter extends ExecutionAdapter {
  sent: DispatchEnvelope[];
  /** What the next dispatch answers (default accepted). */
  next: DispatchAnswer[];
}

export function mockAdapter(configured = true): MockAdapter {
  const m: MockAdapter = {
    name: "mock-n8n",
    configured,
    sent: [],
    next: [],
    async dispatch(_route: WorkflowRoute, envelope: DispatchEnvelope) {
      m.sent.push(envelope);
      return m.next.shift() ?? { state: "accepted" };
    },
  };
  return m;
}

export const SAMPLE_URLS = ["https://example.org/dev-sample/market-1", "https://example.org/dev-sample/market-2", "https://example.org/dev-sample/competitor-1", "https://example.org/dev-sample/feasibility-1"];

/** A well-formed development example report (not research). */
export function sampleReport(): Record<string, unknown> {
  const text = (k: string) => `Development example for ${k}: this text exists only to exercise Atlas's checks and is not a research finding of any kind.`;
  const sections = Object.fromEntries(REPORT_SECTIONS.map((k) => [k, { text: text(k), sources: k === "competitorOverview" ? ["S3"] : k === "marketEvidence" ? ["S1", "S2"] : [] }]));
  return {
    schema: "opportunity-report/1",
    productName: "Development example (not research)",
    sections,
    sources: SAMPLE_URLS.map((url, i) => ({ id: `S${i + 1}`, title: `Development sample ${i + 1}`, url })),
  };
}

/** The result body n8n would post for a dispatch. */
export function resultFor(e: DispatchEnvelope, over: Partial<ResultBody> = {}): ResultBody {
  return {
    contract: "ATLAS_WORKFLOW_RESULT",
    version: 1,
    eventId: `${e.idempotencyKey}:exec-1`,
    taskId: e.taskId,
    attempt: e.attempt,
    correlationId: e.correlationId,
    idempotencyKey: e.idempotencyKey,
    nonce: e.nonce,
    executionId: "1",
    kind: "succeeded",
    report: sampleReport(),
    searched: SAMPLE_URLS,
    usage: { model: "claude-sonnet-5-5", inputTokens: 40_000, outputTokens: 3_000, webSearches: 4 },
    at: "2026-11-22T12:00:00.000Z",
    ...over,
  };
}
