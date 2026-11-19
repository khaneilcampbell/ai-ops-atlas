import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// Owning agents and their n8n workflows, as the hosted page shows them (it reads /api/n8n). A
// VITE_ATLAS_WEB=1 dev server on its own port: npx playwright test -c visual/agent-n8n.config.ts
const PORT = 4186;
export default defineConfig({
  ...base,
  testMatch: "agent-n8n.web.ts",
  use: { ...base.use, baseURL: `http://localhost:${PORT}` },
  webServer: { command: `npx vite --port ${PORT} --strictPort`, cwd: "..", port: PORT, reuseExistingServer: false, timeout: 60_000, env: { VITE_ATLAS_WEB: "1" } },
});
