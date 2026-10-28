import { describe, expect, it } from "vitest";
import { editStatus, proposeEdit, type EditEnv } from "./edit";
import { branchName, validPath } from "./editRules";

const REPO = "khaneilcampbell/benjaire.com";
const HEAD = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
const BLOB = "0123456789abcdef0123456789abcdef01234567";
const env: EditEnv = { GITHUB_EDIT_TOKEN: "github_pat_edit", EDIT_REPOS: `${REPO}, other/repo` };
const b64 = (t: string) => btoa(String.fromCharCode(...new TextEncoder().encode(t)));

function github(overrides: Record<string, { status: number; body: unknown }> = {}) {
  const calls: { method: string; url: string; body: unknown; auth: string | null }[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(String(init.body)) : null;
    calls.push({ method, url, body, auth: new Headers(init.headers).get("authorization") });
    const path = url.replace(`https://api.github.com/repos/${REPO}`, "");
    const key = `${method} ${path.split("?")[0]}`;
    const fixed: Record<string, { status: number; body: unknown }> = {
      "GET ": { status: 200, body: { full_name: REPO, default_branch: "main", archived: false } },
      "GET /git/ref/heads/main": { status: 200, body: { object: { sha: HEAD } } },
      "GET /contents/docs/READ%20ME.md": { status: 200, body: { type: "file", sha: BLOB, content: b64("# Héllo\nold\n") } },
      "POST /git/refs": { status: 201, body: {} },
      "PUT /contents/docs/READ%20ME.md": { status: 200, body: { commit: { sha: "c0ffee" } } },
      "POST /pulls": { status: 201, body: { number: 12, html_url: "https://github.com/x/pull/12" } },
      ...overrides,
    };
    const r = fixed[key] ?? { status: 404, body: { message: "Not Found" } };
    return new Response(JSON.stringify(r.body), { status: r.status });
  }) as unknown as typeof fetch;
  return { calls, fetcher };
}

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://ai-ops-atlas.pages.dev/api/edit", {
    method: "POST",
    headers: { origin: "https://ai-ops-atlas.pages.dev", "content-type": "application/json", "x-atlas-edit": "1", ...headers },
    body: JSON.stringify(body),
  });
}

const edit = { repo: REPO, path: "docs/READ ME.md", base_sha: BLOB, content: "# Héllo\nnew\n", title: "Fix docs" };
const now = () => new Date("2026-10-28T22:00:00Z");

describe("proposeEdit (website)", () => {
  it("opens a pull request from a new atlas-edit branch with the edit token", async () => {
    const gh = github();
    const r = await proposeEdit(request(edit), env, gh.fetcher, now);
    const o = await r.json();
    expect(r.status).toBe(201);
    expect(o).toMatchObject({ stage: "opened", pull_number: 12, branch: "atlas-edit/read-me-md-20261028-220000" });
    const writes = gh.calls.filter((c) => c.method !== "GET");
    expect(writes.map((c) => c.method)).toEqual(["POST", "PUT", "POST"]);
    expect(writes[0].body).toEqual({ ref: "refs/heads/atlas-edit/read-me-md-20261028-220000", sha: HEAD });
    expect(writes[1].body).toMatchObject({ branch: "atlas-edit/read-me-md-20261028-220000", sha: BLOB, message: "Fix docs" });
    expect(new TextDecoder().decode(Uint8Array.from(atob((writes[1].body as { content: string }).content), (c) => c.charCodeAt(0)))).toBe(edit.content);
    expect(writes[2].body).toMatchObject({ head: "atlas-edit/read-me-md-20261028-220000", base: "main" });
    expect(gh.calls.every((c) => c.auth === "Bearer github_pat_edit")).toBe(true);
  });

  it("is off without the token and refuses other repositories", async () => {
    const gh = github();
    expect((await (await proposeEdit(request(edit), {}, gh.fetcher)).json()).reason).toBe("disabled");
    expect((await (await proposeEdit(request({ ...edit, repo: "khaneilcampbell/other" }), env, gh.fetcher)).json()).reason).toBe("repo_not_enabled");
    // other/repo is listed but its owner isn't allowed.
    expect(editStatus(env).headers.get("cache-control")).toBe("no-store");
    expect(await editStatus(env).json()).toEqual({ enabled: true, repos: [REPO] });
    expect(gh.calls).toEqual([]);
  });

  it("refuses requests another site could send", async () => {
    const gh = github();
    for (const h of [{ origin: "https://evil.example" }, { "x-atlas-edit": "" }, { "content-type": "text/plain" }]) {
      const r = await proposeEdit(request(edit, h), env, gh.fetcher);
      expect(r.status).toBe(403);
    }
    expect(gh.calls).toEqual([]);
  });

  it("refuses unsafe paths, stale files and unchanged text before writing", async () => {
    let gh = github();
    expect((await (await proposeEdit(request({ ...edit, path: ".github/workflows/ci.yml" }), env, gh.fetcher)).json()).reason).toBe("invalid_path");
    expect((await (await proposeEdit(request({ ...edit, base_sha: "f".repeat(40) }), env, gh.fetcher)).json()).reason).toBe("stale_file");
    expect((await (await proposeEdit(request({ ...edit, content: "# Héllo\nold\n" }), env, gh.fetcher)).json()).reason).toBe("no_change");
    expect(gh.calls.filter((c) => c.method !== "GET")).toEqual([]);
    gh = github({ "PUT /contents/docs/READ%20ME.md": { status: 409, body: { message: "sha mismatch" } } });
    const o = await (await proposeEdit(request(edit), env, gh.fetcher, now)).json();
    expect(o).toMatchObject({ stage: "failed", reason: "stale_file" });
    expect(o.message).toContain("atlas-edit/read-me-md-20261028-220000");
    expect(gh.calls.some((c) => c.url.endsWith("/pulls"))).toBe(false);
  });
});

describe("edit rules", () => {
  it("matches the Mac app's path and branch rules", () => {
    for (const ok of ["README.md", "docs/READ ME.md", "a/b-c_d.e@f+g.yaml", ".github/CODEOWNERS"]) expect(validPath(ok), ok).toBe(true);
    for (const bad of ["", "/a", "a/", "a//b", "../x", "a/.git/config", ".GITHUB/workflows/x.yml", "a?b", "a#b", "a\\b"]) expect(validPath(bad), bad).toBe(false);
    expect(branchName("docs/READ ME.md", new Date("2026-10-28T22:00:00Z"))).toBe("atlas-edit/read-me-md-20261028-220000");
  });
});
