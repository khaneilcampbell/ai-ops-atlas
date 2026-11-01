import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

/** Own every offscreen pass, including resources EffectComposer.dispose does not release. */
export function createBloomPipeline(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
  const composer = new EffectComposer(gl);
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0, 0.35, 0.9);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const size = new THREE.Vector2();
  let width = -1, height = -1, ratio = -1;
  let disposed = false;
  return {
    composer, bloom,
    /** The governor can change DPR without a window resize. Never retain the old Retina targets. */
    resize() {
      gl.getSize(size);
      const dpr = gl.getPixelRatio();
      if (dpr !== ratio) { composer.setPixelRatio(dpr); ratio = dpr; }
      if (size.x !== width || size.y !== height) {
        composer.setSize(size.x, size.y);
        width = size.x; height = size.y;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const pass of composer.passes) pass.dispose();
      // Three r180 does not include this material in UnrealBloomPass.dispose().
      bloom.materialHighPassFilter.dispose();
      composer.dispose();
    },
  };
}
