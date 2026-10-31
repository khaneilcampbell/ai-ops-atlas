import { defineConfig } from "@playwright/test";

// Visual checks for the web build. See docs/visual-testing.md.
const PORT = Number(process.env.ATLAS_VISUAL_PORT ?? 4173);

export default defineConfig({
  testDir: ".",
  testMatch: "*.visual.ts",
  outputDir: "../test-results",
  // Fonts and software rendering differ a little between machines, so each keeps its own set.
  snapshotPathTemplate: `{testDir}/baselines/${process.env.CI ? "ci" : "local"}/{arg}{ext}`,
  // One WebGL page at a time: software rendering is CPU heavy, and parallel pages slow each other.
  workers: 1,
  timeout: 300_000,
  reporter: [["list"], ["html", { open: "never", outputFolder: "../playwright-report" }]],
  expect: {
    toHaveScreenshot: {
      // Software WebGL is not bit-exact between runs; allow small antialiasing noise, flag real changes.
      threshold: 0.2,
      maxDiffPixelRatio: 0.01,
      animations: "disabled",
      caret: "hide",
      // Full 2x pixels, not scaled down to CSS size.
      scale: "device",
      timeout: 120_000,
    },
  },
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1512, height: 900 },
    deviceScaleFactor: 2,
    locale: "en-US",
    timezoneId: "UTC",
    colorScheme: "light",
    // Camera moves jump instead of glide, so a few frames are enough to settle a view.
    reducedMotion: "reduce",
    launchOptions: {
      // Headless Chromium has no GPU here; SwiftShader gives it a real WebGL context.
      args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
    },
  },
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    cwd: "..",
    port: PORT,
    reuseExistingServer: !process.env.ATLAS_VISUAL_PORT,
    timeout: 60_000,
  },
});
