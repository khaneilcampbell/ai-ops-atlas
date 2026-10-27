import { useEffect, useState } from "react";
import { Icon } from "../components/Icon";
import { ExternalLink } from "../components/bits";
import { anthropicKey } from "../intel/api";
import { useIntel } from "../intel/state";
import { usd } from "../intel/format";
import type { AgentConfig, Depth } from "../intel/types";

const DEPTHS: { id: Depth; label: string; hint: string }[] = [
  { id: "quick", label: "Quick", hint: "Short excerpts, small answer" },
  { id: "standard", label: "Standard", hint: "README, manifests, recent history" },
  { id: "deep", label: "Deep", hint: "Longer excerpts, more reasoning" },
];

export function IntelSettings() {
  const intel = useIntel();
  if (!intel.available) {
    return (
      <section className="card" style={{ marginBottom: 16 }}>
        <div className="card-head">
          <h2 className="grow">Repository intelligence</h2>
        </div>
        <div className="setting">
          <div className="grow muted small">Open the desktop app to configure the agent. The Anthropic key is stored in the macOS Keychain there.</div>
        </div>
      </section>
    );
  }
  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <div className="card-head">
        <h2 className="grow">Repository intelligence</h2>
        <span className="chip">
          <Icon name="spark" size={12} /> Claude
        </span>
      </div>
      <KeySetting onChange={() => void intel.reload()} />
      {intel.status && <ConfigForm key={JSON.stringify(intel.status.config)} config={intel.status.config} />}
    </section>
  );
}

function KeySetting({ onChange }: { onChange: () => void }) {
  const [has, setHas] = useState<boolean | null>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    anthropicKey.has().then(setHas, () => setHas(false));
  }, []);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await anthropicKey.set(value.trim());
      setValue("");
      setHas(true);
      onChange();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="setting">
        <div className="grow">
          <div className="label">Anthropic API key</div>
          <div className="muted small">
            {has ? "A key is saved in your macOS Keychain. Only the Rust side reads it; it is never shown here, logged, or sent anywhere but api.anthropic.com." : "Required to run analysis. Create one at "}
            {!has && <ExternalLink href="https://console.anthropic.com/settings/keys">console.anthropic.com</ExternalLink>}
            {!has && ". A key in its own workspace with a spend limit caps what Atlas can ever spend."}
          </div>
        </div>
        {has && (
          <button
            className="btn"
            onClick={async () => {
              await anthropicKey.clear();
              setHas(false);
              onChange();
            }}
          >
            Remove
          </button>
        )}
      </div>
      <div className="setting">
        <label className="field grow" style={{ flex: 1 }}>
          <Icon name="key" size={14} />
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={has ? "Replace the saved key" : "sk-ant-…"}
            style={{ width: "100%" }}
            aria-label="Anthropic API key"
          />
        </label>
        <button className="btn primary" disabled={!value.trim() || busy} onClick={save}>
          Save to Keychain
        </button>
      </div>
      {error && (
        <div className="setting">
          <div className="notice bad">{error}</div>
        </div>
      )}
    </>
  );
}

