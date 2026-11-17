import { useEffect, useMemo, useRef, useState } from "react";
import { AtlasMark } from "../../components/Icon";
import { setTimeZone } from "../../lib/timezone";
import { useAtlas } from "../../state";
import { KHANEIL } from "../../tasks/types";
import { catalogEntries } from "../../product/marketplace";
import { useIntegrationProbe } from "../../product/probe";
import { readiness } from "../../product/readiness";
import { compatibility, TEMPLATES } from "../../product/templates";
import { productStore, useProduct, useWorkspace } from "../../product/workspace";
import { closeOnboarding } from "./onboardingState";
import { IntegrationCard, WorkspaceForm } from "./Workspace";
import "../../styles/product.css";

// The first-run setup: six steps, each saved as it's finished, so closing the window halfway picks
// up where it stopped. No step calls a model or starts anything outside Atlas.

const STEPS = ["Owner", "Workspace", "Tools", "Agents", "Workflows", "Health check"] as const;
export const WELCOME = "Atlas is your private command center: one place to oversee your businesses, projects, AI agents, workflows and infrastructure. You are its only owner, so there are no accounts to register or people to invite.";

export function Onboarding() {
  const product = useProduct();
  const w = useWorkspace();
  const { catalog, setView } = useAtlas();
  const probe = useIntegrationProbe();
  const [step, setStepState] = useState(() => (product.onboarding.status === "in_progress" ? product.onboarding.step : 0));
  const dialog = useRef<HTMLDivElement>(null);
  // Resuming an unfinished setup edits the workspace it made; starting setup again makes a new one.
  const editing = useRef(product.onboarding.status === "in_progress" && !!w);
  const setStep = (n: number) => {
    setStepState(n);
    productStore().setOnboarding("in_progress", n, new Date().toISOString());
  };
  const finish = (status: "completed" | "skipped") => {
    productStore().setOnboarding(status, step, new Date().toISOString());
    closeOnboarding();
  };
  useEffect(() => {
    dialog.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && finish(w ? "completed" : "skipped");
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const agents = useMemo(() => catalogEntries(catalog, w).filter((e) => !e.automation), [catalog, w]);
  const r = useMemo(() => readiness(w, catalog, probe.states, probe.health), [w, catalog, probe.states, probe.health]);
  const update = (patch: Parameters<ReturnType<typeof productStore>["update"]>[2]) => w && productStore().update(w.id, w.rev, patch, KHANEIL, new Date().toISOString());

  return (
    <div className="onboarding-scrim">
      <div className="onboarding card" role="dialog" aria-modal="true" aria-labelledby="onb-title" tabIndex={-1} ref={dialog}>
        <ol className="onb-steps" aria-label="Setup steps">
          {STEPS.map((s, i) => (
            <li key={s} className={i === step ? "on" : i < step ? "done" : ""} aria-current={i === step ? "step" : undefined}>
              <span>{i + 1}</span> {s}
            </li>
          ))}
        </ol>
        <div className="onb-body">
          {step === 0 && (
            <>
              <div className="onb-mark">
                <AtlasMark />
              </div>
              <h1 id="onb-title">Welcome to Atlas</h1>
              <p className="lede">{WELCOME}</p>
              <p className="muted small">Setup takes a few minutes. Keys go to the Mac Keychain or your site's Cloudflare secrets, never into this page, and nothing outside Atlas runs until you start it.</p>
              <div className="onb-actions">
                <button className="btn primary" onClick={() => setStep(1)}>
                  Set Up My Workspace
                </button>
                <button className="btn" onClick={() => setStep(w ? 2 : 1)} title="Tools belong to a workspace, so this starts with one if you have none.">
                  Connect Tools
                </button>
                <button className="btn" onClick={() => finish("skipped")}>
                  Explore Atlas
                </button>
              </div>
            </>
          )}
          {step === 1 && (
            <>
              <h1 id="onb-title">Workspace</h1>
              <p className="muted small">Name what this Atlas runs for. You can change all of it later in Workspace.</p>
              <WorkspaceForm
                initial={editing.current && w ? { name: w.name, primaryBusiness: w.primaryBusiness, purpose: w.purpose, environment: w.environment, timeZone: w.defaults.timeZone, description: w.description } : { name: "", primaryBusiness: "", purpose: "business", environment: "production", timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York", description: "" }}
                submitLabel="Save and continue"
                onSubmit={(v) => {
                  const at = new Date().toISOString();
                  const res = editing.current && w ? productStore().update(w.id, w.rev, v, KHANEIL, at) : productStore().create(v, KHANEIL, at, { projects: catalog.projects.map((p) => p.id) });
                  if (!res.ok) return res.error;
                  editing.current = true;
                  setTimeZone(v.timeZone);
                  setStep(2);
                  return null;
                }}
              />
            </>
          )}
          {step === 2 && (
            <>
              <h1 id="onb-title">Integrations</h1>
              <p className="muted small">Only services Atlas has adapters for are listed. Turn on the ones this workspace uses; status comes from real checks, and an unverified connection says so.</p>
              <div className="integration-grid compact">
                {probe.states
                  .filter((s) => s.status !== "unsupported")
                  .map((s) => (
                    <IntegrationCard key={s.def.id} s={s} w={w} compact onChanged={() => void probe.check(false)} />
                  ))}
              </div>
            </>
          )}
          {step === 3 && (
            <>
              <h1 id="onb-title">Agents</h1>
              <p className="muted small">Registered agents you can add. Each keeps the tools and permissions its registry entry grants; you can only turn them on or off and limit model use. Configure details later in Workspace &gt; Agents.</p>
              <ul className="onb-agents">
                {agents.map((e) => (
                  <li key={e.id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={e.installed}
                        onChange={() => update({ allowedAgents: e.installed ? w!.allowedAgents.filter((x) => x !== e.id) : [...(w?.allowedAgents ?? []), e.id] })}
                        disabled={!w}
                      />
                      <span className="grow">
                        <b>{e.name}</b> <span className="muted">· {e.category} · {e.building}</span>
                        <div className="muted small">{e.capabilities.slice(0, 4).join(", ") || e.description}</div>
                        {e.permissions.length > 0 && <div className="small">Permissions: {e.permissions.slice(0, 3).join(", ")}</div>}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
          {step === 4 && (
            <>
              <h1 id="onb-title">Workflows</h1>
              <p className="muted small">Templates marked Executable are backed by a real Workflow Intelligence definition. Design-only ones describe work Atlas can't run as a workflow yet.</p>
              <ul className="onb-agents">
                {TEMPLATES.map((t) => {
                  const c = compatibility(t, w, catalog, probe.states);
                  const on = !!w?.templates.includes(t.id);
                  return (
                    <li key={t.id}>
                      <label>
                        <input type="checkbox" checked={on} disabled={!w} onChange={() => update({ templates: on ? w!.templates.filter((x) => x !== t.id) : [...(w?.templates ?? []), t.id] })} />
                        <span className="grow">
                          <b>{t.name}</b> <span className={`chip ${c.executable ? "good" : ""}`}>{c.executable ? "Executable" : "Design only"}</span>
                          <div className="muted small">{t.description}</div>
                          {!c.ready && c.problems[0] && <div className="small">{c.problems[0]}</div>}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {step === 5 && (
            <>
              <h1 id="onb-title">Setup check</h1>
              <div className="product-stats">
                <div>
                  <b>
                    {r.integrations.connected}/{r.integrations.enabled}
                  </b>
                  <span>Integrations connected</span>
                </div>
                <div>
                  <b>{r.agents.available}</b>
                  <span>Agents available</span>
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
                    {r.missing.slice(0, 6).map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                </div>
              )}
              {r.warnings.length > 0 && (
                <div className="product-list warn">
                  <h3>Security warnings</h3>
                  <ul>
                    {r.warnings.slice(0, 5).map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="small">
                Recommended first action: <b>{r.next.label}</b>. Nothing ran during setup.
              </p>
            </>
          )}
        </div>
        {step > 0 && (
          <div className="onb-foot">
            <button className="btn" onClick={() => setStep(step - 1)}>
              Back
            </button>
            <span className="grow" />
            <button className="text-btn small" onClick={() => finish(w ? "completed" : "skipped")}>
              Finish later
            </button>
            {step >= 2 && step < 5 && (
              <button className="btn primary" onClick={() => setStep(step + 1)} disabled={!w}>
                Continue
              </button>
            )}
            {step === 5 && (
              <>
                <button
                  className="btn"
                  onClick={() => {
                    finish("completed");
                    setView("tasks");
                  }}
                >
                  Open Task Center
                </button>
                <button
                  className="btn primary"
                  onClick={() => {
                    finish("completed");
                    setView("workspace");
                  }}
                >
                  Finish
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
