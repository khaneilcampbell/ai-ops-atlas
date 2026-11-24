import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { unzipSync, strFromU8 } from "fflate";

const require = createRequire(import.meta.url);
const E = require("./engine.cjs");
const { synthetic, NOW } = require("./fixtures/synthetic.cjs");

const cycleOf = (over, opts) => {
  const { agents, ctx } = synthetic(over);
  return E.buildCycle(agents, ctx, opts);
};
const rowOf = (c, id) => c.agents.find((r) => r.agent_id === id);
const recsOf = (c, id) => c.recs.filter((r) => r.agent_id === id).map((r) => r.rule);

describe("every agent gets a report", () => {
  it("one row per catalog agent, including idle, unlinked and unreadable ones", () => {
    const { agents } = synthetic();
    const c = cycleOf();
    expect(c.agents.map((r) => r.agent_id)).toEqual(agents.map((a) => a.id));
    for (const r of c.agents) for (const k of ["catalog_status", "live_state", "data_state", "runs_seen", "last_run", "budget", "stale_flags", "memory_service"]) expect(String(r[k]).length, `${r.agent_id}.${k}`).toBeGreaterThan(0);
  });
  it("works with no agents and no runs at all", () => {
    const c = cycleOf((agents) => ({ agents: [] }));
    expect(c.counts).toMatchObject({ agents: 0, runs: 0, recs: 0, successRate: null });
    expect(E.buildPdf(c).pages).toBeGreaterThan(0);
    expect(E.buildXlsx(E.workbookSheets(c)).length).toBeGreaterThan(0);
  });
});

describe("metrics", () => {
  it("counts runs, success rate over finished runs, median and longest", () => {
    const c = cycleOf();
    const s = rowOf(c, "steady-scheduler");
    expect(s).toMatchObject({ runs_total: 8, succeeded: 8, failed: 0, success_rate: "100%", scheduled_runs: 8, manual_runs: 0, longest_duration: "15 min", live_state: "Scheduled" });
    expect(s.median_duration).toBe("44 s");
    expect(s.schedules_et).toBe("Steady report: 07:00");
    const f = rowOf(c, "flaky-builder");
    expect(f).toMatchObject({ runs_total: 4, succeeded: 2, failed: 2, success_rate: "50%", event_runs: 2, scheduled_runs: 2 });
    expect(f.last_failure).toMatch(/^23 Nov, 9:00 AM · GitHub build\.yml$/);
    expect(f.schedules_et).toContain("04:00"); // 09:00 UTC cron in New York
  });
  it("a running run is neither a success nor a failure", () => {
    const c = cycleOf((agents, ctx) => { ctx.execs.get("wfManual01").push({ startedAt: new Date(NOW - 60000).toISOString(), status: "running", mode: "manual" }); });
    const g = rowOf(c, "hand-runner");
    expect(g).toMatchObject({ runs_total: 7, succeeded: 6, failed: 0, other: 1, success_rate: "100%" });
  });
  it("names the busiest hours in New York time", () => {
    expect(rowOf(cycleOf(), "steady-scheduler").busiest_hours_et).toBe("7 AM (8)");
  });
});

