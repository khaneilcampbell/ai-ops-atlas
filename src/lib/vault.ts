import { isTauri } from "./env";

// The saved keys are unlocked once per launch with Touch ID, on the Rust side.
// The web view only learns whether that worked; it never sees the keys.
export type VaultState = "locked" | "unlocked" | "declined";
export interface VaultStatus {
  state: VaultState;
  error?: string | null;
}

async function call<T>(cmd: string): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd);
}

export const vault = {
  status: () => (isTauri() ? call<VaultStatus>("vault_status") : Promise.resolve<VaultStatus>({ state: "unlocked" })),
  /** Shows the Touch ID sheet if anything is saved, and resolves once it's answered. */
  unlock: () => (isTauri() ? call<VaultStatus>("vault_unlock") : Promise.resolve<VaultStatus>({ state: "unlocked" })),
};
