import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import type { D1, D1Statement } from "./live";
import { handle } from "./middleware";
import { ATTEMPTS_PER_CALL, receiveOutputs, routeOutputs, routeOutputsForApp, type Bucket, type OutputsEnv } from "./outputs";
import { receiveReport } from "./reports";
import { MAX_STORAGE_ATTEMPTS, type ListPage, type OutputDetail } from "../src/library/model";

/** D1 on a real in-memory SQLite, so the SQL itself is tested. */
function sqliteD1(): D1 {
  const db = new DatabaseSync(":memory:");
  const stmt = (sql: string, args: unknown[] = []): D1Statement => ({
    bind: (...a) => stmt(sql, a),
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...(args as never[])).changes) } }),
    all: async <T,>() => ({ results: db.prepare(sql).all(...(args as never[])) as T[] }),
  });
  return { prepare: (sql) => stmt(sql), batch: async (s) => Promise.all(s.map((x) => x.run())) };
}

/** An R2 stand-in: real bytes in a Map, with switchable failures and an optional corrupting read. */
function memoryBucket() {
  const objects = new Map<string, Uint8Array>();
  const ctl = { failPuts: 0, puts: 0, gets: 0, corruptReads: false, failReads: false };
  const bucket: Bucket = {
    async put(key, value, options) {
      ctl.puts++;
      if (ctl.failPuts > 0) {
        ctl.failPuts--;
        throw new Error("R2 is unavailable (503)");
      }
      if (options?.sha256 && createHash("sha256").update(value).digest("hex") !== options.sha256) throw new Error("checksum mismatch");
      objects.set(key, value.slice());
    },
    async get(key, options) {
      ctl.gets++;
      if (ctl.failReads) throw new Error("read timed out");
      const v = objects.get(key);
      if (!v) return null;
      let bytes = options?.range ? v.slice(options.range.offset, options.range.offset + options.range.length) : v.slice();
      if (ctl.corruptReads) bytes = new Uint8Array([...bytes, 1]);
      return { body: new Response(bytes).body!, size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer };
    },
  };
  return { bucket, objects, ctl };
}

const TOKEN = "f".repeat(43);
const SYNC = "s".repeat(43);
const noSleep = { sleep: async () => {}, now: () => Date.parse("2026-11-19T10:00:00Z") };
const csv = "name,score\nAcme,9\n\"Smith, J\",7\n";

function setup(withBucket = true) {
  const store = memoryBucket();
  const env: OutputsEnv = { LIVE: sqliteD1(), AGENT_FEED_TOKEN: TOKEN, USAGE_SYNC_TOKEN: SYNC, ...(withBucket ? { OUTPUTS: store.bucket } : {}) };
  return { env, ...store };
}

const body = (over: Record<string, unknown> = {}, artifacts?: unknown[]) => ({
  source: { agent: "benjaire-product-lab", execution: "n8n-exec-4812", workflow: "product-lab-weekly", task: "task_77", runUrl: "https://n8n.example/execution/4812", project: "benjaire", via: "n8n", ...over },
  artifacts: artifacts ?? [
    { id: "scores.csv", title: "Product scores", mime: "text/csv", text: csv, summary: "Scores for this week's ideas", requiresApproval: true },
    { id: "cover.png", title: "Cover image", mime: "image/png", base64: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2]).toString("base64") },
  ],
});

const hook = (b: unknown, token = TOKEN) =>
  new Request("https://atlas.example/api/hooks/outputs", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(b) });
const api = (path: string, method = "GET") => new Request(`https://atlas.example/api/outputs${path}`, { method });

async function list(env: OutputsEnv, qs = ""): Promise<ListPage> {
  return (await routeOutputs(api(qs ? `?${qs}` : ""), env)).json();
}