describe("missing, unconnected and stale data are never zero", () => {
  const c = cycleOf();
  it("no workflow linked is 'No data', with blank numbers", () => {
    const r = rowOf(c, "on-request");
    expect(r).toMatchObject({ data_state: "No data", runs_seen: E.NO_DATA, runs_total: "", succeeded: "", failed: "", success_rate: "No data", last_run: "No data" });
  });
  it("an unreadable source is 'Not connected', with blank numbers", () => {
    const r = rowOf(c, "unreachable");
    expect(r).toMatchObject({ data_state: "Not connected", live_state: "Not connected", runs_total: "", failed: "", last_failure: "Not connected" });
    expect(r.runs_seen).toContain("HTTP 401");
  });
  it("read with nothing in the window is '0 runs', and flagged as unproven", () => {
    const r = rowOf(c, "quiet-watcher");
    expect(r).toMatchObject({ data_state: "Read", runs_total: 0, success_rate: "No runs in the window" });
    expect(r.stale_flags).toContain("health unknown, not proven");
    expect(r.stale_flags).toContain("no failures seen does not mean healthy");
  });
  it("Atlas memory not connected says so instead of 0", () => {
    expect(rowOf(c, "steady-scheduler")).toMatchObject({ atlas_runs: "Not connected", atlas_memory_items: "Not connected" });
  });
  it("Atlas memory connected shows counts across the agent and what it owns", () => {
    const d = cycleOf((agents, ctx) => { ctx.atlas = { connected: true, note: "Connected", by: new Map([["hand-runner", { runs: 2, memoryItems: 1 }], ["hand-runner-sync", { runs: 3, memoryItems: 0 }]]) }; });
    expect(rowOf(d, "hand-runner")).toMatchObject({ atlas_runs: 5, atlas_memory_items: 1, memory_service: "Connected" });
    expect(recsOf(d, "steady-scheduler")).toContain("memory-empty");
    expect(recsOf(d, "hand-runner")).not.toContain("memory-empty");
  });
  it("budget the catalog does not state is 'Not documented'", () => {
    expect(rowOf(c, "flaky-builder").budget).toBe("Not documented");
    expect(rowOf(c, "steady-scheduler").budget).toBe("$5 a month cap");
  });
  it("a last run over a week old is a stale warning", () => {
    const d = cycleOf((agents, ctx) => { ctx.execs.set("wfSteady01", [{ startedAt: new Date(NOW - 9 * 86400000).toISOString(), stoppedAt: new Date(NOW - 9 * 86400000 + 5000).toISOString(), status: "success", mode: "trigger" }]); });
    expect(rowOf(d, "steady-scheduler").stale_flags).toMatch(/over 7 days ago/);
    expect(recsOf(d, "steady-scheduler")).toContain("active-but-quiet");
  });
  it("a GitHub list cut at one page says so instead of claiming 30 days", () => {
    const d = cycleOf((agents, ctx) => { ctx.ghTotal = new Map([["demo/app/build.yml", 240]]); });
    const r = rowOf(d, "flaky-builder");
    expect(r.window).toContain("newest runs only: build.yml (newest 4 of 240)");
    expect(r.stale_flags).toContain("less than 30 days");
    expect(d.sources.find((s) => s.source === "GitHub Actions").note).toContain("1 cut short");
  });
  it("each source states its window, retention and availability", () => {
    const by = Object.fromEntries(c.sources.map((s) => [s.source, s]));
    expect(by["n8n executions"]).toMatchObject({ coverage: "16 Nov 2026 to 23 Nov 2026", availability: "Partly available (1 of 5 not read)" });
    expect(by["n8n executions"].retention).toMatch(/About 7 days/);
    expect(by["GitHub Actions"]).toMatchObject({ coverage: "24 Oct 2026 to 23 Nov 2026", availability: "Available" });
    expect(by["Atlas records (memory service)"]).toMatchObject({ availability: "Not connected", coverage: "None" });
    for (const s of c.sources) expect(s.collected_at).toBe(new Date(NOW).toISOString());
  });
});

describe("recommendation rules", () => {
  const c = cycleOf();
  it("fires exactly the rule each synthetic agent is built for", () => {
    expect(recsOf(c, "steady-scheduler")).toEqual(["slow-run"]);
    expect(recsOf(c, "flaky-builder")).toEqual(["failed-runs"]);
    expect(recsOf(c, "quiet-watcher")).toEqual(["successes-not-kept", "active-but-quiet"]);
    expect(recsOf(c, "on-request")).toEqual(["no-workflow"]);
    expect(recsOf(c, "unreachable")).toEqual(["source-unavailable"]);
    expect(recsOf(c, "draft-keeper")).toEqual(["drafts-as-operational"]);
    expect(recsOf(c, "hand-runner")).toEqual(["mostly-manual"]);
  });
  it("every recommendation cites its rule, condition and evidence, and is only a suggestion", () => {
    const ids = new Set(E.RULES.map((r) => r.id));
    for (const r of c.recs) {
      expect(ids.has(r.rule)).toBe(true);
      expect(r.condition).toBe(E.RULES.find((x) => x.id === r.rule).condition);
      expect(r.evidence.length).toBeGreaterThan(5);
      expect(r.review_status).toBe(E.REVIEW_STATUS);
      expect(["High", "Medium", "Low"]).toContain(r.priority);
    }
  });
  it("failures are high priority when the latest run failed", () => {
    expect(c.recs.find((r) => r.rule === "failed-runs").priority).toBe("High");
  });
  it("an idle agent with no runs is not told to fix its trigger", () => {
    const d = cycleOf((agents) => { agents.find((a) => a.id === "quiet-watcher").status = "idle"; });
    expect(recsOf(d, "quiet-watcher")).toEqual(["successes-not-kept"]);
  });
});

