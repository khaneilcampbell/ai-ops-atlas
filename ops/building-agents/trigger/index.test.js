import { describe, expect, it, vi } from "vitest";
import worker, { checksFor, dispatch } from "./index.js";

const at = (h, m) => new Date(Date.UTC(2026, 10, 18, h, m));

describe("building agents trigger", () => {
  it("keeps the old schedule: signals at :15 and :45, marketplace hourly, census every three hours", () => {
    expect(checksFor(at(1, 0))).toEqual(["marketplace"]);
    expect(checksFor(at(3, 0))).toEqual(["marketplace", "census"]);
    expect(checksFor(at(3, 15))).toEqual(["signals"]);
    expect(checksFor(at(3, 30))).toEqual([]);
    expect(checksFor(at(3, 45))).toEqual(["signals"]);
    // A late cron still lands in its quarter hour.
    expect(checksFor(at(3, 16))).toEqual(["signals"]);
  });

  it("sends one workflow_dispatch on main and keeps the token out of errors", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 204 }));
    await dispatch("signals", "github_pat_secret", fetcher);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("https://api.github.com/repos/khaneilcampbell/ai-ops-atlas/actions/workflows/building-agents.yml/dispatches");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ ref: "main", inputs: { check: "signals" } });
    const refused = vi.fn(async () => new Response("{}", { status: 403 }));
    await expect(dispatch("signals", "github_pat_secret", refused)).rejects.toThrow(/403/);
    await expect(dispatch("signals", "github_pat_secret", refused)).rejects.not.toThrow(/github_pat_secret/);
  });

  it("fails loudly without its token", async () => {
    await expect(worker.scheduled({ scheduledTime: at(3, 15).getTime() }, {})).rejects.toThrow(/GITHUB_DISPATCH_TOKEN/);
  });
});
