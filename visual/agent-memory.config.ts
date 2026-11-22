import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// Agent memory reads /api/data, which only the hosted web build calls, so this check runs a
// VITE_ATLAS_WEB=1 dev server on its own port:
//   npx playwright test -c visual/agent-memory.config.ts
const PORT = 4186;
export default defineConfig({
  ...base,
  testMatch: "agent-memory.web.ts",
  use: { ...base.use, baseURL: `http://localhost:${PORT}` },
  webServer: { command: `npx vite --port ${PORT} --strictPort`, cwd: "..", port: PORT, reuseExistingServer: false, timeout: 60_000, env: { VITE_ATLAS_WEB: "1" } },
});