describe("Output Library ingestion", () => {
  it("stores a real file, lists it, previews it and downloads the same bytes", async () => {
    const { env, objects } = setup();
    const res = await receiveOutputs(hook(body()), env, noSleep);
    expect(res.status).toBe(202);
    const out = await res.json();
    expect(out.missingFiles).toBe(0);
    expect(out.results.map((r: { storage: string; verified: boolean }) => [r.storage, r.verified])).toEqual([["saved", true], ["saved", true]]);
    expect(objects.size).toBe(2);

    const page = await list(env);
    expect(page.total).toBe(2);
    const scores = page.outputs.find((o) => o.latest.title === "Product scores")!;
    expect(scores.latest).toMatchObject({
      format: "spreadsheet", agent: "benjaire-product-lab", task: "task_77", workflow: "product-lab-weekly", execution: "n8n-exec-4812",
      runUrl: "https://n8n.example/execution/4812", project: "benjaire", storage: "saved", approval: "awaiting", version: 1,
    });
    expect(scores.latest.verifiedAt).toBe("2026-11-19T10:00:00.000Z");

    const preview = await routeOutputs(api(`/${scores.id}/versions/1/file?preview=1`), env);
    expect(preview.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await preview.text()).toBe(csv);

    const dl = await routeOutputs(api(`/${scores.id}/versions/1/file?download=1`), env);
    expect(dl.headers.get("content-disposition")).toMatch(/^attachment; filename="Product scores.csv"/);
    const bytes = new Uint8Array(await dl.arrayBuffer());
    const sum = createHash("sha256").update(bytes).digest("hex");
    expect(sum).toBe(createHash("sha256").update(csv).digest("hex"));
    expect(dl.headers.get("x-atlas-sha256")).toBe(sum);
  });

  it("repeating the same execution makes no duplicate, a new execution adds a version", async () => {
    const { env, objects, ctl } = setup();
    await receiveOutputs(hook(body()), env, noSleep);
    const putsBefore = ctl.puts;
    const again = await (await receiveOutputs(hook(body()), env, noSleep)).json();
    expect(again.results.every((r: { duplicate: boolean }) => r.duplicate)).toBe(true);
    expect(ctl.puts).toBe(putsBefore);
    expect((await list(env)).total).toBe(2);

    const next = body({ execution: "n8n-exec-4900" }, [{ id: "scores.csv", title: "Product scores", mime: "text/csv", text: csv + "Zeta,3\n" }]);
    expect((await (await receiveOutputs(hook(next), env, noSleep)).json()).results[0]).toMatchObject({ version: 2, storage: "saved" });
    const page = await list(env, "format=spreadsheet");
    expect(page.outputs[0].versions).toBe(2);
    const detail: OutputDetail = await (await routeOutputs(api(`/${page.outputs[0].id}`), env)).json();
    expect(detail.history.map((v) => [v.version, v.execution])).toEqual([[2, "n8n-exec-4900"], [1, "n8n-exec-4812"]]);
    // Version 1 is untouched: its own stored object still holds the original bytes.
    expect(await (await routeOutputs(api(`/${page.outputs[0].id}/versions/1/file`), env)).text()).toBe(csv);
    expect(objects.size).toBe(3);
  });

  it("retries storage within limits, keeps failures visible, and recovers on a later send", async () => {
    const { env, ctl } = setup();
    ctl.failPuts = 100;
    const first = await (await receiveOutputs(hook(body({}, [{ id: "a.txt", title: "Notes", mime: "text/plain", text: "hello" }])), env, noSleep)).json();
    expect(first.missingFiles).toBe(1);
    expect(first.results[0]).toMatchObject({ storage: "failed", verified: false });
    expect(ctl.puts).toBe(ATTEMPTS_PER_CALL);
    let v = (await list(env)).outputs[0].latest;
    expect(v).toMatchObject({ storage: "failed", storageAttempts: ATTEMPTS_PER_CALL, verifiedAt: null });
    expect(v.storageError).toMatch(/R2 is unavailable/);
    expect((await routeOutputs(api(`/${(await list(env)).outputs[0].id}/versions/1/file`), env)).status).toBe(409);

    // The workflow sends again (same execution): the same version is retried, capped at the limit.
    await receiveOutputs(hook(body({}, [{ id: "a.txt", title: "Notes", mime: "text/plain", text: "hello" }])), env, noSleep);
    expect(ctl.puts).toBe(MAX_STORAGE_ATTEMPTS);
    const capped = await (await receiveOutputs(hook(body({}, [{ id: "a.txt", title: "Notes", mime: "text/plain", text: "hello" }])), env, noSleep)).json();
    expect(capped.results[0].message).toMatch(/retry limit/);
    expect(ctl.puts).toBe(MAX_STORAGE_ATTEMPTS);
    expect((await list(env)).total).toBe(1);

    // A transient failure that clears within the call ends saved and verified.
    const { env: env2, ctl: ctl2 } = setup();
    ctl2.failPuts = 1;
    const ok = await (await receiveOutputs(hook(body({}, [{ id: "b.txt", title: "Notes", mime: "text/plain", text: "hi" }])), env2, noSleep)).json();
    expect(ok.results[0]).toMatchObject({ storage: "saved", verified: true });
    v = (await list(env2)).outputs[0].latest;
    expect(v.storageAttempts).toBe(2);
  });

  it("never marks retrieval verified without a matching read", async () => {
    const corrupt = setup();
    corrupt.ctl.corruptReads = true;
    const r = await (await receiveOutputs(hook(body({}, [{ id: "c.txt", title: "C", mime: "text/plain", text: "abc" }])), corrupt.env, noSleep)).json();
    expect(r.results[0]).toMatchObject({ storage: "failed", verified: false });

    const unreadable = setup();
    unreadable.ctl.failReads = true;
    const u = await (await receiveOutputs(hook(body({}, [{ id: "d.txt", title: "D", mime: "text/plain", text: "abc" }])), unreadable.env, noSleep)).json();
    expect(u.results[0]).toMatchObject({ storage: "saved", verified: false });
    expect((await list(unreadable.env)).outputs[0].latest.verifiedAt).toBeNull();
  });

  it("records the deliverable as missing when storage isn't connected, and saves it once it is", async () => {
    const { env, bucket } = setup(false);
    const r = await (await receiveOutputs(hook(body({}, [{ id: "e.txt", title: "E", mime: "text/plain", text: "abc" }])), env, noSleep)).json();
    expect(r.results[0].storage).toBe("failed");
    const page = await list(env);
    expect(page.storageConnected).toBe(false);
    expect(page.outputs[0].latest).toMatchObject({ storage: "failed", storageAttempts: 0 });
    expect(page.outputs[0].latest.storageError).toMatch(/OUTPUTS/);
    env.OUTPUTS = bucket;
    const later = await (await receiveOutputs(hook(body({}, [{ id: "e.txt", title: "E", mime: "text/plain", text: "abc" }])), env, noSleep)).json();
    expect(later.results[0]).toMatchObject({ storage: "saved", verified: true, version: 1 });
  });

  it("refuses bad keys and bad bodies", async () => {
    const { env } = setup();
    expect((await receiveOutputs(hook(body(), "wrong"), env, noSleep)).status).toBe(401);
    expect((await receiveOutputs(hook(body(), SYNC), env, noSleep)).status).toBe(401);
    expect((await receiveOutputs(hook({ source: { agent: "x" }, artifacts: [] }), env, noSleep)).status).toBe(400);
    expect((await receiveOutputs(hook(body({}, [{ id: "x", title: "X", mime: "text/plain", text: "a", base64: "YQ==" }])), env, noSleep)).status).toBe(400);
    expect((await receiveOutputs(hook(body({ runUrl: "javascript:alert(1)" })), env, noSleep)).status).toBe(400);
  });
});

