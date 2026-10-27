import type { SymbolName } from "./symbols";

/**
 * How a project's headquarters looks on the 3D map: the symbol on its signs, its architecture
 * and an accent color. Derived only from catalog metadata (id, name, repository, tags), so a
 * new project gets a sensible identity without any configuration.
 */
export type BuildingStyle = "tech" | "secure" | "timber" | "classic" | "glass";

export interface BuildingIdentity {
  symbol: SymbolName;
  style: BuildingStyle;
  accent: string;
  /** The map's centerpiece: taller, broader and crowned with a lantern and spire. */
  landmark?: boolean;
}

export interface IdentitySource {
  id: string;
  name: string;
  repository: string;
  tags: readonly string[];
}

interface Rule {
  match: (p: { words: Set<string>; text: string; profile: boolean; id: string }) => boolean;
  identity: BuildingIdentity | ((p: { words: Set<string> }) => BuildingIdentity);
}

const any = (words: Set<string>, ...w: string[]) => w.some((x) => words.has(x));

// First match wins, most specific first.
const RULES: Rule[] = [
  // A user's profile repository is named after the user (owner/owner).
  { match: (p) => p.profile || p.words.has("profile"), identity: { symbol: "github", style: "tech", accent: "#4fb8c9" } },
  { match: (p) => p.id === "ai-ops-atlas", identity: { symbol: "atlas", style: "timber", accent: "#c9a35a", landmark: true } },
  {
    match: (p) => any(p.words, "soc", "security", "detection-engineering", "splunk", "siem") || /\b(security|detection)\b/.test(p.text),
    identity: { symbol: "shield", style: "secure", accent: "#2d4f8f" },
  },
  {
    match: (p) => p.words.has("benjaire"),
    identity: ({ words }) => ({
      symbol: words.has("dashboard") ? "chart" : words.has("planning") ? "compass" : "monogram",
      style: "classic",
      accent: "#b8893b",
    }),
  },
  { match: (p) => any(p.words, "portfolio", "static-site", "website"), identity: { symbol: "globe", style: "glass", accent: "#3f8f6b" } },
  { match: (p) => any(p.words, "career", "jobs", "resume"), identity: { symbol: "briefcase", style: "tech", accent: "#8a78e0" } },
  { match: (p) => any(p.words, "crewai", "multi-agent", "commerce", "shopify"), identity: { symbol: "nodes", style: "glass", accent: "#d9783f" } },
  { match: (p) => any(p.words, "dashboard", "analytics", "itsm"), identity: { symbol: "chart", style: "glass", accent: "#3f7fc0" } },
  { match: (p) => any(p.words, "documentation", "docs", "knowledge"), identity: { symbol: "book", style: "tech", accent: "#6a9f5a" } },
];

const FALLBACK: BuildingIdentity = { symbol: "sparkles", style: "glass", accent: "#5f8f7a" };

export function identityFor(p: IdentitySource): BuildingIdentity {
  const [owner, repo] = p.repository.toLowerCase().split("/");
  const words = new Set([...p.tags.map((t) => t.toLowerCase()), ...p.id.toLowerCase().split(/[-_]/), ...p.name.toLowerCase().split(/[^a-z0-9]+/)]);
  const ctx = { words, text: `${p.name} ${p.repository}`.toLowerCase(), profile: !!owner && owner === repo, id: p.id };
  for (const r of RULES) if (r.match(ctx)) return typeof r.identity === "function" ? r.identity(ctx) : r.identity;
  return FALLBACK;
}
