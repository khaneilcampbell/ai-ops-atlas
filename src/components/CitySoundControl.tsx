import { useEffect, useState } from "react";
import type { CitySound } from "../sound/useCitySound";
import { Icon } from "./Icon";

/**
 * The map toolbar's speaker: turns the city soundscape on and off, with a volume slider beside
 * it while sound is on. Hover or keyboard focus shows "City sound on" or "City sound off".
 */
export function CitySoundControl({ sound, reduced }: { sound: CitySound; reduced: boolean }) {
  const { on, volume, supported, toggle, setVolume, lastEvent } = sound;
  const label = !supported ? "City sound isn't available in this browser" : on ? "City sound on" : "City sound off";
  // A soft ring on the speaker when an automation sound plays; none with Reduce motion.
  const [pulse, setPulse] = useState(false);
  useEffect(() => {
    if (!lastEvent || reduced) return;
    setPulse(true);
    const t = setTimeout(() => setPulse(false), 900);
    return () => clearTimeout(t);
  }, [lastEvent, reduced]);
  return (
    <div className={`city-sound${on ? " on" : ""}`}>
      <button
        type="button"
        className={`icon-btn${on ? " on" : ""}${pulse ? " pulse" : ""}`}
        onClick={toggle}
        aria-pressed={on}
        aria-label="City sound"
        aria-describedby="city-sound-tip"
        disabled={!supported}
      >
        <Icon name={on ? "speaker" : "speaker-off"} size={17} />
      </button>
      <span className="city-sound-tip" id="city-sound-tip" role="tooltip">{label}</span>
      {on && (
        <input
          className="city-sound-volume"
          type="range"
          min={0}
          max={100}
          step={5}
          value={Math.round(volume * 100)}
          onChange={(e) => setVolume(Number(e.target.value) / 100)}
          aria-label="City sound volume"
          aria-valuetext={`${Math.round(volume * 100)}%`}
        />
      )}
    </div>
  );
}
