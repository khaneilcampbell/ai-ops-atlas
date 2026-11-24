import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { unzipSync, strFromU8 } from "fflate";
import { n8nCode, engineForN8n, fingerprint } from "./build-n8n.mjs";

const require = createRequire(import.meta.url);
const { synthetic } = require("./fixtures/synthetic.cjs");

// Runs the workflow's Code nodes in order against synthetic read answers, with a stand-in for n8n's
// `$()` lookups. Nothing leaves the process.
function runNodes({ uploadStatus = () => 202, breakPdf = false } = {}) {
  const { agents, ctx } = synthetic();
  const code = n8nCode();
  const out = {};
  const item = (name) => ({ first: () => ({ json: out[name][0] }), all: () => out[name].map((json) => ({ json })), isExecuted: name in out, params: { jsCode: code[name] } });
  const $ = (name) => item(name);
  const run = (name, src) => { out[name] = new Function("$", "$execution", "$workflow", "Buffer", src)($, { id: "900", mode: "manual" }, { id: "WFDEMO" }, Buffer).map((i) => i.json); return out[name]; };
  out["Load Agents"] = [{ agents, due: agents.map((a) => a.id), isManual: true, fullRebuild: true, slotSource: "synthetic" }];
  out["Sheet Ready"] = [{ sheetId: "demo", sheetUrl: "https://example.invalid/sheet" }];
  const n8nPlan = [], n8nRes = [];
  for (const id of new Set(agents.flatMap((a) => a.n8n))) {
    const locked = ctx.n8nErr.has(id);
    n8nPlan.push({ kind: "workflow", id }); n8nRes.push(locked ? { statusCode: 401 } : { statusCode: 200, body: ctx.wf.get(id) });
    n8nPlan.push({ kind: "executions", id }); n8nRes.push(locked ? { statusCode: 401 } : { statusCode: 200, body: { data: ctx.execs.get(id) || [] } });
  }
  out["Plan n8n Reads"] = n8nPlan; out["Read n8n (read only)"] = n8nRes;
  out["Plan GitHub Reads"] = [{ kind: "runs", key: "demo/app/build.yml" }, { kind: "file", key: "demo/app/build.yml" }];
  out["Read GitHub (read only)"] = [{ statusCode: 200, body: { workflow_runs: ctx.ghRuns.get("demo/app/build.yml") } }, { statusCode: 200, body: { content: Buffer.from("on:\n  schedule:\n    - cron: '0 9 * * *'\n").toString("base64") } }];
  out["Read Atlas Records"] = [{ statusCode: 404, body: { message: "Not found" } }];
  run("Build Reports", breakPdf ? code["Build Reports"].replace("const p = buildPdf(cycle)", "const p = (() => { throw new Error('synthetic break'); })()") : code["Build Reports"]);
  const sent = run("Library Entry", code["Library Entry"]);
  out["Add to Atlas Library"] = sent.map((s) => { const st = uploadStatus(s.file); return st === 202 ? { statusCode: 202, body: { results: [{ outputId: "out_" + s.file }] } } : { statusCode: st, body: { message: "synthetic failure" } }; });
  run("Run Log Row", code["Run Log Row"]);
  return out;
}

describe("n8n Code nodes", () => {
  it("are the engine plus an adapter, with no export block and no network calls", () => {
    const code = n8nCode();
    expect(engineForN8n()).not.toContain("module.exports");
    for (const src of Object.values(code)) expect(src).not.toMatch(/httpRequest|fetch\(|require\(/);
    expect(Object.keys(code)).toEqual(["Build Reports", "Library Entry", "Run Log Row"]);
  });
  it("a hand run reports every agent and sends three cycle files plus one per agent, each on its own", () => {
    const out = runNodes();
    const code = n8nCode();
    const B = out["Build Reports"][0];
    expect(B.rows).toHaveLength(7);
    expect(B.cycle.counts.notConnected).toBe(1);
    expect(B.atlasNote).toMatch(/Not connected yet \(HTTP 404\)/);
    const agentIds = B.rows.map((r) => r.agent_id);
    expect(out["Library Entry"].map((x) => x.file)).toEqual(["pdf", "workbook", "csv", ...agentIds.map((id) => "agent:" + id)]);
    for (const x of out["Library Entry"]) expect(x.body.artifacts).toHaveLength(1);
    for (const x of out["Library Entry"]) expect(x.body.source.building).toBe("service:financial:financial-planning");
    expect(new Set(out["Library Entry"].map((x) => x.body.source.execution)).size).toBe(3 + agentIds.length);
    const perAgent = out["Library Entry"].filter((x) => x.file.startsWith("agent:"));
    expect(perAgent.map((x) => x.body.source.agent)).toEqual(agentIds);
    for (const x of perAgent) expect(x.body.artifacts[0]).toMatchObject({ outputKey: x.body.source.agent + ":work-report" });
    expect(perAgent.find((x) => x.body.source.agent === "on-request").body.artifacts[0].mime).toBe("application/pdf");
    expect(perAgent.find((x) => x.body.source.agent === "flaky-builder").body.artifacts[0].mime).toMatch(/spreadsheetml/);
    const wb = out["Library Entry"].find((x) => x.file === "workbook").body.artifacts[0];
    expect(wb).toMatchObject({ id: "atlas-agent-self-reports.xlsx", outputKey: "atlas-health-monitor:agent-self-reports-workbook" });
    expect(strFromU8(unzipSync(new Uint8Array(Buffer.from(wb.base64, "base64")))["xl/workbook.xml"])).toContain('name="Sources"');
    expect(out["Run Log Row"][0]).toMatchObject({ problems: "None", retry: "", engine: fingerprint(code["Build Reports"]) });
  });
  it("a failed upload keeps the others and logs a retry", () => {
    const out = runNodes({ uploadStatus: (f) => (f === "workbook" ? 500 : 202) });
    const log = out["Run Log Row"][0];
    expect(log.library).toMatch(/pdf added out_pdf; workbook failed \(500: synthetic failure\); csv added out_csv/);
    expect(log.problems).toContain("workbook failed");
    expect(log.retry).toMatch(/Execute workflow/);
  });
  it("a PDF that fails to build still sends the workbook and table", () => {
    const out = runNodes({ breakPdf: true });
    expect(out["Library Entry"].map((x) => x.file).slice(0, 2)).toEqual(["workbook", "csv"]);
    expect(out["Library Entry"]).toHaveLength(2 + 7);
    expect(out["Run Log Row"][0].problems).toMatch(/PDF not built: synthetic break/);
  });
  it("carries no credentials into what it sends", () => {
    const out = runNodes();
    const text = JSON.stringify(out["Library Entry"].map((x) => ({ ...x, body: { ...x.body, artifacts: x.body.artifacts.map((a) => ({ ...a, base64: undefined })) } })));
    expect(text).not.toMatch(/Bearer|token|password|secret/i);
  });
});