function num(v: string, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function ConfigForm({ config }: { config: AgentConfig }) {
  const intel = useIntel();
  const [draft, setDraft] = useState<AgentConfig>(config);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [consenting, setConsenting] = useState(false);
  const changed = JSON.stringify(draft) !== JSON.stringify(config);
  const set = (p: Partial<AgentConfig>) => {
    setSaved(false);
    setDraft((d) => ({ ...d, ...p }));
  };
  const setModel = (depth: Depth, model: string) => set({ models: { ...draft.models, [depth]: model.trim() } });
  const setPrice = (model: string, k: "input" | "output", v: number) => set({ pricing: { ...draft.pricing, [model]: { ...(draft.pricing[model] ?? { input: 0, output: 0 }), [k]: v } } });
  const save = async (next = draft) => {
    setError(null);
    try {
      await intel.setConfig(next);
      setSaved(true);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <>
      <div className="setting">
        <div className="grow">
          <div className="label">Default depth</div>
          <div className="muted small">Each depth has its own model, input budget and answer size. You can pick a depth for any single run too.</div>
        </div>
        <label className="field">
          <select value={draft.depth} onChange={(e) => set({ depth: e.target.value as Depth })}>
            {DEPTHS.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {DEPTHS.map((d) => {
        const m = draft.models[d.id];
        const p = draft.pricing[m];
        return (
          <div className="setting" key={d.id}>
            <div className="grow">
              <div className="label">{d.label} model</div>
              <div className="muted small">{d.hint}. Price in US$ per million tokens (input / output).</div>
            </div>
            <label className="field">
              <input value={m} onChange={(e) => setModel(d.id, e.target.value)} style={{ width: 170 }} spellCheck={false} aria-label={`${d.label} model`} />
            </label>
            <label className="field">
              <input type="number" min={0} step={0.01} value={p?.input ?? ""} onChange={(e) => setPrice(m, "input", num(e.target.value, 0))} style={{ width: 64 }} aria-label={`${d.label} input price`} />
            </label>
            <label className="field">
              <input type="number" min={0} step={0.01} value={p?.output ?? ""} onChange={(e) => setPrice(m, "output", num(e.target.value, 0))} style={{ width: 64 }} aria-label={`${d.label} output price`} />
            </label>
          </div>
        );
      })}
      <div className="setting">
        <div className="grow">
          <div className="label">Spending limits</div>
          <div className="muted small">Before each call the worst case (estimated input plus the full answer allowance) is checked against both. A run that could exceed either is blocked, not sent.</div>
        </div>
        <label className="field">
          <label>Per run $</label>
          <input type="number" min={0.01} step={0.05} value={draft.max_run_usd} onChange={(e) => set({ max_run_usd: num(e.target.value, draft.max_run_usd) })} style={{ width: 64 }} />
        </label>
        <label className="field">
          <label>Monthly $</label>
          <input type="number" min={0} step={1} value={draft.monthly_budget_usd} onChange={(e) => set({ monthly_budget_usd: num(e.target.value, draft.monthly_budget_usd) })} style={{ width: 64 }} />
        </label>
      </div>
      <div className="setting">
        <div className="grow">
          <div className="label">Retries and timeout</div>
          <div className="muted small">Rate limits, overloads and server errors are retried with exponential backoff. Other errors fail at once.</div>
        </div>
        <label className="field">
          <label>Attempts</label>
          <select value={draft.max_attempts} onChange={(e) => set({ max_attempts: Number(e.target.value) })}>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <label>Timeout</label>
          <select value={draft.timeout_secs} onChange={(e) => set({ timeout_secs: Number(e.target.value) })}>
            {[60, 120, 180, 300].map((n) => (
              <option key={n} value={n}>
                {n}s
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="setting">
        <div className="grow">
          <div className="label">Safety fallback</div>
          <div className="muted small">If Claude's safety filters decline a request (security repositories sometimes trigger them), Anthropic retries it on another model and the run records which one answered.</div>
        </div>
        <input type="checkbox" className="toggle" checked={draft.refusal_fallback} onChange={(e) => set({ refusal_fallback: e.target.checked })} />
      </div>
      <div className="setting">
        <div className="grow">
          <div className="label">Scheduled analysis</div>
          <div className="muted small">
            Re-checks assigned repositories on an interval, <b>only while the app is open</b>. Unchanged repositories are reused without a Claude call; new data costs up to {usd(draft.max_run_usd)} per repository, within the monthly budget.
          </div>
        </div>
        <label className="field">
          <select value={draft.schedule.interval_hours} onChange={(e) => set({ schedule: { ...draft.schedule, interval_hours: Number(e.target.value) } })}>
            {[6, 12, 24, 72, 168].map((h) => (
              <option key={h} value={h}>
                every {h < 24 ? `${h} h` : `${h / 24} day${h > 24 ? "s" : ""}`}
              </option>
            ))}
          </select>
        </label>
        <input
          type="checkbox"
          className="toggle"
          checked={draft.schedule.enabled}
          onChange={(e) => {
            if (e.target.checked) setConsenting(true);
            else set({ schedule: { ...draft.schedule, enabled: false, consent_at: null } });
          }}
          aria-label="Scheduled analysis"
        />
      </div>
      {consenting && (
        <div className="setting">
          <div className="notice grow">
            <span>
              Turn on unattended runs for {draft.assigned.length} assigned repositor{draft.assigned.length === 1 ? "y" : "ies"} every {draft.schedule.interval_hours} hours? They send repository data to Anthropic and spend API credit without asking each time.
            </span>
          </div>
          <button
            className="btn primary"
            onClick={() => {
              const next = { ...draft, schedule: { ...draft.schedule, enabled: true, consent_at: new Date().toISOString() } };
              setDraft(next);
              setConsenting(false);
              void save(next);
            }}
          >
            Turn on
          </button>
          <button className="text-btn" onClick={() => setConsenting(false)}>
            Cancel
          </button>
        </div>
      )}
      <div className="setting" style={{ alignItems: "flex-start" }}>
        <div className="grow">
          <div className="label">Assigned repositories</div>
          <div className="muted small">Analyzing a repository assigns it. Only assigned repositories are ever scheduled.</div>
          <div className="chips" style={{ marginTop: 8 }}>
            {draft.assigned.length === 0 && <span className="muted small">None yet</span>}
            {draft.assigned.map((r) => (
              <span key={r} className="chip">
                {r}
                <button className="chip-x" aria-label={`Unassign ${r}`} onClick={() => set({ assigned: draft.assigned.filter((x) => x !== r) })}>
                  <Icon name="close" size={11} />
                </button>
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="setting">
        <div className="grow">{error ? <div className="notice bad">{error}</div> : <span className="muted small">{saved ? "Saved." : changed ? "Unsaved changes." : "Settings are stored on this Mac."}</span>}</div>
        <button className="btn" disabled={!changed} onClick={() => setDraft(config)}>
          Revert
        </button>
        <button className="btn primary" disabled={!changed} onClick={() => void save()}>
          Save
        </button>
      </div>
    </>
  );
}
