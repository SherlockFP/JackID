/**
 * Crisp in-world UI (`readable-pawn`): a second, NATIVE-resolution pass for the first-person overlay meshes that carry
 * text (rule placards, the pause card, the Upgrade Ledger, the Intermission terminal).
 *
 * Why: the overlay is drawn into the low-res PSX target (~224 p) and then dithered and quantised by the post pass, with
 * vertex jitter and affine texturing on top. Bitmap text on a tilted card does not survive that. The fix keeps the object
 * in 3D (same scene, same camera, same animation, same picking) but moves it to its own THREE layer:
 *
 *   1. the normal PSX pass skips it (the overlay camera only sees layer 0);
 *   2. after the post pass has filled the canvas, this module renders the overlay scene again with the camera set to the
 *      crisp layer only, straight onto the canvas at its real pixel size, depth cleared, with the PSX snap / affine
 *      uniforms switched off for the duration (the materials are the stock `psxMaterial`s, so nothing else changes).
 *
 * Crisp meshes therefore always sit on top of the PSX picture (fine for held cards), keep their own depth order, and are
 * not touched by jitter, dither, quantise, CRT, vignette or flashes. Nothing here is DOM; there is nothing to position.
 *
 * Usage: `markCrisp(root)` once the object's meshes exist (and again when children are added later); `releaseCrisp(root)`
 * on dispose; `crispRaycaster(ray)` for every Raycaster that must pick crisp meshes (rays only see layer 0 by default).
 * Textures that should be sharp at native size are the caller's business (linear + mipmaps + a higher texel density).
 */
import * as THREE from 'three';
import { app } from '@/core/app';
import { psxUniforms } from '@/core/renderer/psxMaterial';

/** The THREE layer the native-resolution pass renders. Layer 0 is the normal world / PSX pass. */
export const CRISP_LAYER = 5;

const roots = new Set<THREE.Object3D>();
const wrapped = new WeakSet<object>();
const vp = new THREE.Vector4();

/** Move `root` and everything under it to the crisp layer and keep the pass alive while it exists. */
export function markCrisp(root: THREE.Object3D): void {
  root.traverse((o) => { if (o.layers.mask !== (1 << CRISP_LAYER)) o.layers.set(CRISP_LAYER); });
  roots.add(root);
  ensureCrispPass();
}

/** Stop rendering for `root` (dispose). The pass stays installed but idles when nothing is registered. */
export function releaseCrisp(root: THREE.Object3D): void { roots.delete(root); }

/** Let `ray` hit crisp meshes as well as layer-0 ones. */
export function crispRaycaster(ray: THREE.Raycaster): THREE.Raycaster { ray.layers.enable(CRISP_LAYER); return ray; }

/** A texture that stays sharp when magnified at native size and does not shimmer when it is minified. */
export function crispTexture(t: THREE.Texture, aniso = 4): void {
  if (t.userData.crisp === true) return;
  t.userData.crisp = true;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = aniso;
  t.needsUpdate = true;
}

/**
 * Hook `renderer.render` once (idempotent, re-checked on every call because a temporary wrapper such as the debug
 * screenshot grabber may have replaced and restored it). Cheap enough to call per frame.
 */
export function ensureCrispPass(): void {
  const r = app?.renderer;
  if (!r || wrapped.has(r.render)) return;
  const orig = r.render;
  const fn: typeof r.render = (scene, camera, overlay) => {
    orig.call(r, scene, camera, overlay);
    if (overlay && roots.size > 0) crispPass(r, overlay);
  };
  wrapped.add(fn);
  r.render = fn;
}

function crispPass(r: typeof app.renderer, overlay: { scene: THREE.Scene; camera: THREE.Camera }): void {
  if (r.post.blackout >= 0.98) return;
  const three = r.three;
  const cam = overlay.camera as THREE.PerspectiveCamera;
  const canvas = three.domElement;
  const W = canvas.width, H = canvas.height;
  // the image rectangle the post pass used: lowRes × scale tall, the camera's aspect wide, centred (letterboxed)
  const vh = Math.max(1, Math.min(H, Math.round(r.lowRes.y * r.scale)));
  const vw = Math.max(1, Math.min(W, Math.round(vh * (cam.aspect || W / H))));
  const x = Math.floor((W - vw) / 2), y = Math.floor((H - vh) / 2);

  three.getViewport(vp);
  const mask = cam.layers.mask;
  const snap = psxUniforms.uPsxSnap.value, affine = psxUniforms.uPsxAffine.value;
  const wasAuto = three.autoClear;
  try {
    three.setRenderTarget(null);
    three.autoClear = false;
    three.setViewport(x, y, vw, vh);
    three.clearDepth();
    psxUniforms.uPsxSnap.value = 0;
    psxUniforms.uPsxAffine.value = 0;
    cam.layers.set(CRISP_LAYER);
    three.render(overlay.scene, cam);
  } finally {
    cam.layers.mask = mask;
    psxUniforms.uPsxSnap.value = snap;
    psxUniforms.uPsxAffine.value = affine;
    three.setViewport(vp);
    three.autoClear = wasAuto;
  }
}
