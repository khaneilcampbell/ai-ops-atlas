import { buildCatalog } from "./parse";

// Manifests in /catalog are bundled at build time. Add a YAML file there to register a project.
const files = import.meta.glob("../../catalog/*.yaml", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

const named = Object.fromEntries(Object.entries(files).map(([path, text]) => [path.split("/").pop()!, text]));

export const { catalog, issues: manifestIssues } = buildCatalog(named);
export * from "./types";
