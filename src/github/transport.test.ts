import { afterEach, describe, expect, it, vi } from "vitest";

const web = { on: true };
vi.mock("../lib/env", () => ({ isTauri: () => false, isHostedWeb: () => web.on }));

const { githubGet, takeUsage } = await import("./transport");

const stubFetch = (impl: (url: string, init: RequestInit) => Promise<Response>) => vi.stubGlobal("fetch", vi.fn(impl));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  web.on = true;
  takeUsage();
});

describe("githubGet in the browser", () => {
  it("shows the site's own message when the site, not GitHub, refuses", async () => {
    stubFetch(async () => Response.json({ message: "Session expired. Reload to sign in again." }, { status: 401 }));
    await expect(githubGet("/repos/o/r")).rejects.toMatchObject({ status: 401, message: "The site refused the request: Session expired. Reload to sign in again." });
    expect(takeUsage().requests).toBe(0);
  });

  it("still reads GitHub's own answers relayed by the site", async () => {
    stubFetch(async () => Response.json({ message: "Bad credentials" }, { status: 401, headers: { "x-atlas-authed": "1" } }));
    await expect(githubGet("/repos/o/r")).rejects.toMatchObject({ status: 401, message: "The saved GitHub token was rejected" });
    stubFetch(async () => Response.json({ name: "r" }, { headers: { "x-atlas-authed": "1" } }));
    await expect(githubGet("/repos/o/r2")).resolves.toEqual({ name: "r" });
  });

  it("gives up on a request that never answers", async () => {
    vi.useFakeTimers();
    stubFetch(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    const pending = githubGet("/repos/o/slow");
    const done = expect(pending).rejects.toMatchObject({ status: 0, message: "GitHub didn't answer within 20 seconds." });
    await vi.advanceTimersByTimeAsync(20_000);
    await done;
  });

  it("names a network failure instead of the browser's generic error", async () => {
    web.on = false;
    stubFetch(async () => {
      throw new TypeError("Load failed");
    });
    await expect(githubGet("/repos/o/offline")).rejects.toMatchObject({ status: 0, message: "Couldn't reach GitHub. Check the connection." });
  });
});
