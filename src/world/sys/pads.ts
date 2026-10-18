/**
 * Pads and stand-ins (WORLD-SYS): the three things a slot can show instead of a working machine.
 *  - `buildPad`      an empty tycoon pad: low plinth, brass studs and a flickering neon FOR LEASE sign.
 *  - `buildBroken`   an out-of-order cabinet (unregistered id, too-big machine, wrong mode, or a crash in `init`).
 *  - `playDelivery` / `playRemoval`   the order animation: a crate drops from the ceiling, slams down (dust, thud, shake,
 *    light pulse), bursts open and the machine pops out with a squash. Removal is the reverse (squash, puff, gone).
 * Only kit primitives are used so the pads work whatever the rest of the kit has shipped.
 */
import * as THREE from 'three';
import type { LocalAABB, SlotSize } from '@/core/types';
import { SLOT_DIMS } from '@/core/types';
import type { Kit } from '@/kit/types';
import type { KitX } from '@/kit';
import { crispNeon } from '../props/signs';
import type { FxApi } from '@/core/fx/types';
import type { AudioEngine } from '@/core/audio/types';
import type { TweenSystem } from '@/core/tween';
import { disposeObject3D } from '@/core/dispose';
import { log } from '@/core/log';

export interface PadParts {
  root: THREE.Group;
  /** Crosshair target volume (slot-local). */
  interact: LocalAABB;
  dispose(): void;
}

export interface BrokenParts {
  root: THREE.Object3D;
  colliders: LocalAABB[];
  interact: LocalAABB;
  dispose(): void;
}

export function buildPad(kit: Kit, size: SlotSize): PadParts {
  const pal = kit.pal;
  const d = SLOT_DIMS[size];
  const w = d.w * 0.96, dp = d.d * 0.96;
  const root = kit.group('pad');
  kit.box(w, 0.07, dp, pal.woodDark, { pos: [0, 0.035, 0], parent: root });
  kit.box(w - 0.14, 0.012, dp - 0.14, pal.carpet, { pos: [0, 0.076, 0], parent: root });
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      kit.cyl(0.035, 0.04, 0.1, pal.brass, { pos: [sx * (w / 2 - 0.07), 0.05, sz * (dp / 2 - 0.07)], seg: 6, parent: root });
    }
  }
  // the sign stands near the back edge so it never blocks the player's view of the pad
  const z = -dp / 2 + 0.22;
  kit.cyl(0.022, 0.028, 1.35, pal.brass, { pos: [0, 0.07 + 0.675, z], seg: 6, parent: root });
  kit.box(0.84, 0.3, 0.03, pal.black, { pos: [0, 1.52, z], parent: root });
  try {
    const neon = crispNeon(kit as unknown as KitX, { text: { key: 'world.forLease' }, h: 0.2, color: pal.neonYellow, flicker: 0.12, font: 'chetyre' });
    neon.root.position.set(0, 1.52, z + 0.03);
    neon.setOn(true);
    root.add(neon.root);
  } catch (e) {
    log.warn('world', 'pad neon sign unavailable', e);
  }
  return {
    root,
    interact: { min: [-w / 2, 0, -dp / 2], max: [w / 2, 1.75, dp / 2] },
    dispose() { disposeObject3D(root, { skipShared: true }); },
  };
}

export function buildBroken(kit: Kit, size: SlotSize): BrokenParts {
  const d = SLOT_DIMS[size];
  let root: THREE.Object3D;
  try {
    root = kit.outOfOrder(size);
  } catch {
    const pal = kit.pal;
    const g = kit.group('outOfOrder');
    kit.box(d.w * 0.86, d.h * 0.7, d.d * 0.8, pal.steel, { pos: [0, d.h * 0.35, 0], parent: g });
    kit.box(d.w * 0.7, d.h * 0.2, 0.04, pal.redDark, { pos: [0, d.h * 0.45, d.d * 0.4 + 0.02], parent: g });
    root = g;
  }
  const hh = d.h * 0.7;
  return {
    root,
    colliders: [{ min: [-d.w / 2, 0, -d.d / 2], max: [d.w / 2, hh, d.d / 2] }],
    interact: { min: [-d.w / 2, 0, -d.d / 2], max: [d.w / 2, hh, d.d / 2 + 0.1] },
    dispose() { disposeObject3D(root, { skipShared: true }); },
  };
}

// ── delivery / removal animations ─────────────────────────────────────────────────────────────────
export interface PadServices {
  kit: Kit;
  fx: FxApi;
  audio: AudioEngine;
  tweens: TweenSystem;
  camera: THREE.Camera;
  /** False once the world is gone: stops the animation from touching disposed objects. */
  alive(): boolean;
}

const GOLD = 0xe8b04a;
const tmpV = new THREE.Vector3();

function shakeNear(sv: PadServices, at: THREE.Vector3, amp: number, dur: number): void {
  const dist = sv.camera.position.distanceTo(at);
  if (dist < 14) sv.fx.shake(amp * (1 - dist / 14), dur);
}

