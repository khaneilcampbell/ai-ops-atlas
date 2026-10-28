import { describe, expect, it, vi } from "vitest";
import { proxyGithub, refusal } from "./github";

const env = { GITHUB_TOKEN: "ghp_secret", ALLOWED_OWNERS: "khaneilcampbell" };

describe("refusal", () => {
  it("allows the paths the app reads", () => {
    for (const p of [
      "/repos/khaneilcampbell/ai-ops-atlas",
      "/repos/khaneilcampbell/ai-ops-atlas/languages",
      "/repos/khaneilcampbell/ai-ops-atlas/commits",
      "/repos/khaneilcampbell/ai-ops-atlas/pulls",
      "/repos/khaneilcampbell/ai-ops-atlas/actions/runs",
      "/repos/khaneilcampbell/ai-ops-atlas/actions/workflows/ci.yml/runs",
      "/users/khaneilcampbell/repos",
      "/user/repos",
    ])
      expect(refusal(p, env)).toBeNull();
  });

  it("refuses other owners, other endpoints and traversal", () => {
    expect(refusal("/repos/someone/else", env)).toBe("Owner not allowed.");
    expect(refusal("/repos/khaneilcampbell/ai-ops-atlas/contents/secrets.txt", env)).toBe("Path not allowed.");
    // File contents only for the repositories the editor is switched on for.
    const editing = { ...env, GITHUB_EDIT_TOKEN: "t", EDIT_REPOS: "khaneilcampbell/ai-ops-atlas" };
    expect(refusal("/repos/khaneilcampbell/ai-ops-atlas/contents/docs/READ%20ME.md", editing)).toBeNull();
    expect(refusal("/repos/khaneilcampbell/ai-ops-atlas/contents", editing)).toBeNull();
    expect(refusal("/repos/khaneilcampbell/other/contents/README.md", editing)).toBe("Path not allowed.");
    expect(refusal("/repos/khaneilcampbell/ai-ops-atlas/contents/README.md", { ...editing, GITHUB_EDIT_TOKEN: undefined })).toBe("Path not allowed.");
    expect(refusal("/repos/khaneilcampbell/ai-ops-atlas/../../user", env)).toBe("Path not allowed.");
    expect(refusal("/user", env)).toBe("Path not allowed.");
    expect(refusal("/repos/khaneilcampbell/ai-ops-atlas/pulls/7/merge", env)).toBe("Path not allowed.");
    expect(refusal("/user/repos", {})).toBe("No token configured.");
  });
});

describe("proxyGithub", () => {
  it("adds the token server-side and never echoes it", async () => {
    const fetcher = vi.fn(async () => new Response('{"ok":1}', { status: 200, headers: { etag: 'W/"x"', "x-ratelimit-remaining": "4999" } }));
    const req = new Request("https://atlas.example/api/github/repos/khaneilcampbell/ai-ops-atlas", { headers: { "if-none-match": 'W/"old"' } });
    const res = await proxyGithub("/repos/khaneilcampbell/ai-ops-atlas", "?per_page=5", req, env, fetcher as unknown as typeof fetch);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.github.com/repos/khaneilcampbell/ai-ops-atlas?per_page=5");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer ghp_secret");
    expect((init.headers as Record<string, string>)["If-None-Match"]).toBe('W/"old"');
    expect(res.headers.get("etag")).toBe('W/"x"');
    expect(res.headers.get("x-atlas-authed")).toBe("1");
    expect([...res.headers.values()].join(" ")).not.toContain("ghp_secret");
  });

  it("refuses without calling GitHub", async () => {
    const fetcher = vi.fn();
    const res = await proxyGithub("/repos/other/x", "", new Request("https://a/"), env, fetcher as unknown as typeof fetch);
    expect(res.status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("answers in JSON when GitHub times out or can't be reached", async () => {
    const req = new Request("https://a/");
    const timeout = vi.fn(async () => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    });
    const slow = await proxyGithub("/repos/khaneilcampbell/x", "", req, env, timeout as unknown as typeof fetch);
    expect(slow.status).toBe(504);
    expect(((await slow.json()) as { message: string }).message).toContain("20 seconds");

    const down = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const unreachable = await proxyGithub("/repos/khaneilcampbell/x", "", req, env, down as unknown as typeof fetch);
    expect(unreachable.status).toBe(502);
    expect(unreachable.headers.get("x-atlas-authed")).toBeNull();
  });
});
