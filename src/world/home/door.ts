/**
 * THE FRONT DOOR (world/home): the hinged leaf with its peephole, knob, chain on a track and keeper, the light crack under the
 * leaf (the hallway's light) and the visitor's shadow across it (off until a visitor is set). The leaf is a solid collider
 * while it is shut. Its moving parts sit under the caller's `dyn` group (kit.finalize never merges them).
 */
import * as THREE from 'three';
import type { KitX } from '@/kit';
import { app } from '@/core/app';
import type { TweenHandle } from '@/core/tween';
import type { CollisionWorld } from '../types';
import { at, DOOR_COLLIDE_Z, DOOR_H, DOOR_HINGE_X, DOOR_OPEN_RAD, DOOR_X0, DOOR_X1, DOOR_Z } from './config';

/** Chain geometry on the leaf (local metres, the inside face of the leaf is at z ≈ -0.035). */
const CHAIN_Y = 1.42;
const CHAIN_LINKS = 6;
const SLIDE_ON_X = 0.36;   // the slide pulled out along the track, the chain taut to the keeper
const SLIDE_OFF_X = 0.74;  // the slide parked at the track's end, the chain hanging
const KEEPER_X = 0.88;     // the keeper plate on the leaf's free edge
const PEEP_Y = 1.55;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

export class HomeDoor {
  /** The leaf and everything on it. The caller adds it to the `dyn` group. */
  readonly pivot: THREE.Group;
  private readonly slide: THREE.Object3D;
  private readonly links: THREE.Object3D[] = [];
  private readonly shadow: THREE.Object3D;
  private readonly collider: number;
  private amt = 0;
  private tw: TweenHandle | null = null;

  constructor(private readonly o: { kit: KitX; dyn: THREE.Group; collision: CollisionWorld | null }) {
    const kit = o.kit;
    const leafMat = kit.mat({ color: 0x3f3a32 });
    const brass = kit.pal.brass;
    const chrome = kit.pal.chrome;
    const lensMat = kit.mat({ color: 0x0a0a0c });

    this.pivot = kit.group('home:door');
    this.pivot.position.set(...at(DOOR_HINGE_X, 0, DOOR_Z));
    const leafH = DOOR_H - 0.05;
    kit.box(0.9, leafH, 0.06, leafMat, { pos: [0.45, 0.02 + leafH / 2, 0], parent: this.pivot });

    // peephole (brass ring, dark lens) on the inside face; the knob and its rose below it
    kit.cyl(0.02, 0.02, 0.012, brass, { pos: [0.45, PEEP_Y, -0.035], rot: [90, 0, 0], parent: this.pivot, seg: 8 });
    kit.cyl(0.011, 0.011, 0.01, lensMat, { pos: [0.45, PEEP_Y, -0.044], rot: [90, 0, 0], parent: this.pivot, seg: 6 });
    kit.cyl(0.035, 0.035, 0.014, brass, { pos: [0.78, 1.0, -0.035], rot: [90, 0, 0], parent: this.pivot, seg: 8 });
    kit.sphere(0.034, brass, { pos: [0.78, 1.0, -0.062], parent: this.pivot, wSeg: 6, hSeg: 5 });

    // chain: a brass track on the leaf, the slide riding it, the keeper on the free edge, and the links between them
    kit.box(0.75, 0.024, 0.02, brass, { pos: [0.475, CHAIN_Y, -0.04], parent: this.pivot });
    kit.box(0.04, 0.07, 0.03, brass, { pos: [KEEPER_X, CHAIN_Y, -0.05], parent: this.pivot });
    this.slide = kit.box(0.06, 0.05, 0.03, brass, { pos: [SLIDE_OFF_X, CHAIN_Y, -0.065], parent: this.pivot });
    for (let i = 0; i < CHAIN_LINKS; i++) {
      this.links.push(kit.box(0.05, 0.012, 0.012, chrome, { pos: [SLIDE_OFF_X, CHAIN_Y, -0.07], parent: this.pivot }));
    }

    // the light crack under the leaf, and the shadow a visitor throws across it (hidden in wave 69)
    const crackMat = kit.mat({ color: 0xffcf8a, lit: false });
    const shadowMat = kit.mat({ color: 0x000000, lit: false });
    kit.box(DOOR_X1 - DOOR_X0, 0.012, 0.03, crackMat, { pos: at(-0.6, 0.006, 2.47), parent: o.dyn });
    this.shadow = kit.box(0.36, 0.014, 0.034, shadowMat, { pos: at(-0.6, 0.007, 2.47), parent: o.dyn });
    this.shadow.visible = false;

    o.dyn.add(this.pivot);
    this.layoutChain(false);

    // the shut leaf blocks the opening; the collider is taken away while the leaf swings clear of the frame
    let id = -1;
    if (o.collision) {
      const box = new THREE.Box3(
        new THREE.Vector3(...at(DOOR_X0, 0, DOOR_COLLIDE_Z[0])),
        new THREE.Vector3(...at(DOOR_X1, DOOR_H, DOOR_COLLIDE_Z[1])),
      );
      id = o.collision.addStatic(box, 'solid');
    }
    this.collider = id;
    this.setAmt(0);
  }

  /** Swings the leaf to `amount` (0 shut .. 1 open) over `dur` seconds (sim time). Resolves when it stops. */
  doorTo(amount: number, dur: number): Promise<void> {
    const to = clamp01(amount);
    const from = this.amt;
    this.tw?.cancel();
    this.tw = null;
    if (dur <= 0 || !app.tweens) {
      this.setAmt(to);
      return Promise.resolve();
    }
    const h = app.tweens.sim.run(dur, (k) => { this.setAmt(from + (to - from) * k); }, { ease: 'inOutQuad' });
    this.tw = h;
    return h.promise;
  }

  /** The chain on (taut from the track to the keeper, the door held to a crack) or off (slack, hanging). */
  setChain(on: boolean): void {
    this.layoutChain(on);
  }

  /** The visitor's shadow across the light crack (wave 70 drives it; wave 69 leaves it off). */
  setShadow(on: boolean): void {
    this.shadow.visible = on;
  }

  dispose(): void {
    this.tw?.cancel();
    this.tw = null;
    if (this.collider >= 0) this.o.collision?.remove(this.collider);
    this.o.dyn.remove(this.pivot);
  }

  private setAmt(v: number): void {
    this.amt = clamp01(v);
    this.pivot.rotation.y = this.amt * DOOR_OPEN_RAD;
    if (this.collider >= 0) this.o.collision?.setEnabled(this.collider, this.amt < 0.5);
  }

  private layoutChain(on: boolean): void {
    const sx = on ? SLIDE_ON_X : SLIDE_OFF_X;
    this.slide.position.set(sx, CHAIN_Y, -0.065);
    const n = this.links.length;
    for (let i = 0; i < n; i++) {
      const link = this.links[i];
      if (on) {
        const k = (i + 0.5) / n;
        link.position.set(sx + (KEEPER_X - sx) * k, CHAIN_Y, -0.07);
        link.rotation.set(0, 0, 0);
      } else {
        link.position.set(sx, CHAIN_Y - 0.05 * (i + 1), -0.07);
        link.rotation.set(0, 0, Math.PI / 2);
      }
    }
  }
}
