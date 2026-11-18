// Starts the Building agents workflow on a reliable clock. GitHub's own `schedule` trigger
// delivered about 1 in 6 runs in November 2026, so the agents looked stale between runs.
// Cloudflare Cron Triggers fire on time; this Worker only asks GitHub to run the same
// workflow_dispatch a person could press. It holds one secret, GITHUB_DISPATCH_TOKEN: a
// fine-grained token for khaneilcampbell/ai-ops-atlas with Actions read and write and nothing else.

const REPO = "khaneilcampbell/ai-ops-atlas";
const WORKFLOW = "building-agents.yml";

/** Which checks are due at this quarter hour (UTC), matching the workflow's old cron lines. */
export function checksFor(date) {
  const minute = date.getUTCMinutes();
  const hour = date.getUTCHours();
  const due = [];
  if (minute >= 15 && minute < 30) due.push("signals");
  if (minute >= 45) due.push("signals");
  if (minute < 15) {
    due.push("marketplace");
    if (hour % 3 === 0) due.push("census");
  }
  return due;
}

/** Asks GitHub to run the workflow once for `check`. Throws on any answer but 204. */
export async function dispatch(check, token, fetcher = fetch) {
  const res = await fetcher(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "atlas-building-agents-trigger",
    },
    body: JSON.stringify({ ref: "main", inputs: { check } }),
  });
  // Never log the token or the request; GitHub's status says enough.
  if (res.status !== 204) throw new Error(`GitHub refused the ${check} dispatch with ${res.status}`);
}

export default {
  async scheduled(event, env) {
    if (!env.GITHUB_DISPATCH_TOKEN) throw new Error("GITHUB_DISPATCH_TOKEN is not set");
    for (const check of checksFor(new Date(event.scheduledTime))) await dispatch(check, env.GITHUB_DISPATCH_TOKEN);
  },
};