describe("report times", () => {
  it("never puts two agents in one slot, and the most-run agent picks first", () => {
    const { agents, ctx } = synthetic();
    const c = E.buildCycle(agents.map((a) => ({ ...a, slot: "" })), ctx, { pick: true });
    const times = c.schedule.map((s) => s.reports_at_et);
    expect(new Set(times).size).toBe(times.length);
    expect(c.conflicts).toEqual([]);
    for (const t of times) expect(t).toMatch(/^(0[7-9]|1\d|2[01]):[03]0$/);
  });
  it("keeps clear of an agent's runs and schedules", () => {
    const busy = E.busyOf([], [9 * 60], "America/New_York");
    const r = E.pickSlots([{ id: "a", busy }]);
    expect(E.scoreSlot(Number(r.a.slot.slice(0, 2)) * 60 + Number(r.a.slot.slice(3)), busy)).toBe(0);
  });
  it("more agents than slots: the rest get no slot rather than a clash", () => {
    const many = Array.from({ length: 32 }, (_, i) => ({ id: `a${String(i).padStart(2, "0")}`, busy: [] }));
    const r = E.pickSlots(many);
    const given = Object.values(r).filter((x) => x.slot);
    expect(given.length).toBe(30);
    expect(new Set(given.map((x) => x.slot)).size).toBe(30);
    expect(Object.values(r).filter((x) => !x.slot)[0].reason).toMatch(/No free slot/);
  });
  it("reports shared slots as conflicts", () => {
    expect(E.slotConflicts({ a: "09:00", b: "09:00", c: "10:00" })).toEqual(["09:00: a, b"]);
  });
  it("the repo schedule has one agent per slot", () => {
    const text = readFileSync(new URL("../../catalog/workspace/self-reports.yaml", import.meta.url), "utf8");
    const slots = Object.fromEntries([...text.matchAll(/^ {4}([a-z0-9-]+): "(\d\d:\d\d)"$/gm)].map((m) => [m[1], m[2]]));
    expect(Object.keys(slots).length).toBeGreaterThan(10);
    expect(E.slotConflicts(slots)).toEqual([]);
  });
  it("reads cron and n8n schedule rules in New York time, across DST", () => {
    expect(E.cronTimes("30 13 * * 1-5", "UTC", "America/New_York")).toEqual([8 * 60 + 30]);
    expect(E.cronTimes("0 */6 * * *", "local", "America/New_York")).toEqual([0, 360, 720, 1080]);
    expect(E.cronTimes("0 0 9 * * *", "local", "America/New_York", true)).toEqual([540]);
    expect(E.n8nSchedules({ nodes: [{ type: "n8n-nodes-base.scheduleTrigger", parameters: { rule: { interval: [{ field: "hours", hoursInterval: 12, triggerAtMinute: 5 }] } } }] }, "America/New_York")).toEqual([5, 725]);
    expect(E.fmtLocal("2026-07-01T13:00:00Z", "America/New_York")).toBe("1 Jul, 9:00 AM");
    expect(E.fmtLocal("2026-12-01T13:00:00Z", "America/New_York")).toBe("1 Dec, 8:00 AM");
  });
});

