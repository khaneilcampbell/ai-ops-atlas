import { useEffect } from "react";
import { Icon, type IconName } from "./Icon";
import { useAtlas, type View } from "../state";

const MODES: { view: View; label: string; icon: IconName; key: string; description: string }[] = [
  { view: "map", label: "Projects", icon: "map", key: "1", description: "Explore the city" },
  { view: "overview", label: "Mission Control", icon: "overview", key: "2", description: "Prioritized work" },
  { view: "grid", label: "Grid", icon: "grid", key: "3", description: "Compare repositories" },
];

/** Three layouts of the same workspace. ⌘1, ⌘2 and ⌘3 switch between them from anywhere. */
export function ViewSwitch() {
  const { view, setView } = useAtlas();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      const m = MODES.find((x) => x.key === e.key);
      if (!m) return;
      e.preventDefault();
      setView(m.view);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setView]);

  return (
    <div className="view-switch" role="group" aria-label="Workspace layout">
      {MODES.map((m) => (
        <button key={m.view} className={view === m.view ? "on" : ""} aria-pressed={view === m.view} onClick={() => setView(m.view)} title={`${m.label}: ${m.description} (⌘${m.key})`} aria-label={m.label}>
          <Icon name={m.icon} size={14} />
          <span className="view-description"><b>{m.label}</b><small>{m.description}</small></span>
        </button>
      ))}
    </div>
  );
}
