import { describe, expect, it } from "vitest";
import { refreshRegistry, refreshRegistryForApp, webhookOf } from "./registryRefresh";
import type { CheckCache } from "./properties";
import { cooldownLeft, viewOf } from "../src/n8n/registryRefresh";

const HOOK = "https://khancam15.app.n8n.cloud/webhook/atlas-registry-refresh-test";
const SYNC = "s".repeat(43);
const NOW = Date.parse("2026-11-12T14:00:00Z");

const memCache = (): CheckCache => {
  const m = new Map<string, unknown>();
  return { get: async (k) => m.get(k) ?? null, put: async (k, v) => void m.set(k, v) };
};

function fakeFetch(status = 200) {
  const calls: { url: string; method: string }[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method ?? "GET" });
    return new Response(null, { status });
  }) as typeof fetch;
  return { f, calls };
}

describe("registry refresh on the site", () => {
  it("only accepts an https webhook on the n8n instance", () => {
    expect(webhookOf({ N8N_REGISTRY_WEBHOOK_URL: HOOK })).toBe(HOOK);
    expect(webhookOf({ N8N_REGISTRY_WEBHOOK_URL: "https://evil.example/webhook/x" })).toBeNull();
    expect(webhookOf({ N8N_REGISTRY_WEBHOOK_URL: "https://khancam15.app.n8n.cloud/api/v1/workflows" })).toBeNull();
    expect(webhookOf({ N8N_REGISTRY_WEBHOOK_URL: "not a url" })).toBeNull();
    expect(webhookOf({})).toBeNull();
  });

  it("says honestly when the webhook isn't set, without calling anything", async () => {
    const { f, calls } = fakeFetch();
    const r = await refreshRegistry({}, memCache(), f, NOW);
    expect(r.status).toBe(503);
    expect(await r.json()).toMatchObject({ state: "not-configured" });
    expect(calls).toHaveLength(0);
  });

  it("runs the workflow with one POST and reports done", async () => {
    const { f, calls } = fakeFetch();
    const r = await refreshRegistry({ N8N_REGISTRY_WEBHOOK_URL: HOOK }, memCache(), f, NOW);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ state: "done" });
    expect(calls).toEqual([{ url: HOOK, method: "POST" }]);
  });

  it("allows one run per minute, even when the first one failed", async () => {
    const cache = memCache();
    const { f, calls } = fakeFetch(500);
    const first = await refreshRegistry({ N8N_REGISTRY_WEBHOOK_URL: HOOK }, cache, f, NOW);
    expect(first.status).toBe(502);
    expect(await first.json()).toMatchObject({ state: "failed" });
    const again = await refreshRegistry({ N8N_REGISTRY_WEBHOOK_URL: HOOK }, cache, f, NOW + 20_000);
    expect(again.status).toBe(429);
    expect(await again.json()).toMatchObject({ state: "cooldown", retryAfterSec: 40 });
    expect(calls).toHaveLength(1);
    expect((await refreshRegistry({ N8N_REGISTRY_WEBHOOK_URL: HOOK }, cache, f, NOW + 61_000)).status).toBe(502);
    expect(calls).toHaveLength(2);
  });

  it("explains an unknown webhook", async () => {
    const r = await refreshRegistry({ N8N_REGISTRY_WEBHOOK_URL: HOOK }, memCache(), fakeFetch(404).f, NOW);
    expect((await r.json()).message).toMatch(/doesn't know the refresh webhook/);
  });

  it("needs the sync key on the Mac app route", async () => {
    const env = { N8N_REGISTRY_WEBHOOK_URL: HOOK, USAGE_SYNC_TOKEN: SYNC };
    const { f, calls } = fakeFetch();
    const bad = await refreshRegistryForApp(new Request("https://x/api/hooks/registry-refresh", { method: "POST", headers: { authorization: "Bearer wrong" } }), env, memCache(), f);
    expect(bad.status).toBe(401);
    expect(calls).toHaveLength(0);
    const ok = await refreshRegistryForApp(new Request("https://x/api/hooks/registry-refresh", { method: "POST", headers: { authorization: `Bearer ${SYNC}` } }), env, memCache(), f);
    expect(ok.status).toBe(200);
  });
});

describe("registry refresh button", () => {
  it("counts the cooldown down from the last press", () => {
    expect(cooldownLeft(null, NOW)).toBe(0);
    expect(cooldownLeft(NOW, NOW + 1)).toBe(60);
    expect(cooldownLeft(NOW, NOW + 59_500)).toBe(1);
    expect(cooldownLeft(NOW, NOW + 60_000)).toBe(0);
  });

  it("shows done with its time, and any refusal as failed with the reason", () => {
    expect(viewOf({ state: "done", finishedAt: "2026-11-12T14:00:12Z" }, NOW)).toEqual({ state: "done", finishedAt: "2026-11-12T14:00:12Z" });
    expect(viewOf({ state: "cooldown", message: "wait", retryAfterSec: 3 }, NOW)).toEqual({ state: "failed", message: "wait", at: NOW });
    expect(viewOf({ state: "not-configured", message: "no url" }, NOW)).toMatchObject({ state: "failed", message: "no url" });
  });
});
