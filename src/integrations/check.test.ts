import { beforeEach, expect, it, vi } from "vitest";
import { GithubError, githubGet } from "../github/transport";
import { checkState, testGithub } from "./check";
vi.mock("../github/transport", async importOriginal => ({...await importOriginal<typeof import("../github/transport")>(), githubGet:vi.fn()}));
beforeEach(() => { vi.mocked(githubGet).mockReset(); });
it("shares probes and verifies only metadata", async () => {
  vi.mocked(githubGet).mockResolvedValue({full_name:"owner/pass"});
  const [a,b] = await Promise.all([testGithub("owner/pass"),testGithub("owner/pass")]);
  expect(a).toBe(b); expect(githubGet).toHaveBeenCalledTimes(1); expect(a.message).toContain("not verified");
  expect(checkState(a,Date.parse(a.attemptedAt)+16*60_000)).toBe("stale");
});
for (const status of [401,403,404,429,0]) it(`redacts failure ${status}`, async () => {
  vi.mocked(githubGet).mockRejectedValue(new GithubError("SECRET",status));
  const result = await testGithub(`owner/error${status}`);
  expect(JSON.stringify(result)).not.toContain("SECRET"); expect(result.succeededAt).toBeUndefined();
  expect(result.state).not.toBe("connected");
});
it("does not send malformed repository paths",async()=>{expect((await testGithub("../user")).state).toBe("unavailable");expect(githubGet).not.toHaveBeenCalled();});
