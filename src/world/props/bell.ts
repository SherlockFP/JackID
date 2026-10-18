/**
 * The LAST CALL BELL (WORLD-ARCH, wave 77): a brass desk bell on a small counter beside the Debt Terminal, with a plate
 * that reads BELL (ZİL in Turkish). Looking at it shows "Ring the Bell"; the first press asks, the second press rings it
 * and ends the Watch, exactly like the Bell key at the terminal (`run.ringBell()`). The bell rocks and chimes when rung.
 *
 * Registered as anchor `bell` and prop `lastCallBell`. Animation is frame-driven (`update(dt)`), so it follows the sim clock.
 */
import * as THREE from 'three';
import type { KitX } from '@/kit';
import type { InteractionSystem, WorldProp } from '../types';
import type { LightHint } from '../sys/arch';
import { app } from '@/core/app';
import { t } from '@/core/i18n';
import { crispLabel } from './signs';

/** North side of the Mouth, between the terminal (x 0) and the phone (x 4). The counter backs onto the north wall. */
export const BELL_POS = { x: 1.9, z: -29.35 } as const;
/** Distance (m) the stand point keeps from the bell, on the floor in front of the counter. */
export const BELL_STAND_M = 1.2;
/** Seconds the first press stays armed. */
const ARM_SEC = 4;
const COUNTER_H = 0.9;
/** The slice of the run facade the bell needs (the core `RunApi` type does not list it; the game's run does). */
type BellRun = { ringBell?(): boolean; bank?(): { pullsLeft: number } };

export interface BellProp extends WorldProp {
  /** Ring it now: the swing, the chime and the plunger, no run call (the tests and the cutscenes use this). */
  ring(): void;
  /** The press the crosshair makes: asks first, rings on the second press and ends the Watch. */
  press(): void;
  readonly armed: boolean;
  readonly swinging: boolean;
}

export interface BellBuild {
  prop: BellProp;
  anchor: THREE.Object3D;
  hints: LightHint[];
  statics: Array<{ box: THREE.Box3; tag: 'solid' }>;
}

