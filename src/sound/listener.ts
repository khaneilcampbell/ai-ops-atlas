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

/** Objects the engine gives a moving sound to, tagged by the scene (userData.citySound). */
export type SoundTag = "aircraft";
export const SOUND_TAG_KEY = "citySound";
