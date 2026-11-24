import { useEffect, useMemo, useRef } from "react";
import { useThree } from "@react-three/fiber";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { useAtlas } from "../../state";
import { useTasks } from "../../tasks/store";
import { OPEN } from "../../tasks/lifecycle";
import { focusTasks } from "../../tasks/focus";
import { libraryAvailability, openLibrary } from "../../library/client";
import { AgentAvatar } from "../../components/AgentIdentity";
import { circaFloorNumber } from "./circaFloors";
import type { CircaResidentNow } from "./CircaWalkers";
import { leaveBuilding } from "./store";
import { blendPose, type Vec3 } from "./residenceVisitPrefs";

/** How long the camera glides to an apartment and back. Reduce motion jumps instead. */
const GLIDE_MS = 650;

export type CameraGoal = { position: Vec3; target: Vec3; key: string } | null;

/**
 * Moves the interior camera to `goal` whenever a new goal is set: a short glide, or a jump with Reduce motion on.
 * One animation frame loop at a time, cancelled when the goal changes or the building closes, so repeated visits
 * leave nothing running.
 */
export function VisitCamera({ goal, reduced }: { goal: CameraGoal; reduced: boolean }) {
  const { camera, invalidate } = useThree();
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  // The goal's key names the move; a new object with the same key is the same move, so it isn't replayed.
  const latest = useRef(goal);
  latest.current = goal;
  const key = goal?.key ?? null;
  useEffect(() => {
    const goal = latest.current;
    if (!key || !goal || !controls) return;
    const apply = (p: { position: Vec3; target: Vec3 }) => {
      camera.position.set(...p.position);
      controls.target.set(...p.target);
      controls.update();
      invalidate();
    };
    if (reduced) return apply(goal);
    const from = { position: camera.position.toArray() as Vec3, target: controls.target.toArray() as Vec3 };
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const t = (now - start) / GLIDE_MS;
      apply(blendPose(from, goal, t));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [key, controls, reduced, camera, invalidate]);
  return null;
}

const TOWER = { west: "West", east: "East" } as const;

/**
 * The workspace shown while visiting an apartment: whose suite it is, and shortcuts to that agent's existing Atlas
 * pages (profile, project, tasks, saved outputs). Each shortcut leaves the building for that page; anything with no
 * data says so instead of opening an empty page.
 */
export function ResidenceVisitPanel({ resident, folded, onFold, onBack }: { resident: CircaResidentNow; folded: boolean; onFold: () => void; onBack: () => void }) {
  const { catalog, setView, select } = useAtlas();
  const tasks = useTasks();
  const agent = catalog.agents.find((a) => a.id === resident.id);
  const project = agent ? catalog.projects.find((p) => p.id === agent.projectId) : undefined;
  const open = useMemo(() => tasks.filter((t) => t.agentId === resident.id && OPEN.has(t.status)).length, [tasks, resident.id]);
  const library = libraryAvailability();
  const { home, identity } = resident;
  const go = (then: () => void) => {
    leaveBuilding(true);
    then();
  };
  return (
    <aside className={`residence-visit${folded ? " folded" : ""}`} aria-label={`Suite ${home.unit}, ${identity.name}`}>
      <header>
        <AgentAvatar identity={identity} size={40} />
        <div>
          <small>{`Suite ${home.unit} · ${TOWER[home.tower]} tower · Floor ${circaFloorNumber(home.level)}`}</small>
          <h3>{identity.name}</h3>
          <span>{identity.role}</span>
        </div>
        <button className="residence-visit-fold" onClick={onFold} aria-expanded={!folded} aria-label={folded ? "Show workspace" : "Hide workspace"}>{folded ? "▴" : "▾"}</button>
      </header>
      {!folded && (
        <>
          <div className="section-title">Workspace</div>
          <ul className="residence-visit-links">
            <li>
              <button disabled={!agent} onClick={() => go(() => { setView("agents"); select({ kind: "agent", id: resident.id }); })}>Agent profile</button>
              <span>{agent ? "Run status, history and links" : "Not in the catalog"}</span>
            </li>
            <li>
              <button disabled={!project} title={project?.name} onClick={() => project && go(() => { setView("repos"); select({ kind: "project", id: project.id }); })}>{project ? project.name : "Project"}</button>
              <span>{project ? "Project and repository" : "No project linked"}</span>
            </li>
            <li>
              <button onClick={() => go(() => { focusTasks({ agent: resident.id }); setView("tasks"); })}>Tasks</button>
              <span>{open ? `${open} open in Task Center` : "No open tasks"}</span>
            </li>
            <li>
              <button disabled={!library.ok} onClick={() => go(openLibrary)}>Saved outputs</button>
              <span title={library.ok ? undefined : library.message}>{library.ok ? "Output Library, every agent's files" : "Only on the hosted Atlas page"}</span>
            </li>
          </ul>
          <p className="muted small residence-visit-note">Visiting is a view of the apartment, not a status. Whether this agent is running is on its Agent profile.</p>
        </>
      )}
      <button className="residence-visit-back" onClick={onBack}>← Back to building</button>
    </aside>
  );
}
