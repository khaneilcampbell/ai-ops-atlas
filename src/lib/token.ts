import { isTauri } from "./env";

// The token is handed to the Rust side once and stored in the macOS Keychain.
// The web view can ask whether one exists, but can never read it back.
async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export const tokenStore = {
  available: isTauri,
  has: () => (isTauri() ? call<boolean>("github_token_status") : Promise.resolve(false)),
  set: (token: string) => call<void>("github_token_set", { token }),
  clear: () => call<void>("github_token_clear"),
};
