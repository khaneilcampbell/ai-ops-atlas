import { describe, expect, it } from "vitest";
import { checkStartInput, STARTABLE, startableByKey, startableByWorkflowId, startPath, validIdem } from "./startable";
import { availability, n8nRunUpdate, startAnswerToUpdate } from "../tasks/adapters";
import { KHANEIL } from "../tasks/types";

const career = startableByKey("career-job")!;
const idea = startableByKey("product-idea")!;

describe("the n8n start list", () => {
  it("is small, unique, and every key makes a plain webhook path", () => {
    expect(STARTABLE.length).toBeLessThanOrEqual(5);
    expect(new Set(STARTABLE.map((w) => w.key)).size).toBe(STARTABLE.length);
    expect(new Set(STARTABLE.map((w) => w.workflowId)).size).toBe(STARTABLE.length);
    for (const w of STARTABLE) {
      expect(w.key).toMatch(/^[a-z][a-z0-9-]{2,39}$/);
      expect(startPath(w)).toBe(`atlas-start-${w.key}`);
      expect(w.dailyCap).toBeGreaterThan(0);
      expect(w.dailyCap).toBeLessThanOrEqual(5);
      expect(w.never.length).toBeGreaterThan(10);
    }
    expect(startableByWorkflowId("Zd379gPsiCcBQfwo")?.key).toBe("career-job");
    expect(startableByWorkflowId("tGYMec2rp0twZFxv")).toBeUndefined();
  });

  it("checks the career input: an https link or a real description", () => {
    expect(checkStartInput(career, { job_url: "https://jobs.example.com/123", extra: "dropped" })).toEqual({ ok: true, input: { job_url: "https://jobs.example.com/123", job_text: "", company: "", role: "" } });
    expect(checkStartInput(career, { job_text: "x".repeat(250), company: " Acme " })).toMatchObject({ ok: true, input: { company: "Acme" } });
    expect(checkStartInput(career, { job_url: "http://jobs.example.com" }).ok).toBe(false);
    expect(checkStartInput(career, { job_url: "javascript:alert(1)" }).ok).toBe(false);
    expect(checkStartInput(career, { job_text: "short" }).ok).toBe(false);
    expect(checkStartInput(career, { job_text: "x".repeat(20001) }).ok).toBe(false);
    expect(checkStartInput(career, { job_url: 5 }).ok).toBe(false);
    expect(checkStartInput(career, "job").ok).toBe(false);
  });

  it("checks the product idea input: required fields, the two formats and the price range", () => {
    const good = { name: "Planner", product_type: "presentation", audience: "designers", price: "19" };
    expect(checkStartInput(idea, good)).toEqual({ ok: true, input: { name: "Planner", product_type: "presentation", audience: "designers", price: 19, notes: "" } });
    expect(checkStartInput(idea, { ...good, product_type: "Canva presentation" }).ok).toBe(false);
    expect(checkStartInput(idea, { ...good, price: 2 }).ok).toBe(false);
    expect(checkStartInput(idea, { ...good, price: "abc" }).ok).toBe(false);
    expect(checkStartInput(idea, { ...good, audience: "  " }).ok).toBe(false);
    expect(checkStartInput(idea, { ...good, name: "n".repeat(121) }).ok).toBe(false);
  });

  it("accepts only plain idempotency keys", () => {
    expect(validIdem("task_abc:2")).toBe(true);
    expect(validIdem("a b")).toBe(false);
    expect(validIdem("ab")).toBe(false);
  });
});

describe("n8n in the Task Center", () => {
  const attempt = { id: "r", number: 1, idempotencyKey: "t:1", state: "running" as const, executor: "n8n" as const, requestedAt: "2026-11-19T12:00:00Z", requestedBy: KHANEIL, externalId: "812", externalUrl: "https://n8n.example/x" };

  it("can start only workflows on the start list", () => {
    const a = availability({ workflow: { kind: "n8n", id: "Zd379gPsiCcBQfwo", label: "" } }, { desktop: true, agentsToken: false });
    expect(a).toMatchObject({ mode: "execute", executor: "n8n", startable: { key: "career-job" } });
    expect(availability({ workflow: { kind: "n8n", id: "Zd379gPsiCcBQfwo", label: "" } }, { desktop: false, agentsToken: false }).mode).toBe("execute");
    expect(availability({ workflow: { kind: "n8n", id: "iQdSJGMQi6TBHlar", label: "" } }, { desktop: true, agentsToken: true }).mode).toBe("read-only");
  });

  it("turns the site's answer into the attempt's state", () => {
    expect(startAnswerToUpdate({ state: "accepted", executionId: "812", executionUrl: "https://n8n.example/x" })).toEqual({ state: "running", externalId: "812", externalUrl: "https://n8n.example/x" });
    expect(startAnswerToUpdate({ state: "refused", error: "Daily cap." })).toEqual({ state: "failed", error: "Not started: Daily cap." });
    expect(startAnswerToUpdate({ state: "unknown", error: "Timeout." }).state).toBe("unknown");
  });

  it("follows the execution it started, and only that one", () => {
    const run = (id: string, status: "success" | "error" | "running" | "canceled") => ({ id, status, mode: "webhook", startedAt: null, stoppedAt: null });
    expect(n8nRunUpdate(attempt, [run("811", "success")])).toBeNull();
    expect(n8nRunUpdate(attempt, [run("812", "running")])).toBeNull();
    expect(n8nRunUpdate(attempt, [run("812", "success")])).toMatchObject({ state: "succeeded", externalId: "812" });
    expect(n8nRunUpdate(attempt, [run("812", "error")])).toMatchObject({ state: "failed" });
    expect(n8nRunUpdate(attempt, [run("812", "canceled")])).toMatchObject({ state: "cancelled" });
    expect(n8nRunUpdate({ ...attempt, externalId: undefined }, [run("812", "success")])).toBeNull();
  });
});
