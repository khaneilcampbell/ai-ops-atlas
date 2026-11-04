import { GithubError, githubGet } from "../github/transport";

export interface ConnectionCheck {
  attemptedAt: string;
  succeededAt?: string;
  state: "connected" | "degraded" | "disconnected" | "unavailable";
  message: string;
}
export function checkState(check?: ConnectionCheck, now = Date.now()) {
  return check?.state === "connected" && now - Date.parse(check.attemptedAt) > 15 * 60_000 ? "stale" : check?.state ?? "configured";
}
const checks = new Map<string, { at: number; value: Promise<ConnectionCheck> }>();
/** Explicit read-only probe; concurrent clicks and repeats within a minute share one request. */
export function testGithub(repository: string): Promise<ConnectionCheck> {
  if (!/^[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*$/.test(repository)) return Promise.resolve({ attemptedAt: new Date().toISOString(), state: "unavailable", message: "Choose a valid catalog repository." });
  const previous = checks.get(repository);
  if (previous && Date.now() - previous.at < 60_000) return previous.value;
  const value = (async (): Promise<ConnectionCheck> => {
    const attemptedAt = new Date().toISOString();
    try {
      const result = await githubGet(`/repos/${repository}`, { cache: false }) as { full_name?: unknown };
      if (typeof result?.full_name !== "string" || result.full_name.toLowerCase() !== repository.toLowerCase()) throw new Error("Unexpected response");
      return { attemptedAt, succeededAt: new Date().toISOString(), state: "connected", message: "Repository metadata readable. Contents, Actions, private access, and other repositories are not verified by this check." };
    } catch (error) {
      const status = error instanceof GithubError ? error.status : 0;
      // Only fixed messages cross the UI boundary; response bodies may contain sensitive text.
      const message = status === 401 ? "Saved access was rejected. Update the connection in GitHub access below." : status === 404 ? "Repository unavailable: check its name and token repository selection." : status === 403 || status === 429 ? "Access or request limit prevented verification. Check permissions and request budget below." : "Check unavailable or timed out. Retry after a minute; saved repository evidence is unchanged.";
      return { attemptedAt, state: status === 401 ? "disconnected" : status === 403 || status === 429 ? "degraded" : "unavailable", message };
    }
  })();
  checks.set(repository, { at: Date.now(), value });
  return value;
}