export function buildLastCallBell(kit: KitX, o: { interact?: InteractionSystem }): BellBuild {
  const root = kit.group('lastCallBell');
  root.position.set(BELL_POS.x, 0, BELL_POS.z);
  const { pal } = kit;
  const woodMat = kit.mat({ color: 0x5a1019 });

  // counter: a red-brown body, a brass top and a brass kick strip
  kit.box(0.7, COUNTER_H, 0.46, woodMat, { pos: [0, COUNTER_H / 2, 0], parent: root, bevel: 0.01 });
  kit.box(0.78, 0.04, 0.54, pal.brass, { pos: [0, COUNTER_H + 0.02, 0], parent: root });
  kit.box(0.72, 0.06, 0.48, pal.brass, { pos: [0, 0.03, 0], parent: root });
  // plate on the counter front, under the bell
  const plateY = 0.55;
  kit.box(0.5, 0.2, 0.03, pal.brass, { pos: [0, plateY, 0.235], parent: root });
  const sign = crispLabel(kit, { text: { key: 'prop.sign.bell' }, w: 0.44, h: 0.14, color: 0xffd34a, bg: 0x1a120c, frame: 0x8c6b29, font: 'public' });
  sign.mesh.position.set(0, plateY, 0.255);
  root.add(sign.mesh);

  // the bell: a lathe dome on a brass ring, a red plunger on top. `swing` rocks about the base centre.
  const top = COUNTER_H + 0.04;
  const swing = new THREE.Group();
  swing.name = 'swing';
  swing.position.set(0, top + 0.03, 0.02);
  root.add(swing);
  kit.cyl(0.19, 0.2, 0.03, pal.brass, { pos: [0, top + 0.015, 0.02], parent: root, seg: 12 });
  kit.lathe([[0.17, 0], [0.175, 0.012], [0.155, 0.05], [0.115, 0.1], [0.075, 0.15], [0.04, 0.185], [0.001, 0.2]], 12, pal.gold, { parent: swing });
  const plunger = new THREE.Group();
  plunger.position.set(0, 0.2, 0);
  swing.add(plunger);
  kit.cyl(0.012, 0.012, 0.04, pal.chrome, { pos: [0, 0.02, 0], parent: plunger, seg: 6 });
  kit.sphere(0.04, pal.red, { pos: [0, 0.055, 0], parent: plunger, wSeg: 8, hSeg: 5 });
  swing.userData.kitKeep = true;

  // The anchor is a stand point: 1.2 m south of the bell (the player's side of the counter), on the floor. Its forward is the
  // anchor's -z (menu/evening `anchorPose` convention), so yaw 0 looks straight at the bell.
  const anchor = new THREE.Object3D();
  anchor.name = 'bell';
  anchor.position.set(BELL_POS.x, 0, BELL_POS.z + BELL_STAND_M);
  anchor.rotation.set(0, 0, 0);

  const hints: LightHint[] = [
    { id: 'mouth:bell', pos: [BELL_POS.x, 1.7, BELL_POS.z + 0.5], color: 0xffd070, intensity: 0.7, range: 3, flicker: 'STEADY', zone: 'mouth' },
  ];
  const statics = [{ box: new THREE.Box3(new THREE.Vector3(BELL_POS.x - 0.37, 0, BELL_POS.z - 0.25), new THREE.Vector3(BELL_POS.x + 0.37, COUNTER_H + 0.05, BELL_POS.z + 0.27)), tag: 'solid' as const }];

  // ── behaviour ──
  let armLeft = 0;        // seconds the first press stays armed
  let swingT = -1;        // seconds since the last ring, -1 while still
  let chime2 = 0;         // seconds until the second, softer strike (> 0 while pending)
  const sfx = (vol: number, pitch: number): void => {
    try { app.audio.play('bell', { pos: anchor, vol, pitch, priority: 8 }); } catch { /* no audio in benches */ }
  };
  const ring = (): void => {
    swingT = 0;
    chime2 = 0.28;
    sfx(1, 0);
  };
  const toast = (text: string, kind: 'warn' | 'good' = 'warn'): void => {
    try { app.ui.toast(text, kind); } catch { /* headless */ }
  };
  const press = (): void => {
    const run = app.run as unknown as BellRun | null;
    if (!run || typeof run.ringBell !== 'function') { ring(); return; }   // no run (menu, bench): the bell just rings
    if (armLeft <= 0) {
      armLeft = ARM_SEC;
      sfx(0.4, -7);
      let pulls = 0;
      try { pulls = run.bank?.().pullsLeft ?? 0; } catch { /* a bench run without a bank */ }
      toast(t('prop.bell.confirm', { n: pulls }));
      return;
    }
    armLeft = 0;
    if (!run.ringBell()) { try { app.audio.play('buzzer', { vol: 0.4 }); } catch { /* headless */ } toast(t('prop.bell.no')); return; }
    ring();
  };

  const off = o.interact?.add({
    id: 'world:lastCallBell',
    box: new THREE.Box3(new THREE.Vector3(BELL_POS.x - 0.4, 0, BELL_POS.z - 0.3), new THREE.Vector3(BELL_POS.x + 0.4, 1.4, BELL_POS.z + 0.35)),
    maxDist: 2.6,
    priority: 2,
    enabled: () => true,
    label: () => t('prop.bell.label'),
    sub: () => t('prop.bell.sub'),
    onInteract: press,
  });

  const prop: BellProp = {
    id: 'lastCallBell',
    root,
    get armed() { return armLeft > 0; },
    get swinging() { return swingT >= 0; },
    ring,
    press,
    update(dt: number): void {
      if (armLeft > 0) armLeft = Math.max(0, armLeft - dt);
      if (swingT < 0) return;
      swingT += dt;
      if (chime2 > 0) { chime2 -= dt; if (chime2 <= 0) sfx(0.6, 4); }
      // a damped rock: 7 Hz, gone in about 1.6 s; the plunger dips in the first 0.12 s
      const k = Math.exp(-swingT * 2.6);
      swing.rotation.z = Math.sin(swingT * Math.PI * 14) * 0.13 * k;
      swing.rotation.x = Math.cos(swingT * Math.PI * 11) * 0.06 * k;
      plunger.position.y = 0.2 - (swingT < 0.12 ? Math.sin((swingT / 0.12) * Math.PI) * 0.025 : 0);
      if (swingT > 1.8) { swingT = -1; swing.rotation.set(0, 0, 0); plunger.position.y = 0.2; }
    },
    dispose(): void {
      off?.();
      root.removeFromParent();
      root.traverse((c) => { const m = c as THREE.Mesh; if (m.geometry) m.geometry.dispose(); });
    },
  };
  return { prop, anchor, hints, statics };
}
