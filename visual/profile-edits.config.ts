import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// Editing an agent's profile text calls /api/data, which only the hosted web build does, so this
// check runs a VITE_ATLAS_WEB=1 dev server on its own port:
//   npx playwright test -c visual/profile-edits.config.ts
const PORT = 4187;
export default defineConfig({
  ...base,
  testMatch: "profile-edits.web.ts",
  use: { ...base.use, baseURL: `http://localhost:${PORT}` },
  webServer: { command: `npx vite --port ${PORT} --strictPort`, cwd: "..", port: PORT, reuseExistingServer: false, timeout: 60_000, env: { VITE_ATLAS_WEB: "1" } },
});
