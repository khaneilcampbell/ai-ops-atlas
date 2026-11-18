import type * as THREE from "three";

/**
 * Where the city sound hears from: the 3D map registers its camera, scene and building positions
 * here while it is mounted (CitySoundBridge in Map3D), and the sound engine reads them a few times
 * a second. Nothing here draws or allocates per frame.
 */
export interface SoundScene {
  camera: THREE.Camera;
  scene: THREE.Object3D;
  /** A building's position by map key (agent:…, project:…), or null when it isn't on the map. */
  anchor: (key: string) => { x: number; y: number; z: number } | null;
}

let current: SoundScene | null = null;

export function setSoundScene(s: SoundScene | null) {
  current = s;
}

export function soundScene(): SoundScene | null {
  return current;
}

/** Objects the engine gives a moving sound to, tagged by the scene (userData.citySound). A jet's tag also
 * carries `ground`, written by its frame loop, so the engine knows when it rolls, lifts off and touches down. */
export type SoundTag = "aircraft" | "train";
export const SOUND_TAG_KEY = "citySound";

/** Places with their own sound up close, tagged on the group that draws them (userData.citySoundZone). */
export type ZoneKind = "airport" | "station" | "marina" | "stadium" | "park";
export const ZONE_TAG_KEY = "citySoundZone";
/** One tag object per kind, so wrapping a place in `<group userData={SOUND_ZONE.airport}>` allocates nothing. */
export const SOUND_ZONE: Record<ZoneKind, { citySoundZone: ZoneKind }> = {
  airport: { citySoundZone: "airport" },
  station: { citySoundZone: "station" },
  marina: { citySoundZone: "marina" },
  stadium: { citySoundZone: "stadium" },
  park: { citySoundZone: "park" },
};

/**
 * Street cars, written by the map's vehicle loop each frame (living.tsx Vehicles) and read by the
 * engine a few times a second to voice the nearest few. Positions are world x/z; `on` is 0 for a
 * car that is hidden or parked out of sight. Fixed arrays, so the frame loop allocates nothing.
 */
export const CAR_FEED = { n: 0, x: new Float32Array(256), z: new Float32Array(256), on: new Uint8Array(256) };
export function feedCar(i: number, x: number, z: number, on: boolean) {
  if (i >= CAR_FEED.x.length) return;
  CAR_FEED.x[i] = x;
  CAR_FEED.z[i] = z;
  CAR_FEED.on[i] = on ? 1 : 0;
}
