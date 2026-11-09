import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { FAR_PX, chooseFar, pickDetail, screenRadius } from "./farDetail";

describe("far detail", () => {
  it("measures a sphere's on-screen radius", () => {
    // fov 90: half the screen height spans the distance, so r = d covers half the screen.
    expect(screenRadius(10, 10, 90, 800)).toBeCloseTo(400);
    expect(screenRadius(1, 0, 50, 800)).toBe(Infinity);
  });

  it("switches with a margin so a resting camera doesn't flicker", () => {
    expect(chooseFar(false, FAR_PX - 0.1)).toBe(true);
    expect(chooseFar(false, FAR_PX + 0.1)).toBe(false);
    expect(chooseFar(true, FAR_PX + 0.1)).toBe(true);
    expect(chooseFar(true, FAR_PX * 2)).toBe(false);
  });

  it("draws full detail up close and the far shape from the overview", () => {
    const full = new THREE.IcosahedronGeometry(1, 2), far = new THREE.IcosahedronGeometry(1, 1);
    const mesh = new THREE.InstancedMesh(full, new THREE.MeshBasicMaterial(), 2);
    mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(-10, 0, 0));
    mesh.setMatrixAt(1, new THREE.Matrix4().makeTranslation(10, 0, 0));
    mesh.computeBoundingBox();
    mesh.updateMatrixWorld();
    const gl = { getDrawingBufferSize: (v: THREE.Vector2) => v.set(2000, 1600) } as unknown as THREE.WebGLRenderer;
    const cam = new THREE.PerspectiveCamera(40);
    cam.position.set(0, 3, 0);
    expect(pickDetail(mesh, full, far, 0.4, cam, gl)).toBe(full);
    cam.position.set(0, 200, 0);
    expect(pickDetail(mesh, full, far, 0.4, cam, gl)).toBe(far);
    // A parent that scales the set up counts too.
    const parent = new THREE.Group();
    parent.scale.setScalar(50);
    parent.add(mesh);
    parent.updateMatrixWorld();
    cam.position.set(0, 2000, 0);
    expect(pickDetail(mesh, full, far, 0.4, cam, gl)).toBe(full);
    expect(pickDetail(mesh, full, far, 0.4, new THREE.OrthographicCamera(), gl)).toBe(full);
  });
});
