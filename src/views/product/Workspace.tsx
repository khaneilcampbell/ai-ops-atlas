import { useEffect, useMemo, useState } from "react";
import { Icon } from "../../components/Icon";
import { useLedgers } from "../../execution/ledger";
import { BACKOFF_BASE_MS, BACKOFF_MAX_MS, MAX_CONCURRENT, MAX_REPAIRS, spend } from "../../execution/policy";
import { grantsFor, SIDE_EFFECT_LABEL } from "../../intelligence/capabilities";
import { anthropicKey } from "../../intel/api";
import { load, save } from "../../lib/storage";
import { relative } from "../../lib/time";
import { tokenStore } from "../../lib/token";
import { STATE_LABEL } from "../../observability/health";
import { useAtlas } from "../../state";
import { useTasks } from "../../tasks/store";
import { KHANEIL } from "../../tasks/types";
import { useRuns } from "../../workflows/runs";
import { NOT_SUPPORTED, statusBadge, type IntegrationState } from "../../product/integrations";
import { catalogEntries, CONFIG_PRESETS, filterEntries } from "../../product/marketplace";
import { toolUse } from "../../product/commandCenter";
import { platform, useIntegrationProbe } from "../../product/probe";
import { checkImport, exportWorkspace, readiness } from "../../product/readiness";
import { approvalsOf, compatibility, definitionOf, goalText, requiredAgents, simulateTemplate, TEMPLATES, versionOf, type WorkflowTemplate } from "../../product/templates";
import { DEFAULT_AGENT_SETTINGS, ENVIRONMENT_LABEL, ENVIRONMENTS, OFFERED_PURPOSES, productStore, PURPOSE_LABEL, settingsFor, useProduct, useWorkspace, type AgentSettings, type Workspace, type WorkspaceInput } from "../../product/workspace";
import { openOnboarding } from "./onboardingState";
import { PortfolioCard } from "./Portfolio";
import "../../styles/product.css";

// Workspace: setup, integrations, agents, templates and administration in one place. Everything
// here reads systems Atlas already has (Agent Registry, Workflow Intelligence, Task Center, the
// site's health report); it adds a configuration layer, not a second copy of any of them.

export const WORKSPACE_TABS = ["setup", "integrations", "agents", "templates", "admin"] as const;
export type WorkspaceTab = (typeof WORKSPACE_TABS)[number];
const TAB_LABEL: Record<WorkspaceTab, string> = { setup: "Setup", integrations: "Tools", agents: "Agents", templates: "Workflows", admin: "Owner controls" };

