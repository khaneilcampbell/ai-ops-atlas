import { useState } from "react";
import { useAtlas } from "../state";
import { projectRepositories } from "../catalog/projects";
import { isHostedWeb, isTauri } from "../lib/env";
import { checkState, testGithub, type ConnectionCheck } from "./check";

export function IntegrationCenter() {
  const { catalog } = useAtlas();
  const repositories = [...new Set(catalog.projects.flatMap(p => projectRepositories(p, catalog.agents)))];
  const [repository, setRepository] = useState(repositories[0] ?? "");
  const [results, setResults] = useState<Record<string, ConnectionCheck>>({});
  const [busy, setBusy] = useState(false);
  const result = results[repository];
  const platform = isTauri() ? "Desktop · Keychain credential boundary" : isHostedWeb() ? "Hosted website · server credential boundary" : "Local preview · anonymous public GitHub access only";
  return <section aria-label="Integration Center">
    <div className="setting" style={{display:"block"}}>
      <p>{platform}. Credentials are never returned to this view.</p>
      <p className="small muted">GitHub supplies repository evidence for {catalog.projects.map(p => p.name).join(", ")}. Requested read-only permissions: Metadata, Contents, Actions. A successful metadata check does not verify every permission.</p>
      <label className="field">Repository <select value={repository} onChange={e => setRepository(e.target.value)}>{repositories.map(name => <option key={name}>{name}</option>)}</select></label>
      <p><button className="btn" disabled={busy || !repository} onClick={async () => { setBusy(true); try { const next = await testGithub(repository); setResults(previous => ({...previous,[repository]:{...next,succeededAt:next.succeededAt ?? previous[repository]?.succeededAt}})); } finally {setBusy(false);} }}>{busy ? "Checking…" : "Test connection"}</button> <span className="chip">{result ? checkState(result) : "Not checked"}</span></p>
      <div role="status">{result?.message ?? "Run a read-only check. No recurring monitoring is added."}</div>
      <p className="small muted">Source: GitHub repository metadata · Last attempt: {result?.attemptedAt ?? "None"} · Last success: {result?.succeededAt ?? "None"}. Results remain in this session only. Repeated checks within one minute reuse the result.</p>
    </div>
    <div className="setting" style={{display:"block"}}><b>Cloudflare · Account connection unavailable</b><p className="small muted">Existing website checks and deployment evidence remain in project dashboards. They do not verify Cloudflare account scopes. No account-testing adapter is available here.</p><b>n8n · Administration connection unavailable</b><p className="small muted">Declared workflow references are configuration, not connection health. Existing reported executions remain in agent Output. No credential or administration probe is available here.</p></div>
  </section>;
}
