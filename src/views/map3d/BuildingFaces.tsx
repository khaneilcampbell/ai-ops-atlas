import { AgentAvatar } from "../../components/AgentIdentity";
import { useAtlas } from "../../state";
import type { BuildingOccupants, Occupant, OccupantGroup } from "./buildingOccupants";
import { selectCityAgent } from "./cityAgentsStore";

/** Faces shown in a group before the rest fold into "+N": three lines of six, enough for every named agent. */
export const MAX_FACES = 18;

/**
 * The agents who work or live in a building, as small portraits over its nameplate (hover on a
 * desktop, tap on a phone). Placement only: it says where an agent's job and apartment are, never
 * that it is inside now. Clicking a face opens that agent's card on the map when it walks the city,
 * otherwise its profile.
 */
export function BuildingFaces({ occupants, onMap }: { occupants: BuildingOccupants; onMap: ReadonlySet<string> }) {
  const { select } = useAtlas();
  const open = (o: Occupant) => {
    if (onMap.has(o.personaId)) selectCityAgent(o.personaId);
    else select({ kind: "agent", id: o.personaId });
  };
  return (
    // Its own box above the plaque, joined to it by padding so the pointer can move up without the hover ending.
    <div className="m3-faces" role="group" aria-label="Agents in this building" onClick={(e) => e.stopPropagation()}>
      <div className="m3-faces-card">
        <Row label="Works here" group={occupants.works} open={open} />
        <Row label="Lives here" group={occupants.lives} open={open} />
        <div className="m3-faces-note">Where they work and live · not live activity</div>
      </div>
    </div>
  );
}

function Row({ label, group, open }: { label: string; group: OccupantGroup; open: (o: Occupant) => void }) {
  if (!group.people.length && !group.others) return null;
  const shown = group.people.slice(0, MAX_FACES);
  const more = group.people.length - shown.length + group.others;
  const moreTitle = `${more} more ${more === 1 ? "agent" : "agents"}${group.others ? ", including helpers and automations run by the agents shown" : ""}`;
  return (
    <div className="m3-faces-row">
      <span className="m3-faces-label">{label}</span>
      <div className="m3-faces-list">
        {shown.map((o) => (
          <button key={o.personaId} type="button" className="m3-face" title={`${o.identity.name} · ${o.identity.role}`} onClick={() => open(o)}>
            <AgentAvatar identity={o.identity} size={28} />
            <span className="m3-face-name">{o.identity.name.split(" ")[0]}</span>
          </button>
        ))}
        {more > 0 && (
          <span className="m3-face more" title={moreTitle}>
            <span className="m3-face-more">+{more}</span>
          </span>
        )}
      </div>
    </div>
  );
}
