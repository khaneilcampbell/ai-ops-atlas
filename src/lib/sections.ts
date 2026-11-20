import type { IconName } from "../components/Icon";
import type { View } from "../state";

export interface SectionTab { view: View; label: string }
export interface Section { id: string; label: string; icon: IconName; tabs: SectionTab[] }

/**
 * Where every page lives. The left sidebar shows Business, Agents, Intel and Settings; Projects,
 * Mission Control and Grid live in the top switch. A section with more than one page shows its
 * pages as tabs above the content. View ids are unchanged, so saved views and links keep working.
 */
export const SECTIONS: Section[] = [
  { id: "map", label: "Projects", icon: "map", tabs: [{ view: "map", label: "Projects" }] },
  { id: "overview", label: "Mission", icon: "overview", tabs: [{ view: "overview", label: "Overview" }, { view: "tasks", label: "Task Center" }, { view: "activity", label: "Activity" }] },
  { id: "grid", label: "Grid", icon: "grid", tabs: [{ view: "grid", label: "Grid" }] },
  { id: "business", label: "Business", icon: "briefcase", tabs: [{ view: "business", label: "Business" }] },
  { id: "agents", label: "Agents", icon: "agents", tabs: [{ view: "agents", label: "Directory" }, { view: "automations", label: "Automations" }] },
  { id: "intel", label: "Intel", icon: "spark", tabs: [{ view: "intel", label: "Intelligence" }, { view: "review", label: "Engineering Review" }, { view: "repos", label: "Repositories" }, { view: "usage", label: "API Usage" }] },
  { id: "settings", label: "Settings", icon: "settings", tabs: [{ view: "workspace", label: "Workspace" }, { view: "settings", label: "Connections" }, { view: "preferences", label: "Preferences" }] },
];

/** The sections the left sidebar lists; the rest open from the top switch. */
export const SIDEBAR_SECTIONS = SECTIONS.filter((s) => ["business", "agents", "intel", "settings"].includes(s.id));

/** Pages that open from inside another page and keep its section highlighted. */
const OPENED_FROM: Partial<Record<View, View>> = { workflows: "overview" };

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
