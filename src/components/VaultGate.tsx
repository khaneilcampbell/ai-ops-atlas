import { useEffect, useState, type ReactNode } from "react";
import { AtlasMark } from "./Icon";
import { isTauri } from "../lib/env";
import { vault, type VaultStatus } from "../lib/vault";

/**
 * Holds the app behind a lock screen until the saved keys are unlocked, so every request
 * made at launch already has its token and nothing waits on the Touch ID sheet.
 * With nothing saved there's no prompt and the screen never shows.
 */
export function VaultGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<VaultStatus | null>(isTauri() ? null : { state: "unlocked" });
  const [skipped, setSkipped] = useState(false);

  const unlock = () => {
    setStatus(null);
    vault.unlock().then(setStatus, (e) => setStatus({ state: "declined", error: String(e) }));
  };
  useEffect(() => {
    if (isTauri()) unlock();
  }, []);

  if (status?.state === "unlocked" || skipped) return <>{children}</>;

  const waiting = status === null;
  return (
    <div className="vault-lock">
      <div className="vault-card">
        <div className="brand-mark">
          <AtlasMark />
        </div>
        <h1>AI Ops Atlas</h1>
        {waiting ? (
          <p>Use Touch ID to unlock your saved GitHub and Anthropic keys.</p>
        ) : (
          <>
            <p>{status.error ?? "Your saved keys are still locked."}</p>
            <div className="vault-actions">
              <button className="btn primary" onClick={unlock}>
                Unlock with Touch ID
              </button>
              <button className="btn" onClick={() => setSkipped(true)}>
                Continue without keys
              </button>
            </div>
            <p className="vault-note">Without them Atlas shows public repositories only, and can't run analysis or re-runs.</p>
          </>
        )}
      </div>
    </div>
  );
}

/** Header pill after "Continue without keys": unlocks and reloads so every view picks the keys up. */
export function VaultLockedPill() {
  const [locked, setLocked] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    vault.status().then((s) => setLocked(s.state === "declined"), () => undefined);
  }, []);
  if (!locked) return null;
  const unlock = async () => {
    setBusy(true);
    const s = await vault.unlock().catch(() => null);
    if (s?.state === "unlocked") window.location.reload();
    else setBusy(false);
  };
  return (
    <button className="pill-mode update" onClick={() => void unlock()} disabled={busy} title="Your saved keys are locked. Press to unlock them with Touch ID.">
      <span className="dot" />
      {busy ? "Unlocking…" : "Keys locked, unlock"}
    </button>
  );
}
