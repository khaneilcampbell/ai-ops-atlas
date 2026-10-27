export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * The hosted web build (Cloudflare Pages) reads GitHub through its own `/api/github`
 * function, which holds a read-only token on the server. Set at build time with
 * `VITE_ATLAS_WEB=1`; plain `vite dev` stays anonymous.
 */
export function isHostedWeb(): boolean {
  return !isTauri() && import.meta.env.VITE_ATLAS_WEB === "1";
}
