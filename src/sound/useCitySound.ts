import { useCallback, useEffect, useRef, useState } from "react";
import { usePageVisible } from "../lib/power";
import { eventsForRuntimes, loadSoundPrefs, saveSoundPrefs, type CityEventKind, type RuntimeLike, type SoundPrefs } from "./citySound";
import type { PlazaEvent } from "../plaza/plazaState";
import { audioSupported, cityAudio } from "./engine";

export interface CitySound extends SoundPrefs {
  supported: boolean;
  toggle: () => void;
  setVolume: (v: number) => void;
  /** The latest event sound, for the button's ripple; changes on every event. */
  lastEvent: { kind: CityEventKind; n: number } | null;
}

/**
 * Runs the city soundscape for the map: starts muted on a first visit, remembers the choice,
 * plays only while the city view is open and the tab is visible, and turns real changes in
 * agents' runtime states into automation sounds.
 */
export function useCitySound({ active, night, traffic, runtimes, projectOf, plaza }: {
  active: boolean;
  night: boolean;
  traffic: boolean;
  runtimes: ReadonlyMap<string, RuntimeLike>;
  projectOf: (agentId: string) => string | undefined;
  /** Atlas Automation Plaza: its latest event, and whether its rings are turning. */
  plaza?: { event: PlazaEvent | null; moving: boolean; anchorKey: string };
}): CitySound {
  const [prefs, setPrefs] = useState<SoundPrefs>(loadSoundPrefs);
  const [lastEvent, setLastEvent] = useState<CitySound["lastEvent"]>(null);
  const visible = usePageVisible();
  const supported = audioSupported();
  const playing = supported && prefs.on && active && visible;

  useEffect(() => {
    if (!supported) return;
    const engine = cityAudio();
    if (playing) engine.start();
    else if (engine.playing) engine.stop();
  }, [playing, supported]);
  useEffect(() => () => { if (supported) cityAudio().stop(); }, [supported]);

  useEffect(() => {
    if (!supported) return;
    const engine = cityAudio();
    engine.setNight(night);
    engine.setTraffic(traffic);
  }, [night, traffic, supported]);

  useEffect(() => {
    if (!supported) return;
    cityAudio().setVolume(prefs.volume);
  }, [prefs.volume, supported]);

  useEffect(() => {
    if (!supported) return;
    let n = 0;
    const engine = cityAudio();
    engine.onEvent = (kind) => setLastEvent({ kind, n: ++n });
    return () => {
      engine.onEvent = null;
    };
  }, [supported]);

  // Real transitions only: the first reading after load is the baseline, never a sound.
  const prev = useRef<ReadonlyMap<string, RuntimeLike> | null>(null);
  const finished = useRef(new Map<string, { agentId: string; at: number }>());
  const projectRef = useRef(projectOf);
  projectRef.current = projectOf;
  useEffect(() => {
    const events = eventsForRuntimes(prev.current, runtimes, (id) => projectRef.current(id), finished.current, Date.now());
    prev.current = runtimes;
    if (!playing) return;
    const engine = cityAudio();
    for (const e of events) engine.play(e);
  }, [runtimes, playing]);

  // The plaza's rings hum while they turn; its task and n8n events chime at the plaza. Agent-run
  // events already sound at their building above, so the plaza doesn't play them twice.
  const plazaMoving = !!plaza?.moving;
  const plazaKey = plaza?.anchorKey ?? null;
  useEffect(() => {
    if (!supported) return;
    cityAudio().setPlazaMotion(plazaMoving && playing, plazaKey);
  }, [plazaMoving, plazaKey, playing, supported]);
  const plazaEvent = plaza?.event ?? null;
  useEffect(() => {
    if (!supported || !playing || !plazaEvent || plazaEvent.source === "agent" || !plazaKey) return;
    cityAudio().play({ kind: plazaEvent.kind, agentId: plazaEvent.agentId, anchorKey: plazaKey });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per event
  }, [plazaEvent]);

  const toggle = useCallback(() => {
    const next = { ...prefs, on: !prefs.on };
    setPrefs(next);
    saveSoundPrefs(next);
    // Start or silence inside the click itself, so the browser allows audio and muting is instant.
    if (!supported) return;
    if (next.on && active) cityAudio().start();
    else if (!next.on) cityAudio().stop();
  }, [prefs, supported, active]);

  const setVolume = useCallback((v: number) => {
    setPrefs((p) => {
      const next = { ...p, volume: v };
      saveSoundPrefs(next);
      return next;
    });
  }, []);

  return { ...prefs, supported, toggle, setVolume, lastEvent };
}