describe("Output Library access and safe display", () => {
  it("the ingest key can't read, and /api/outputs needs a Cloudflare Access session", async () => {
    const { env } = setup();
    await receiveOutputs(hook(body()), env, noSleep);
    const id = (await list(env)).outputs[0].id;
    // Through the real middleware with Access configured and no session: refused before the route runs.
    const next = vi.fn(async () => routeOutputs(api(`/${id}/versions/1/file`), env));
    for (const path of ["/api/outputs", `/api/outputs/${id}`, `/api/outputs/${id}/versions/1/file?download=1`]) {
      const req = new Request(`https://atlas.example${path}`, { headers: { authorization: `Bearer ${TOKEN}` } });
      const res = await handle({ request: req, env: { ACCESS_TEAM_DOMAIN: "https://t.cloudflareaccess.com", ACCESS_AUD: "aud" }, next }, () => {});
      expect(res.status).toBe(401);
    }
    expect(next).not.toHaveBeenCalled();
    // The hook route itself is add-only: functions/api/hooks/outputs.ts answers anything but POST with 405.
    const fn = await import("../functions/api/hooks/outputs");
    expect(fn.onRequest().status).toBe(405);
    expect(readFileSync(new URL("../functions/api/hooks/outputs.ts", import.meta.url), "utf8")).not.toMatch(/onRequestGet/);
  });

  it("the Mac app reads with its website sync key only, and can't change anything", async () => {
    const { env } = setup();
    await receiveOutputs(hook(body()), env, noSleep);
    const id = (await list(env)).outputs.find((o) => o.latest.title === "Product scores")!.id;
    const app = (path: string, token: string | null = SYNC, method = "GET") =>
      routeOutputsForApp(new Request(`https://atlas.example/api/hooks/library${path}`, { method, headers: token ? { authorization: `Bearer ${token}` } : {} }), env);

    const page: ListPage = await (await app("?format=spreadsheet")).json();
    expect(page.outputs.map((o) => o.latest.title)).toEqual(["Product scores"]);
    const detail: OutputDetail = await (await app(`/${id}`)).json();
    expect(detail.history).toHaveLength(1);
    const file = await app(`/${id}/versions/1/file?download=1`);
    expect(file.headers.get("content-disposition")).toMatch(/^attachment/);
    expect(await file.text()).toBe(csv);

    // Only the sync key opens it: not the add-only agent key, not no key.
    expect((await app("", TOKEN)).status).toBe(401);
    expect((await app("", null)).status).toBe(401);
    // Read-only: reconcile and retry exist only on the signed-in page.
    expect((await app("/reconcile", SYNC, "POST")).status).toBe(405);
    expect((await app(`/${id}/versions/1/retry`, SYNC, "POST")).status).toBe(405);
    expect((await app("/reconcile")).status).toBe(404);
    expect((await app(`/${id}/versions/1/retry`)).status).toBe(404);
    // Without the site's sync key set, it says so instead of opening.
    expect((await routeOutputsForApp(new Request("https://atlas.example/api/hooks/library", { headers: { authorization: `Bearer ${SYNC}` } }), { ...env, USAGE_SYNC_TOKEN: undefined })).status).toBe(503);
    const fn = await import("../functions/api/hooks/library/[[path]]");
    expect(fn.onRequest().status).toBe(405);
  });

  it("serves untrusted content inert: HTML and SVG download, text is plain, everything sandboxed", async () => {
    const { env } = setup();
    const files = [
      { id: "page.html", title: "Page", mime: "text/html", text: "<script>alert(1)</script>" },
      { id: "logo.svg", title: "Logo", mime: "image/svg+xml", text: "<svg onload=alert(1)></svg>" },
      { id: "notes.md", title: "Notes", mime: "text/markdown", text: "# hi <img src=x onerror=alert(1)>" },
    ];
    await receiveOutputs(hook(body({}, files)), env, noSleep);
    const page = await list(env);
    const get = async (title: string, qs = "") => routeOutputs(api(`/${page.outputs.find((o) => o.latest.title === title)!.id}/versions/1/file${qs}`), env);
    for (const t of ["Page", "Logo"]) {
      const r = await get(t);
      expect(r.headers.get("content-type")).toBe("application/octet-stream");
      expect(r.headers.get("content-disposition")).toMatch(/^attachment/);
    }
    const md = await get("Notes", "?preview=1");
    expect(md.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(md.headers.get("content-security-policy")).toMatch(/sandbox/);
    expect(md.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("search, filters and pagination", async () => {
    const { env } = setup();
    const many = Array.from({ length: 23 }, (_, i) => ({ id: `r${i}.txt`, title: `Daily note ${i}`, mime: "text/plain", text: i === 5 ? "mentions zanzibar" : "plain" }));
    for (let i = 0; i < 23; i += 10) await receiveOutputs(hook(body({ execution: `exec-${i}` }, many.slice(i, i + 10))), env, noSleep);
    await receiveOutputs(hook(body({ agent: "github-opportunity-scout", execution: "run-1", project: "ai-ops-atlas" }, [{ id: "x.json", title: "Scout data", mime: "application/json", text: "{}" }])), env, noSleep);
    expect((await list(env)).outputs).toHaveLength(20);
    expect((await list(env, "page=2")).outputs).toHaveLength(4);
    expect((await list(env, "q=zanzibar")).outputs.map((o) => o.latest.title)).toEqual(["Daily note 5"]);
    expect((await list(env, "q=task_77")).total).toBe(24);
    expect((await list(env, "q=task%2577")).total).toBe(0);
    expect((await list(env, "q=100%25")).total).toBe(0);
    expect((await list(env, "agent=github-opportunity-scout")).total).toBe(1);
    expect((await list(env, "format=data")).total).toBe(1);
    expect((await list(env, "project=other&projectAgents=github-opportunity-scout")).total).toBe(1);
    expect((await list(env, "storage=failed")).total).toBe(0);
    expect((await list(env, "approval=awaiting")).total).toBe(0);
    expect((await list(env)).facets.agents).toEqual(["benjaire-product-lab", "github-opportunity-scout"]);
  });
});

describe("Agent reports are captured automatically", () => {
  const report = () => JSON.parse(readFileSync(new URL("../ops/opportunity-scout/fixtures/report.json", import.meta.url), "utf8"));
  const post = (b: unknown) => new Request("https://atlas.example/api/hooks/reports", { method: "POST", headers: { authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(b) });

  it("archives a stored report, reconciles idempotently, and can rebuild a failed one", async () => {
    const { env, ctl } = setup();
    ctl.failPuts = 100;
    const res = await (await receiveReport(post(report()), env)).json();
    expect(res.stored).toBe(1);
    expect(res.library.storage).toBe("failed");
    const page = await list(env);
    expect(page.outputs[0].latest).toMatchObject({ agent: "github-opportunity-scout", format: "report", via: "agent_report", storage: "failed" });

    ctl.failPuts = 0;
    const retried = await routeOutputs(api(`/${page.outputs[0].id}/versions/1/retry`, "POST"), env, noSleep);
    expect(retried.status).toBe(200);
    expect(await retried.json()).toMatchObject({ storage: "saved", verified: true });

    const rec = await (await routeOutputs(api("/reconcile", "POST"), env, noSleep)).json();
    expect(rec).toMatchObject({ seen: 1, duplicates: 1, created: 0 });
    expect((await list(env)).total).toBe(1);
  });

  it("a non-report version can't be rebuilt by Atlas and says so", async () => {
    const { env, ctl } = setup();
    ctl.failPuts = 100;
    await receiveOutputs(hook(body({}, [{ id: "a.txt", title: "A", mime: "text/plain", text: "a" }])), env, noSleep);
    const id = (await list(env)).outputs[0].id;
    const r = await routeOutputs(api(`/${id}/versions/1/retry`, "POST"), env, noSleep);
    expect(r.status).toBe(409);
  });
});
