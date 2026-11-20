import { FREE_TIME_CHOICES, type FreeTimeChoice, type freeTimeAvailability } from "../../routine/freeTime";

/**
 * Where an agent can go on free time, or why it can't go now (routine/freeTime.ts). Shared by the
 * City agents panel and the agent card on the map. Map picture only.
 */
export function FreeTimePicker({ name, availability, onPick }: { name: string; availability: ReturnType<typeof freeTimeAvailability>; onPick(kind: FreeTimeChoice): void }) {
  return (
    <div className="ca-freetime" role="group" aria-label={`Free time for ${name}`}>
      {availability.ok ? (
        <>
          <p className="sub">Where should {name} go?</p>
          <div className="ca-freechoices">
            {FREE_TIME_CHOICES.map((c) => (
              <button key={c.kind} type="button" onClick={() => onPick(c.kind)}>
                {c.label}
              </button>
            ))}
          </div>
        </>
      ) : (
        <p className="sub">{availability.reason}</p>
      )}
      <p className="sub hint">Only changes the map picture. Runs, schedules, workflows and permissions stay as they are.</p>
    </div>
  );
}