/** Crate drop → slam → burst → machine pop. Resolves when the machine stands in place. */
export async function playDelivery(sv: PadServices, group: THREE.Group, size: SlotSize, machine: THREE.Object3D): Promise<void> {
  const { kit, fx, audio, tweens } = sv;
  const d = SLOT_DIMS[size];
  const pal = kit.pal;
  const crate = kit.group('crate');
  kit.box(d.w * 0.9, d.h * 0.5, d.d * 0.9, pal.wood, { pos: [0, d.h * 0.25, 0], parent: crate });
  kit.box(d.w * 0.93, 0.08, d.d * 0.93, pal.brass, { pos: [0, d.h * 0.12, 0], parent: crate });
  kit.box(d.w * 0.93, 0.08, d.d * 0.93, pal.brass, { pos: [0, d.h * 0.38, 0], parent: crate });
  const shadow = kit.blobShadow(d.w * 1.1, d.d * 1.1, 0.4);
  shadow.scale.multiplyScalar(0.1);
  group.add(crate, shadow);
  machine.visible = false;
  const top = 7;
  crate.position.y = top;
  group.getWorldPosition(tmpV);
  const at = tmpV.clone().add(new THREE.Vector3(0, d.h * 0.3, 0));

  audio.play('whoosh', { pos: at, vol: 0.8, pitch: -5, priority: 6 });
  await tweens.run(0.55, (k) => {
    crate.position.y = top * (1 - k);
    shadow.scale.set(d.w * 1.1 * (0.1 + 0.9 * k), 1, d.d * 1.1 * (0.1 + 0.9 * k));
  }, { ease: 'inCubic' }).promise;
  if (!sv.alive()) return;

  // impact
  crate.position.y = 0;
  audio.play('thud', { pos: at, vol: 1.1, pitch: -3, priority: 8 });
  fx.dust(at.clone().setY(at.y - d.h * 0.25), 22);
  fx.smoke(at.clone().setY(at.y - d.h * 0.25), 6);
  shakeNear(sv, at, 0.06, 0.35);
  await tweens.run(0.16, (k) => { crate.scale.set(1 + 0.06 * Math.sin(k * Math.PI), 1 - 0.1 * Math.sin(k * Math.PI), 1 + 0.06 * Math.sin(k * Math.PI)); }, { ease: 'outQuad' }).promise;
  if (!sv.alive()) return;
  await tweens.run(0.18, () => { /* beat: the crate sits there, the player leans in */ }).promise;
  if (!sv.alive()) return;

  // the crate bursts open, the machine pops out
  audio.play('purchase', { pos: at, vol: 0.9, priority: 7 });
  audio.play('glassBreak', { pos: at, vol: 0.35, pitch: 6, priority: 3 });
  fx.sparks(at, 18, GOLD);
  fx.glow(at, GOLD, Math.max(d.w, d.d) * 1.4, 0.5);
  fx.lightPulse(at, { color: GOLD, mul: 2, radius: 7, dur: 0.5 });
  shakeNear(sv, at, 0.03, 0.25);
  machine.visible = true;
  machine.scale.set(1.1, 0.7, 1.1);
  const crateTween = tweens.run(0.16, (k) => { crate.scale.set(1 + 0.2 * k, Math.max(0.02, 1 - k), 1 + 0.2 * k); }, { ease: 'outQuad' });
  const pop = tweens.run(0.45, (k) => {
    machine.scale.set(lerp(1.1, 1, k), lerp(0.7, 1, k), lerp(1.1, 1, k));
  }, { ease: 'outElastic' });
  await crateTween.promise;
  crate.removeFromParent();
  disposeObject3D(crate, { skipShared: true, detach: false });
  shadow.removeFromParent();
  disposeObject3D(shadow, { skipShared: true, detach: false });
  await pop.promise;
  machine.scale.set(1, 1, 1);
}

/** Squash, puff, vanish. The caller disposes the machine afterwards. */
export async function playRemoval(sv: PadServices, group: THREE.Group, size: SlotSize, machine: THREE.Object3D): Promise<void> {
  const { fx, audio, tweens } = sv;
  const d = SLOT_DIMS[size];
  const at = group.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, d.h * 0.3, 0));
  audio.play('whoosh', { pos: at, vol: 0.8, pitch: -2, priority: 6 });
  await tweens.run(0.1, (k) => { machine.scale.set(1 + 0.08 * k, 1 - 0.1 * k, 1 + 0.08 * k); }, { ease: 'outQuad' }).promise;
  if (!sv.alive()) return;
  fx.smoke(at, 10);
  fx.dust(at, 16);
  shakeNear(sv, at, 0.03, 0.2);
  await tweens.run(0.28, (k) => { machine.scale.set(lerp(1.08, 1.2, k), Math.max(0.01, lerp(0.9, 0, k)), lerp(1.08, 1.2, k)); }, { ease: 'inCubic' }).promise;
  machine.visible = false;
  machine.scale.set(1, 1, 1);
}

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