export function WorkspaceView() {
  const product = useProduct();
  const w = useWorkspace();
  const probe = useIntegrationProbe();
  const [tab, setTabState] = useState<WorkspaceTab>(() => {
    const t = load<string>("workspaceTab", "setup");
    return (WORKSPACE_TABS as readonly string[]).includes(t) ? (t as WorkspaceTab) : "setup";
  });
  const setTab = (t: WorkspaceTab) => {
    setTabState(t);
    save("workspaceTab", t);
  };

  return (
    <div className="page product-page">
      <div className="page-head">
        <div className="grow">
          <div className="eyebrow">Workspace{w ? ` · ${ENVIRONMENT_LABEL[w.environment]}` : ""}</div>
          <h1>{w?.name ?? "Set up Atlas"}</h1>
          <p className="lede">Your private Atlas setup: how your businesses and projects are organized, and which tools, agents and workflows they use. Keys never pass through this page.</p>
        </div>
        {product.workspaces.length > 1 && (
          <label className="pf-field">
            <span className="muted small">Workspace</span>
            <select value={product.activeId ?? ""} onChange={(e) => productStore().select(e.target.value)}>
              {product.workspaces.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {product.workspaces.length > 1 && (
        <p className="muted small pf-tenancy-note">
          Workspaces on this device share one set of tasks, workflow runs, agent memory and business records. They are your own setups (for example a business and a personal area), not separate customer accounts, so don't use one to run work for someone else.
        </p>
      )}
      <div className="tabs product-tabs" role="tablist" aria-label="Workspace sections">
        {WORKSPACE_TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>
      {tab === "setup" && <SetupTab w={w} probe={probe} go={setTab} />}
      {tab === "integrations" && <IntegrationsTab w={w} probe={probe} />}
      {tab === "agents" && <AgentsTab w={w} />}
      {tab === "templates" && <TemplatesTab w={w} states={probe.states} />}
      {tab === "admin" && <AdminTab w={w} probe={probe} />}
    </div>
  );
}

type Probe = ReturnType<typeof useIntegrationProbe>;

// ---------------------------------------------------------------------------------------------

function SetupTab({ w, probe, go }: { w: Workspace | null; probe: Probe; go: (t: WorkspaceTab) => void }) {
  const { catalog, setView } = useAtlas();
  const r = useMemo(() => readiness(w, catalog, probe.states, probe.health), [w, catalog, probe.states, probe.health]);
  const act = () => (r.next.target === "tasks" || r.next.target === "workflows" ? setView(r.next.target) : go(r.next.target));
  return (
    <>
      <section className="card product-ready">
        <div className="card-head">
          <h2 className="grow">Setup check</h2>
          <button className="btn small" onClick={() => void probe.check(true)} disabled={probe.checking}>
            <Icon name="refresh" size={13} /> {probe.checking ? "Checking" : "Check again"}
          </button>
        </div>
        <div className="product-stats">
          <div>
            <b>
              {r.integrations.connected}/{r.integrations.enabled}
            </b>
            <span>Integrations connected</span>
          </div>
          <div>
            <b>{r.agents.available}</b>
            <span>Agents available{r.agents.disabled ? ` · ${r.agents.disabled} off` : ""}</span>
          </div>
          <div>
            <b>{r.workflows.ready.length}</b>
            <span>Workflows ready</span>
          </div>
        </div>
        {r.missing.length > 0 && (
          <div className="product-list">
            <h3>Missing</h3>
            <ul>
              {r.missing.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </div>
        )}
        {r.warnings.length > 0 && (
          <div className="product-list warn">
            <h3>Security and health warnings</h3>
            <ul>
              {r.warnings.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="card-foot product-next">
          <span className="grow muted small">Recommended next step. Nothing runs from this check; it reads what Atlas already knows.</span>
          <button className="btn primary small" onClick={act}>
            {r.next.label}
          </button>
        </div>
      </section>
      {w ? <WorkspaceDetails w={w} /> : <p className="muted">No workspace yet.</p>}
      <PortfolioCard w={w} />
      <section className="card">
        <div className="card-head">
          <h2 className="grow">Guided setup</h2>
        </div>
        <div className="setting">
          <div className="grow">
            <div className="label">Run the personal setup again</div>
            <div className="muted small">Add another workspace for one of your businesses or areas, or walk through tools, agents and workflows again. Your current workspace and completed setup stay as they are.</div>
          </div>
          <button className="btn" onClick={openOnboarding}>
            Open guided setup
          </button>
        </div>
      </section>
    </>
  );
}

export function WorkspaceForm({ initial, onSubmit, submitLabel }: { initial: WorkspaceInput; onSubmit: (v: WorkspaceInput) => string | null; submitLabel: string }) {
  const [v, setV] = useState(initial);
  const [msg, setMsg] = useState<string | null>(null);
  const set = (p: Partial<WorkspaceInput>) => setV((x) => ({ ...x, ...p }));
  return (
    <form
      className="product-form"
      onSubmit={(e) => {
        e.preventDefault();
        setMsg(onSubmit(v));
      }}
    >
      <label className="pf-field">
        <span>Workspace name</span>
        <input value={v.name} maxLength={60} onChange={(e) => set({ name: e.target.value })} required />
      </label>
      <label className="pf-field">
        <span>Primary business or project</span>
        <input value={v.primaryBusiness} maxLength={80} onChange={(e) => set({ primaryBusiness: e.target.value })} required />
      </label>
      <label className="pf-field">
        <span>Purpose</span>
        <select value={v.purpose} onChange={(e) => set({ purpose: e.target.value as WorkspaceInput["purpose"] })}>
          {(OFFERED_PURPOSES.includes(v.purpose) ? OFFERED_PURPOSES : [...OFFERED_PURPOSES, v.purpose]).map((p) => (
            <option key={p} value={p}>
              {PURPOSE_LABEL[p]}
            </option>
          ))}
        </select>
      </label>
      <label className="pf-field">
        <span>Operating environment</span>
        <select value={v.environment} onChange={(e) => set({ environment: e.target.value as WorkspaceInput["environment"] })}>
          {ENVIRONMENTS.map((x) => (
            <option key={x} value={x}>
              {ENVIRONMENT_LABEL[x]}
            </option>
          ))}
        </select>
      </label>
      <label className="pf-field">
        <span>Default time zone</span>
        <input value={v.timeZone} onChange={(e) => set({ timeZone: e.target.value })} placeholder="America/New_York" />
      </label>
      <label className="pf-field wide">
        <span>Description (optional)</span>
        <textarea value={v.description ?? ""} maxLength={400} rows={2} onChange={(e) => set({ description: e.target.value })} />
      </label>
      <div className="product-form-foot">
        {msg && (
          <span className="bad small" role="alert">
            {msg}
          </span>
        )}
        <span className="grow" />
        <button className="btn primary" type="submit">
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

function WorkspaceDetails({ w }: { w: Workspace }) {
  const [saved, setSaved] = useState<string | null>(null);
  return (
    <section className="card">
      <div className="card-head">
        <h2 className="grow">Workspace details</h2>
        <span className="muted small">
          Updated {relative(w.updatedAt)} · id <span className="mono">{w.id}</span>
        </span>
      </div>
      <WorkspaceForm
        key={`${w.id}:${w.rev}`}
        initial={{ name: w.name, primaryBusiness: w.primaryBusiness, purpose: w.purpose, environment: w.environment, timeZone: w.defaults.timeZone, description: w.description }}
        submitLabel="Save"
        onSubmit={(v) => {
          const r = productStore().update(w.id, w.rev, v, KHANEIL, new Date().toISOString());
          setSaved(r.ok ? "Saved." : null);
          return r.ok ? null : r.error;
        }}
      />
      {saved && <div className="card-foot muted small">{saved}</div>}
      <div className="card-foot muted small">
        {w.projects.length} projects · {w.allowedAgents.length} agents · {w.enabledIntegrations.length} integrations · {w.templates.length} template{w.templates.length === 1 ? "" : "s"}. Tasks, runs and business records stay in their own stores on this device.
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------

/** Which of the owner's buildings, agents and workflows rely on a tool, from the catalog. */
function ToolUseList({ id }: { id: string }) {
  const { catalog } = useAtlas();
  const use = useMemo(() => toolUse(catalog)[id], [catalog, id]);
  if (!use) return null;
  const names = (xs: { name: string }[]) => (xs.length ? (xs.length > 4 ? `${xs.slice(0, 4).map((x) => x.name).join(", ")} and ${xs.length - 4} more` : xs.map((x) => x.name).join(", ")) : "None recorded");
  return (
    <div>
      <dl className="tool-use">
        <dt>Projects</dt>
        <dd>{names(use.projects)}</dd>
        <dt>Agents</dt>
        <dd>{names(use.agents)}</dd>
        <dt>Workflows</dt>
        <dd>{names(use.workflows)}</dd>
      </dl>
    </div>
  );
}

export function IntegrationCard({ s, w, onChanged, compact }: { s: IntegrationState; w: Workspace | null; onChanged: () => void; compact?: boolean }) {
  const setup = s.def.setup[platform()];
  const on = !!w?.enabledIntegrations.includes(s.def.id);
  const [msg, setMsg] = useState<string | null>(null);
  const toggle = () => {
    if (!w) return;
    const list = on ? w.enabledIntegrations.filter((x) => x !== s.def.id) : [...w.enabledIntegrations, s.def.id];
    const r = productStore().update(w.id, w.rev, { enabledIntegrations: list }, KHANEIL, new Date().toISOString());
    if (!r.ok) setMsg(r.error);
  };
  return (
    <article className={`card integration ${s.status}`} aria-label={s.def.label}>
      <div className="card-head">
        <h3 className="grow">{s.def.label}</h3>
        <span className="health">
          <i className={statusBadge(s).dot} /> {statusBadge(s).label}
        </span>
      </div>
      <p className="muted small">{s.def.description}</p>
      <div className="small">
        <b>{s.detail}</b>
      </div>
      <div className="muted small">{s.verifiedAt ? `Last successful check ${relative(s.verifiedAt)}` : "Not verified by a check yet"}</div>
      {!compact && <ToolUseList id={s.def.id} />}
      {!compact && (
        <details className="small">
          <summary>Permissions, setup and diagnostics</summary>
          <h4>What Atlas may do</h4>
          <ul>
            {s.def.permissions.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          {setup && (
            <>
              <h4>Setup</h4>
              <ol>
                {setup.steps.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ol>
            </>
          )}
          {s.diagnostics.length > 0 && (
            <>
              <h4>Diagnostics</h4>
              <ul>
                {s.diagnostics.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </>
          )}
          <div className="muted">Adapter: <span className="mono">{s.def.adapter}</span></div>
        </details>
      )}
      {setup && (setup.kind === "keychain-github" || setup.kind === "keychain-anthropic") && s.status !== "unsupported" && <KeyForm kind={setup.kind} connected={s.status !== "configuration_required"} onChanged={onChanged} />}
      {!compact && setup?.kind === "site-secret" && s.status !== "unsupported" && (
        <div className="muted small">Disconnect: remove the secret on the site (Cloudflare Pages settings) and redeploy. Atlas can't read or delete site secrets.</div>
      )}
      {w && s.status !== "unsupported" && (
        <label className="setting tight">
          <span className="grow small">Use in {w.name}</span>
          <input type="checkbox" className="toggle" checked={on} onChange={toggle} />
        </label>
      )}
      {msg && <div className="bad small">{msg}</div>}
    </article>
  );
}

/** Sends a key straight to the Rust side, which keeps it in the Keychain. The page keeps nothing. */
function KeyForm({ kind, connected, onChanged }: { kind: "keychain-github" | "keychain-anthropic"; connected: boolean; onChanged: () => void }) {
  const api = kind === "keychain-github" ? tokenStore : anthropicKey;
  const [value, setValue] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const run = async (f: () => Promise<void>, ok: string) => {
    try {
      await f();
      setMsg(ok);
      onChanged();
    } catch (e) {
      setMsg(`Not saved: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  return (
    <div className="key-form">
      {connected ? (
        confirm ? (
          <>
            <span className="small grow">Remove the key from the Keychain?</span>
            <button className="btn small danger" onClick={() => void run(async () => (await api.clear(), setConfirm(false)), "Disconnected. The key was removed from the Keychain.")}>
              Remove
            </button>
            <button className="btn small" onClick={() => setConfirm(false)}>
              Keep
            </button>
          </>
        ) : (
          <button className="btn small" onClick={() => setConfirm(true)}>
            Disconnect
          </button>
        )
      ) : (
        <form
          className="key-row"
          onSubmit={(e) => {
            e.preventDefault();
            const v = value.trim();
            setValue("");
            if (v) void run(() => api.set(v), "Saved to the Keychain. Checking it now.");
          }}
        >
          <input type="password" autoComplete="off" spellCheck={false} value={value} onChange={(e) => setValue(e.target.value)} placeholder={kind === "keychain-github" ? "GitHub token" : "Anthropic API key"} aria-label={kind === "keychain-github" ? "GitHub token" : "Anthropic API key"} />
          <button className="btn small primary" type="submit" disabled={!value.trim()}>
            Save to Keychain
          </button>
        </form>
      )}
      {msg && <div className="muted small">{msg}</div>}
    </div>
  );
}

function IntegrationsTab({ w, probe }: { w: Workspace | null; probe: Probe }) {
  const { refresh } = useAtlas();
  const shown = probe.states.filter((s) => s.status !== "unsupported");
  const elsewhere = probe.states.filter((s) => s.status === "unsupported");
  const changed = () => {
    void refresh(true);
    void probe.check(false);
  };
  return (
    <>
      <div className="product-bar">
        <span className="muted small grow">
          {shown.filter((s) => s.status === "connected" && s.verifiedAt).length} of {shown.length} connected and checked on this {platform() === "desktop" ? "Mac" : platform() === "web" ? "site" : "preview"}
          {shown.some((s) => s.status === "connected" && !s.verifiedAt) ? `, ${shown.filter((s) => s.status === "connected" && !s.verifiedAt).length} with a key set but not verified` : ""}. Health is read once and reused for five minutes.
        </span>
        <button className="btn small" onClick={() => void probe.check(true)} disabled={probe.checking}>
          <Icon name="refresh" size={13} /> {probe.checking ? "Checking" : "Check again"}
        </button>
      </div>
      <div className="integration-grid">
        {shown.map((s) => (
          <IntegrationCard key={s.def.id} s={s} w={w} onChanged={changed} />
        ))}
      </div>
      <section className="card">
        <div className="card-head">
          <h2 className="grow">Unsupported here</h2>
        </div>
        <ul className="product-plain small">
          {elsewhere.map((s) => (
            <li key={s.def.id}>
              <b>{s.def.label}</b>: {s.detail}
            </li>
          ))}
          {NOT_SUPPORTED.map((n) => (
            <li key={n.id}>
              <b>{n.label}</b>: {n.reason}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------------------------

const TIER_LABEL = ["No AI", "Lightweight AI", "Advanced AI"];

function AgentsTab({ w }: { w: Workspace | null }) {
  const { catalog } = useAtlas();
  const entries = useMemo(() => catalogEntries(catalog, w), [catalog, w]);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [show, setShow] = useState<"all" | "installed" | "available">("installed");
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const categories = [...new Set(entries.map((e) => e.category))].sort();
  const list = filterEntries(entries, q, category, show);
  const install = (id: string, add: boolean) => {
    if (!w) return;
    const next = add ? [...w.allowedAgents, id] : w.allowedAgents.filter((x) => x !== id);
    const r = productStore().update(w.id, w.rev, { allowedAgents: next }, KHANEIL, new Date().toISOString());
    setMsg(r.ok ? null : r.error);
  };
  return (
    <>
      <div className="product-bar">
        <input className="search-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search agents and capabilities" aria-label="Search agents" />
        <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <div className="seg-ctl" role="tablist" aria-label="Which agents">
          {(["installed", "available", "all"] as const).map((s) => (
            <button key={s} className={show === s ? "on" : ""} onClick={() => setShow(s)}>
              {s === "installed" ? `In ${w?.name ?? "workspace"}` : s === "available" ? "Agent library" : "All"}
            </button>
          ))}
        </div>
      </div>
      {msg && <div className="bad small">{msg}</div>}
      <p className="muted small">
        The agent library lists your agents already in the Agent Registry. It is private, not a marketplace: adding one only lets this workspace use it; nothing is downloaded and no outside code runs. Tools, permissions, memory scope and building are protected and change only through a reviewed registry pull request.
      </p>
      <ul className="agent-catalog">
        {list.slice(0, 80).map((e) => (
          <li key={e.id} className={`card ${e.installed ? "installed" : ""}`}>
            <div className="card-head">
              <button className="text-btn grow" onClick={() => setOpen(open === e.id ? null : e.id)} aria-expanded={open === e.id}>
                <b>{e.name}</b> <span className="muted small">· {e.category} · {e.building}</span>
              </button>
              <span className="chip">{e.installed ? (settingsFor(w, e.id).enabled ? "On" : "Off") : "Available"}</span>
              {w && (
                <button className="btn small" onClick={() => install(e.id, !e.installed)}>
                  {e.installed ? "Remove" : "Add"}
                </button>
              )}
            </div>
            <p className="muted small">{e.description}</p>
            {open === e.id && <AgentDetail id={e.id} w={w} entry={e} />}
          </li>
        ))}
        {list.length === 0 && <li className="empty small">No agents match.</li>}
        {list.length > 80 && <li className="muted small">Showing 80 of {list.length}. Search to narrow the list.</li>}
      </ul>
      {w && w.history.length > 0 && (
        <section className="card">
          <div className="card-head">
            <h2 className="grow">Configuration history</h2>
          </div>
          <ul className="product-plain small">
            {w.history
              .slice()
              .reverse()
              .slice(0, 15)
              .map((h) => (
                <li key={`${h.at}${h.agentId}`}>
                  {relative(h.at)} · {catalog.agents.find((a) => a.id === h.agentId)?.name ?? h.agentId}: {h.summary} ({h.actor})
                </li>
              ))}
          </ul>
        </section>
      )}
    </>
  );
}

function AgentDetail({ id, w, entry }: { id: string; w: Workspace | null; entry: ReturnType<typeof catalogEntries>[number] }) {
  const { catalog } = useAtlas();
  const agent = catalog.agents.find((a) => a.id === id);
  const current = settingsFor(w, id);
  const [draft, setDraft] = useState<AgentSettings>(current);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => setDraft(current), [current]);
  const r = agent?.registry;
  const kpis = r?.goals?.kpis ?? [];
  const saveIt = (s: AgentSettings) => {
    if (!w) return;
    const res = productStore().configureAgent(w.id, w.rev, id, s, KHANEIL, new Date().toISOString());
    setMsg(res.ok ? "Saved and recorded in the history." : res.error);
  };
  return (
    <div className="agent-detail small">
      <dl className="product-dl">
        <dt>Purpose</dt>
        <dd>{agent?.purpose ?? "Not documented"}</dd>
        <dt>Building</dt>
        <dd>{entry.building} (protected)</dd>
        <dt>Environment</dt>
        <dd>{entry.environment}</dd>
        <dt>Version</dt>
        <dd>{entry.version}</dd>
        <dt>Capabilities</dt>
        <dd>{entry.capabilities.join(", ") || "Not documented"}</dd>
        <dt>Granted tools</dt>
        <dd>{grantsFor(id).map((g) => `${g.name} (${SIDE_EFFECT_LABEL[g.sideEffect]})`).join(", ") || "None through Atlas"} · protected</dd>
        <dt>Permissions</dt>
        <dd>{entry.permissions.join(", ") || "None declared"} · protected</dd>
        <dt>Memory scope</dt>
        <dd>{r?.governance?.dataSensitivity ? `Up to ${r.governance.dataSensitivity} data, own building and workflow` : "Own building and workflow"} · protected</dd>
        <dt>Required integrations</dt>
        <dd>{entry.requiredIntegrations.join(", ") || "None"}</dd>
        <dt>Associated workflows</dt>
        <dd>{TEMPLATES.filter((t) => requiredAgents(t).includes(id)).map((t) => t.name).join(", ") || "None"}</dd>
        <dt>Evaluation metrics</dt>
        <dd>{kpis.length ? kpis.map((k) => `${k.name}${k.target ? ` (target ${k.target})` : ""}`).join(", ") : "No KPIs in its registry entry. Run evaluations show in Agents > Intelligence."}</dd>
      </dl>
      {w && entry.installed ? (
        <div className="agent-config">
          <h4>Settings in {w.name}</h4>
          <div className="preset-row">
            {CONFIG_PRESETS.map((p) => (
              <button key={p.id} className="btn small" title={p.description} onClick={() => saveIt({ ...p.settings, note: draft.note })}>
                {p.label}
              </button>
            ))}
          </div>
          <label className="setting tight">
            <span className="grow">On in this workspace</span>
            <input type="checkbox" className="toggle" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />
          </label>
          <label className="pf-field">
            <span>Model limit</span>
            <select value={draft.maxModelTier} onChange={(e) => setDraft({ ...draft, maxModelTier: Number(e.target.value) as 0 | 1 | 2 })}>
              {TIER_LABEL.map((l, i) => (
                <option key={l} value={i}>
                  Tier {i} · {l}
                </option>
              ))}
            </select>
          </label>
          <label className="pf-field">
            <span>Note</span>
            <input value={draft.note} maxLength={300} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
          </label>
          <div className="product-form-foot">
            {msg && <span className="small">{msg}</span>}
            <span className="grow" />
            <button className="btn small" onClick={() => setDraft(DEFAULT_AGENT_SETTINGS)}>
              Reset
            </button>
            <button className="btn small primary" onClick={() => saveIt(draft)}>
              Save settings
            </button>
          </div>
          <p className="muted">A turned-off agent, or a step that needs a higher model tier than allowed here, stops Workflow Intelligence from starting a run that uses it.</p>
        </div>
      ) : (
        <p className="muted">Add it to the workspace to configure it.</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

function TemplatesTab({ w, states }: { w: Workspace | null; states: readonly IntegrationState[] }) {
  const { catalog, setView } = useAtlas();
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [onlyRunnable, setOnlyRunnable] = useState(false);
  const [openId, setOpenId] = useState<string>(TEMPLATES[0].id);
  const rows = TEMPLATES.map((t) => ({ t, c: compatibility(t, w, catalog, states) })).filter(
    ({ t, c }) => (!category || t.category === category) && (!onlyRunnable || c.executable) && (!q.trim() || `${t.name} ${t.description}`.toLowerCase().includes(q.trim().toLowerCase())),
  );
  const open = rows.find((r) => r.t.id === openId) ?? rows[0];
  return (
    <>
      <div className="product-bar">
        <input className="search-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search templates" aria-label="Search templates" />
        <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          {[...new Set(TEMPLATES.map((t) => t.category))].map((c) => (
            <option key={c} value={c}>
              {c[0].toUpperCase() + c.slice(1)}
            </option>
          ))}
        </select>
        <label className="small">
          <input type="checkbox" checked={onlyRunnable} onChange={(e) => setOnlyRunnable(e.target.checked)} /> Executable only
        </label>
      </div>
      <div className="template-layout">
        <ul className="template-list">
          {rows.map(({ t, c }) => (
            <li key={t.id}>
              <button className={`list-row ${open?.t.id === t.id ? "on" : ""}`} onClick={() => setOpenId(t.id)}>
                <span className="grow">
                  <div className="title">{t.name}</div>
                  <div className="meta">{c.executable ? (c.ready ? "Executable · ready" : "Executable · needs setup") : "Design only · not executable"}</div>
                </span>
              </button>
            </li>
          ))}
          {rows.length === 0 && <li className="empty small">No templates match.</li>}
        </ul>
        {open && <TemplateDetail t={open.t} c={open.c} w={w} openRun={() => setView("workflows")} />}
      </div>
    </>
  );
}

function TemplateDetail({ t, c, w, openRun }: { t: WorkflowTemplate; c: ReturnType<typeof compatibility>; w: Workspace | null; openRun: () => void }) {
  const { catalog } = useAtlas();
  const [mode, setMode] = useState<"preview" | "simulate">("preview");
  const [viable, setViable] = useState(true);
  const d = definitionOf(t);
  const names = (id: string) => {
    const n = d?.nodes.find((x) => x.id === id);
    return (n?.agentId && catalog.agents.find((a) => a.id === n.agentId)?.name) || n?.title || id;
  };
  const sim = useMemo(() => (mode === "simulate" ? simulateTemplate(t, { viable, standIn: true }, names) : null), [mode, viable, t]); // eslint-disable-line react-hooks/exhaustive-deps
  const picked = !!w?.templates.includes(t.id);
  const pick = () => w && productStore().update(w.id, w.rev, { templates: picked ? w.templates.filter((x) => x !== t.id) : [...w.templates, t.id] }, KHANEIL, new Date().toISOString());
  const values = Object.fromEntries(t.inputs.map((i) => [i.id, i.fromWorkspace && w ? String(w[i.fromWorkspace]) : ""]));
  return (
    <section className="card template-detail" aria-label={t.name}>
      <div className="card-head">
        <h2 className="grow">{t.name}</h2>
        <span className={`chip ${c.executable ? "good" : ""}`}>{c.executable ? "Executable" : "Design only"}</span>
        {w && (
          <button className="btn small" onClick={pick}>
            {picked ? "Remove from workspace" : "Use in workspace"}
          </button>
        )}
      </div>
      <p className="small">{t.description}</p>
      <dl className="product-dl small">
        <dt>Template id</dt>
        <dd className="mono">{t.id}</dd>
        <dt>Workflow version</dt>
        <dd>{versionOf(t) ?? "No definition"}</dd>
        <dt>Category</dt>
        <dd>{t.category}</dd>
        <dt>Required agents</dt>
        <dd>{requiredAgents(t).map((id) => catalog.agents.find((a) => a.id === id)?.name ?? id).join(", ") || "None"}</dd>
        <dt>Required integrations</dt>
        <dd>{t.integrations.join(", ")}</dd>
        <dt>Inputs</dt>
        <dd>{t.inputs.map((i) => `${i.label}${i.required ? "" : " (optional)"}${values[i.id] ? `: ${values[i.id]}` : i.example ? ` e.g. ${i.example}` : ""}`).join(" · ") || "None"}</dd>
        <dt>Outputs</dt>
        <dd>{t.outputs.join(" · ")}</dd>
        <dt>Approvals</dt>
        <dd>{approvalsOf(t).map((a) => `${a.step}: ${a.reason}`).join(" · ") || (d ? "None" : "Not defined")}</dd>
        {t.example && (
          <>
            <dt>Reference configuration</dt>
            <dd>The {t.example} workspace</dd>
          </>
        )}
      </dl>
      {c.problems.length > 0 && (
        <div className="product-list">
          <h3>Blocks a run</h3>
          <ul>
            {c.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}
      {c.warnings.length > 0 && (
        <details className="product-list warn small">
          <summary>{c.warnings.length} things to know</summary>
          <ul>
            {c.warnings.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </details>
      )}
      <h3>Configuration</h3>
      <ol className="small">
        {t.instructions.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      {d && (
        <>
          <div className="product-bar">
            <div className="seg-ctl" role="tablist" aria-label="Mode">
              <button className={mode === "preview" ? "on" : ""} onClick={() => setMode("preview")}>
                Preview
              </button>
              <button className={mode === "simulate" ? "on" : ""} onClick={() => setMode("simulate")}>
                Simulate
              </button>
            </div>
            {mode === "simulate" && (
              <label className="small">
                <input type="checkbox" checked={viable} onChange={(e) => setViable(e.target.checked)} /> Idea passes the viability decision
              </label>
            )}
            <span className="grow" />
            <button className="btn small primary" onClick={openRun} disabled={!c.ready} title={c.ready ? "Opens Workflow Intelligence, where you confirm and start a live run." : (c.problems[0] ?? "Not ready")}>
              Run in Workflow Intelligence
            </button>
          </div>
          {mode === "preview" ? (
            <ol className="template-steps small">
              {d.nodes.map((n) => (
                <li key={n.id}>
                  <b>{n.title}</b> <span className="muted">· {n.kind}{n.agentId ? ` · ${names(n.id)}` : ""}{n.approval ? " · needs approval" : ""}{n.unconfigured ? " · unconfigured" : ""}</span>
                </li>
              ))}
            </ol>
          ) : (
            <div className="sim-box">
              <div className="sim-banner small">Simulation: computed on this page, never saved. No tasks are created and nothing outside Atlas is called. Unconfigured steps are stood in for.</div>
              <div className="small muted">Goal: {goalText(t, w, values)}</div>
              <ol className="template-steps small">
                {sim?.events.map((e) => (
                  <li key={e.id}>
                    <span className="muted">{e.type.replace("_", " ")}</span> {e.text}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------

function AdminTab({ w, probe }: { w: Workspace | null; probe: Probe }) {
  const { catalog, setView } = useAtlas();
  const tasks = useTasks();
  const runs = useRuns();
  const ledgers = useLedgers();
  const [version, setVersion] = useState<string | null>(null);
  const [importMsg, setImportMsg] = useState<string[] | null>(null);
  useEffect(() => {
    if (platform() !== "desktop") return;
    void import("@tauri-apps/api/app")
      .then(({ getVersion }) => getVersion())
      .then(setVersion)
      .catch(() => undefined);
  }, []);
  const usage = useMemo(() => {
    const byStatus = new Map<string, number>();
    let est = 0;
    let billed = 0;
    let reports = 0;
    for (const t of tasks) {
      byStatus.set(t.status, (byStatus.get(t.status) ?? 0) + 1);
      const s = spend(t);
      est += s.estimatedUsd;
      billed += s.billedUsd;
      reports += s.reports;
    }
    return { byStatus, est, billed, reports };
  }, [tasks]);
  const report = probe.health.kind === "ok" ? probe.health.report : null;
  const download = () => {
    if (!w) return;
    const r = exportWorkspace(w, new Date().toISOString());
    if (!r.ok) return setImportMsg([r.error]);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([r.json], { type: "application/json" }));
    a.download = `atlas-workspace-${w.id}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const importFile = async (f: File | undefined) => {
    if (!f) return;
    const res = checkImport(await f.text(), catalog);
    if (!res.ok) return setImportMsg([res.error]);
    const added = productStore().addImported(res.workspace, KHANEIL, new Date().toISOString());
    setImportMsg(added.ok ? [`Imported as a new workspace (${added.id}). It isn't active until you pick it. Nothing ran.`, ...res.dropped] : [added.error]);
  };
  return (
    <div className="admin-grid">
      <section className="card">
        <div className="card-head">
          <h2 className="grow">General</h2>
        </div>
        <p className="small muted">Appearance, time zone, power use, map navigation, GitHub refresh and data backup live in Settings. Alert rules live in Mission Control.</p>
        <div className="product-form-foot">
          <button className="btn small" onClick={() => setView("settings")}>
            Open Settings
          </button>
          <button className="btn small" onClick={() => setView("overview")}>
            Open Mission Control
          </button>
        </div>
        {w && (
          <label className="setting tight">
            <span className="grow small">Show setup tips on this page</span>
            <input type="checkbox" className="toggle" checked={w.defaults.tips} onChange={(e) => productStore().update(w.id, w.rev, { tips: e.target.checked }, KHANEIL, new Date().toISOString())} />
          </label>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h2 className="grow">Workflow settings</h2>
          <span className="chip">
            <Icon name="lock" size={12} /> Fixed in code
          </span>
        </div>
        <ul className="product-plain small">
          <li>At most {MAX_CONCURRENT} steps of one run at a time.</li>
          <li>Retries back off from {BACKOFF_BASE_MS / 60_000} minute to {BACKOFF_MAX_MS / 60_000} minutes; {MAX_REPAIRS} repair attempt for a bad step output.</li>
          <li>A send with no clear answer is never retried by itself.</li>
          <li>Approvals: repository changes, deploys, spending and customer messages always wait for a person. Only a person can start, authorise or cancel a run.</li>
          <li>Per-agent limits (on or off, model tier) are set in Workspace &gt; Agents.</li>
        </ul>
        <p className="muted small">These limits are part of the reviewed code, so changing them needs a pull request. They aren't editable here on purpose.</p>
      </section>

      <section className="card">
        <div className="card-head">
          <h2 className="grow">Usage</h2>
          <button className="text-btn small" onClick={() => setView("usage")}>
            API Usage details ›
          </button>
        </div>
        <div className="product-stats">
          <div>
            <b>{tasks.length}</b>
            <span>Tasks</span>
          </div>
          <div>
            <b>{runs.length}</b>
            <span>Workflow runs</span>
          </div>
          <div>
            <b>{usage.reports}</b>
            <span>Usage reports</span>
          </div>
          <div>
            <b>${usage.billed.toFixed(2)}</b>
            <span>Billed · ${usage.est.toFixed(2)} est.</span>
          </div>
        </div>
        <p className="muted small">
          {[...usage.byStatus].map(([s, n]) => `${n} ${s.replace("_", " ")}`).join(" · ") || "No tasks yet."} · {Object.keys(ledgers).length} run ledgers. Counts are this device's Task Center; spend is what steps reported, estimated where the provider didn't bill yet.
        </p>
      </section>

      <section className="card">
        <div className="card-head">
          <h2 className="grow">System</h2>
          <button className="btn small" onClick={() => void probe.check(true)} disabled={probe.checking}>
            <Icon name="refresh" size={13} /> Check
          </button>
        </div>
        <dl className="product-dl small">
          <dt>App version</dt>
          <dd>{version ?? (platform() === "desktop" ? "Reading…" : "Web build (no version number)")}</dd>
          <dt>Platform</dt>
          <dd>{platform() === "desktop" ? "Mac app" : platform() === "web" ? "Hosted web (read-only for write actions)" : "Local preview"}</dd>
          <dt>Build</dt>
          <dd>{import.meta.env.MODE}</dd>
          <dt>Service health</dt>
          <dd>{report ? `${STATE_LABEL[report.overall]} · ${report.checks.length} checks · ${report.credentials.filter((c) => c.configured).length}/${report.credentials.length} keys set · checked ${relative(report.checkedAt)}` : probe.health.kind === "loading" ? "Checking…" : `Unknown: ${"message" in probe.health ? probe.health.message : "not read"}`}</dd>
          <dt>Updates</dt>
          <dd>{platform() === "desktop" ? "The Update button in the header checks the signed update feed." : "The web version updates when main is deployed."}</dd>
        </dl>
        <div className="product-form-foot">
          <button className="btn small" onClick={() => setView("overview")}>
            Production health and diagnostics
          </button>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2 className="grow">Configuration export</h2>
        </div>
        <p className="small muted">The workspace file holds settings only: no keys, no tasks, no business records (use Settings &gt; Data backup for those). Imported files are checked like untrusted input: unknown agents, tools and templates are dropped, protected settings are refused, and nothing runs.</p>
        <div className="product-form-foot">
          <button className="btn small" onClick={download} disabled={!w}>
            <Icon name="download" size={13} /> Export workspace
          </button>
          <label className="btn small">
            Import workspace
            <input type="file" accept="application/json,.json" hidden onChange={(e) => void importFile(e.target.files?.[0])} />
          </label>
        </div>
        {importMsg && (
          <ul className="product-plain small">
            {importMsg.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** Used by the readiness card and docs: the integrations this workspace turned on. */
export const enabledStates = (w: Workspace | null, states: readonly IntegrationState[]) => states.filter((s) => w?.enabledIntegrations.includes(s.def.id));
