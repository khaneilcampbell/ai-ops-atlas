import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri expects a fixed dev port and does not want Vite to clear its output.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420, strictPort: true,
    // Tauri supplies the reachable device address when running on a physical iOS device.
    host: process.env.TAURI_DEV_HOST || false,
    // Generated HTML reports must not force a full reload of an open city during validation.
    watch: { ignored: ["**/playwright-report/**", "**/test-results/**", "**/visual/out/**", "**/artifacts/**"] },
  },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: {
    target: "safari15",
    sourcemap: false,
  },
});
