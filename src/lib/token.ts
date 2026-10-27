import { isHostedWeb, isTauri } from "./env";

// The token is handed to the Rust side once and stored in the macOS Keychain.
// The web view can ask whether one exists, but can never read it back.
async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

// The hosted web build keeps its token in a Cloudflare secret and only reports whether one is set.
async function webStatus(): Promise<boolean> {
  const r = await fetch("/api/status", { credentials: "same-origin" });
  if (!r.ok) return false;
  return ((await r.json()) as { token?: boolean }).token === true;
}

export const tokenStore = {
  available: isTauri,
  has: () => (isTauri() ? call<boolean>("github_token_status") : isHostedWeb() ? webStatus() : Promise.resolve(false)),
  set: (token: string) => call<void>("github_token_set", { token }),
  clear: () => call<void>("github_token_clear"),
};
