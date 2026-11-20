import type { IconName } from "../components/Icon";
import type { View } from "../state";

export interface SectionTab { view: View; label: string }
export interface Section { id: string; label: string; icon: IconName; tabs: SectionTab[] }

/**
 * Where every page lives. The left sidebar shows, in this order, Projects, Agents, Automations, Tasks, Workspace, Intel, Grid and Settings;
 * Projects, Mission Control and Business are in the top switch (Business swapped places with Grid). A section with more than one page shows its
 * pages as tabs above the content. View ids are unchanged, so saved views and links keep working.
 */
export const SECTIONS: Section[] = [
  { id: "map", label: "Projects", icon: "map", tabs: [{ view: "map", label: "Projects" }] },
  { id: "overview", label: "Mission", icon: "overview", tabs: [{ view: "overview", label: "Overview" }] },
  { id: "grid", label: "Grid", icon: "grid", tabs: [{ view: "grid", label: "Grid" }] },
  { id: "business", label: "Business", icon: "briefcase", tabs: [{ view: "business", label: "Business" }] },
  // Task Center, listed as Tasks in the left sidebar.
  { id: "tasks", label: "Tasks", icon: "tasks", tabs: [{ view: "tasks", label: "Tasks" }] },
  { id: "agents", label: "Agents", icon: "agents", tabs: [{ view: "agents", label: "Agents" }] },
  { id: "automations", label: "Automations", icon: "network", tabs: [{ view: "automations", label: "Automations" }] },
  { id: "intel", label: "Intel", icon: "spark", tabs: [{ view: "intel", label: "Intelligence" }, { view: "review", label: "Engineering Review" }, { view: "repos", label: "Repositories" }, { view: "activity", label: "Activity" }, { view: "intel-api", label: "API" }] },
  { id: "workspace", label: "Workspace", icon: "compass", tabs: [{ view: "workspace", label: "Workspace" }] },
  { id: "settings", label: "Settings", icon: "settings", tabs: [{ view: "settings", label: "Connections" }, { view: "preferences", label: "Preferences" }] },
];

/** The sections the left sidebar lists; Mission Control and Business open from the top switch. */
export const SIDEBAR_SECTIONS = ["map", "agents", "automations", "tasks", "workspace", "intel", "grid", "settings"].map((id) => SECTIONS.find((s) => s.id === id)!);

/** Pages that open from inside another page and keep its section highlighted. */
// "api-github" was its own tab; GitHub requests now share the Claude costs page.
// Provider usage and Claude & GitHub open from Intel → API (the API Usage sidebar entry was removed);
// "api-github" was once its own tab.
const OPENED_FROM: Partial<Record<View, View>> = { workflows: "overview", usage: "intel-api", "api-costs": "intel-api", "api-github": "intel-api" };

/** The section a view belongs to. Unknown views fall back to Projects. */
export function sectionOf(view: View): Section {
  const v = OPENED_FROM[view] ?? view;
  return SECTIONS.find((s) => s.tabs.some((t) => t.view === v)) ?? SECTIONS[0];
}

/** The tab to highlight for a view inside its section. */
export const tabOf = (view: View): View => OPENED_FROM[view] ?? view;

/** The page a section opens on: the tab used last in this session, else its first tab. */
export function sectionEntry(section: Section, last: Partial<Record<string, View>>): View {
  const remembered = last[section.id];
  return remembered && section.tabs.some((t) => t.view === remembered) ? remembered : section.tabs[0].view;
}