describe("PDF", () => {
  const c = cycleOf(undefined, { failures: ["Excel workbook: upload failed (HTTP 500)"] });
  const pdf = E.buildPdf(c);
  const text = pdf.bytes.toString("latin1");
  it("is a well-formed PDF with an xref that points at its objects", () => {
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    const xref = Number(text.match(/startxref\n(\d+)/)[1]);
    expect(text.slice(xref, xref + 4)).toBe("xref");
    const offsets = [...text.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    offsets.forEach((o, i) => expect(text.slice(o).startsWith(`${i + 1} 0 obj`)).toBe(true));
  });
  it("has the summary, every agent, the sources page and the failure note", () => {
    for (const s of ["Executive summary", "Report schedule", "Sources and retention", "Not completed this cycle", ...c.agents.map((a) => a.agent)]) expect(text).toContain(s);
  });
});

describe("Excel workbook", () => {
  const c = cycleOf();
  const files = unzipSync(new Uint8Array(E.buildXlsx(E.workbookSheets(c))));
  const xml = (n) => strFromU8(files[n]);
  it("has the four sheets in order", () => {
    expect([...xml("xl/workbook.xml").matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1])).toEqual(["Overview", "Agent Reports", "Workflow Recommendations", "Sources"]);
    for (let i = 1; i <= 4; i++) expect(files[`xl/worksheets/sheet${i}.xml`]).toBeTruthy();
    expect(xml("[Content_Types].xml")).toContain("spreadsheetml.sheet.main+xml");
  });
  it("one Agent Reports row per agent and one recommendation row per suggestion", () => {
    expect((xml("xl/worksheets/sheet2.xml").match(/<row /g) || []).length).toBe(c.agents.length + 1);
    expect((xml("xl/worksheets/sheet3.xml").match(/<row /g) || []).length).toBe(c.recs.length + 1);
    expect(xml("xl/worksheets/sheet3.xml")).toContain("Review status");
    expect(xml("xl/worksheets/sheet4.xml")).toContain("Coverage window");
  });
  it("leaves unknown numbers blank instead of writing 0", () => {
    const sheet = xml("xl/worksheets/sheet2.xml");
    const row = sheet.split("<row ").find((r) => r.includes("Drew Lake"));
    expect(row).not.toMatch(/<v>0<\/v>/);
  });
  it("escapes text safely", () => {
    const d = cycleOf((agents) => { agents[0].name = 'A & B <"x">'; });
    const s = strFromU8(unzipSync(new Uint8Array(E.buildXlsx(E.workbookSheets(d))))["xl/worksheets/sheet2.xml"]);
    expect(s).toContain("A &amp; B &lt;&quot;x&quot;&gt;");
  });
  it("zip CRCs match", () => {
    expect(E.crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
  });
});

describe("safety", () => {
  it("the engine makes no network calls and holds no keys", () => {
    const src = readFileSync(new URL("./engine.cjs", import.meta.url), "utf8");
    expect(src).not.toMatch(/fetch\(|httpRequest|require\(|import /);
    expect(src).not.toMatch(/Bearer |api[_-]?key\s*[:=]|sk-[A-Za-z0-9]/i);
  });
  it("predictable Library files, one key each", () => {
    expect(E.FILES.pdf.fileName).toBe("atlas-agent-self-reports.pdf");
    expect(E.FILES.workbook.fileName).toBe("atlas-agent-self-reports.xlsx");
    expect(new Set(Object.values(E.FILES).map((f) => f.outputKey)).size).toBe(3);
  });
});

describe("one work report per agent for the Knowledge & Research Center", () => {
  const c = cycleOf();
  const files = E.agentFiles(c);
  it("every agent gets exactly one file under its own id and key", () => {
    expect(files.map((f) => f.agentId)).toEqual(c.agents.map((r) => r.agent_id));
    expect(new Set(files.map((f) => f.outputKey)).size).toBe(files.length);
    for (const f of files) expect(f).toMatchObject({ ok: true, outputKey: `${f.agentId}:work-report` });
    expect(E.LIBRARY_BUILDING).toBe("service:financial:financial-planning");
  });
  it("runs become a spreadsheet; no runs become a 'No data in window' PDF", () => {
    for (const f of files) {
      const row = rowOf(c, f.agentId);
      if (Number(row.runs_total) > 0) {
        expect(f).toMatchObject({ format: "spreadsheet", noData: false, fileName: `${f.agentId}-work-report.xlsx` });
        const sheet = strFromU8(unzipSync(new Uint8Array(Buffer.from(f.base64, "base64")))["xl/worksheets/sheet2.xml"]);
        expect(sheet).toContain(row.agent);
        expect(sheet.split("<row ").length - 1).toBe(2);
      } else {
        expect(f).toMatchObject({ format: "pdf", noData: true, fileName: `${f.agentId}-work-report.pdf` });
        const pdf = Buffer.from(f.base64, "base64").toString("latin1");
        expect(pdf.startsWith("%PDF-1.4")).toBe(true);
        expect(pdf).toContain("No data in window");
        expect(pdf).toContain(`(${row.agent} · work report)`.replace("·", "\xb7"));
      }
    }
    expect(files.filter((f) => f.format === "pdf").map((f) => f.agentId)).toEqual(expect.arrayContaining(["on-request", "unreachable", "quiet-watcher"]));
  });
  it("says why there is no data instead of showing 0", () => {
    expect(files.find((f) => f.agentId === "on-request").summary).toMatch(/^No data in window: no workflow is linked/);
    expect(files.find((f) => f.agentId === "unreachable").summary).toMatch(/^No data in window: its run source could not be read/);
    expect(files.find((f) => f.agentId === "flaky-builder").summary).toMatch(/^4 runs, 2 failed/);
  });
});
