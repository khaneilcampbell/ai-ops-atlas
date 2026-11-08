import { configDefaults, defineConfig } from "vitest/config";

// The standalone dashboard keeps its Node test runner and locked dependencies.
export default defineConfig({
  test: { exclude: [...configDefaults.exclude, "apps/benjaire-dashboard/**"] },
});
