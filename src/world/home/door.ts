/**
 * THE FRONT DOOR (world/home): the hinged leaf with its peephole, knob, chain on a track and keeper, the light crack under the
 * leaf (the hallway's light) and the visitor's shadow across it (off until a visitor is set). The leaf is a solid collider
 * while it swings: its footprint is re-set at every angle (config `leafFootprint`), so the leaf blocks the player wherever it
 * stands. Its moving parts sit under the caller's `dyn` group (kit.finalize never merges them).
 */
import * as THREE from 'three';
import type { KitX } from '@/kit';
import { app } from '@/core/app';
import type { TweenHandle, TweenSystem } from '@/core/tween';
import type { CollisionWorld } from '../types';
import { at, DOOR_H, DOOR_HINGE_X, DOOR_OPEN_RAD, DOOR_X0, DOOR_X1, DOOR_Z, LEAF_W, leafFootprint } from './config';

/** Chain geometry on the leaf (local metres, the inside face of the leaf is at z ≈ -0.035). */
const CHAIN_Y = 1.42;
const CHAIN_LINKS = 6;
const LINK_LEN = 0.05;
const SLIDE_ON_X = 0.36;   // the slide pulled out along the track, the chain taut to the keeper
const SLIDE_OFF_X = 0.74;  // the slide parked at the track's end, the chain hanging
const KEEPER_X = 0.88;     // the keeper plate on the leaf's free edge
const SAG_DROP = 0.34;     // the slack chain hangs this far below the slide (m)
const SAG_BOW = 0.07;      // and bows this far sideways at its middle (m)
const LINK_Z = -0.07;

/** The shake's peak yaw at strength 1 (rad): about 18 mm at the leaf's 0.9 m free edge (visible at the Evening's camera). */
const SHAKE_RAD = 0.02;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

export class HomeDoor {
  /** The leaf and everything on it. The caller adds it to the `dyn` group. */
  readonly pivot: THREE.Group;
  private readonly slide: THREE.Object3D;
  private readonly links: THREE.Object3D[] = [];
  private readonly shadow: THREE.Object3D;
  private collider = -1;
  private amt = 0;
  private tw: TweenHandle | null = null;
  /** The shake's yaw offset (rad) on top of the swing, and its running tween. */
  private shk = 0;
  private shakeTw: TweenHandle | null = null;

  /** `tweens` defaults to the sim clock (`app.tweens.sim`): the swing freezes with the game and follows the fixed step. */
  constructor(private readonly o: { kit: KitX; dyn: THREE.Group; collision: CollisionWorld | null; tweens?: TweenSystem }) {
    const kit = o.kit;
    const leafMat = kit.mat({ color: 0x3f3a32 });
    const brass = kit.pal.brass;
    const chrome = kit.pal.chrome;
    const lensMat = kit.mat({ color: 0x0a0a0c });

    this.pivot = kit.group('home:door');
    this.pivot.position.set(...at(DOOR_HINGE_X, 0, DOOR_Z));
    const leafH = DOOR_H - 0.05;
    kit.box(LEAF_W, leafH, 0.06, leafMat, { pos: [LEAF_W / 2, 0.02 + leafH / 2, 0], parent: this.pivot });

    // peephole (brass ring, dark lens) on the inside face; the knob and its rose below it
    kit.cyl(0.02, 0.02, 0.012, brass, { pos: [0.45, 1.55, -0.035], rot: [90, 0, 0], parent: this.pivot, seg: 8 });
    kit.cyl(0.011, 0.011, 0.01, lensMat, { pos: [0.45, 1.55, -0.044], rot: [90, 0, 0], parent: this.pivot, seg: 6 });
    kit.cyl(0.035, 0.035, 0.014, brass, { pos: [0.78, 1.0, -0.035], rot: [90, 0, 0], parent: this.pivot, seg: 8 });
    kit.sphere(0.034, brass, { pos: [0.78, 1.0, -0.062], parent: this.pivot, wSeg: 6, hSeg: 5 });

    // chain: a brass track on the leaf, the slide riding it, the keeper on the free edge, and the links between them
    kit.box(0.75, 0.024, 0.02, brass, { pos: [0.475, CHAIN_Y, -0.04], parent: this.pivot });
    kit.box(0.04, 0.07, 0.03, brass, { pos: [KEEPER_X, CHAIN_Y, -0.05], parent: this.pivot });
    this.slide = kit.box(0.06, 0.05, 0.03, brass, { pos: [SLIDE_OFF_X, CHAIN_Y, -0.065], parent: this.pivot });
    for (let i = 0; i < CHAIN_LINKS; i++) {
      this.links.push(kit.box(LINK_LEN, 0.012, 0.012, chrome, { pos: [SLIDE_OFF_X, CHAIN_Y, LINK_Z], parent: this.pivot }));
    }

    // the light crack under the leaf, and the two feet a visitor throws across it (hidden until a visitor is at the door)
    const crackMat = kit.mat({ color: 0xffcf8a, lit: false });
    const shadowMat = kit.mat({ color: 0x000000, lit: false });
    kit.box(DOOR_X1 - DOOR_X0, 0.012, 0.03, crackMat, { pos: at(-0.6, 0.006, 2.47), parent: o.dyn });
    this.shadow = kit.group('home:door:feet');
    // two feet side by side on the strip, centred in the opening (x -1.1 .. -0.1), toes pointing into the room (a sole and
    // a toe nub each). Sized so they read from the room at the Evening's camera. lit: false so they stay dark on the crack.
    const doorCx = (DOOR_X0 + DOOR_X1) / 2;
    for (const fx of [-0.2, 0.2]) {
      kit.box(0.12, 0.016, 0.05, shadowMat, { pos: at(doorCx + fx, 0.008, 2.47), parent: this.shadow });
      kit.box(0.06, 0.016, 0.035, shadowMat, { pos: at(doorCx + fx, 0.008, 2.435), parent: this.shadow });
    }
    o.dyn.add(this.shadow);
    this.shadow.visible = false;

    o.dyn.add(this.pivot);
    this.layoutChain(false);
    this.setAmt(0);
  }

  /** Swings the leaf to `amount` (0 shut .. 1 open) over `dur` seconds (sim time). Resolves when it stops. */
  doorTo(amount: number, dur: number): Promise<void> {
    const to = clamp01(amount);
    const from = this.amt;
    this.tw?.cancel();
    this.tw = null;
    const sys = this.o.tweens ?? app.tweens?.sim;
    if (dur <= 0 || !sys) {
      this.setAmt(to);
      return Promise.resolve();
    }
    if (Math.abs(to - from) > 0.05) {   // a crack is a creak, a full swing is the door itself
      const opening = to > from;
      const crack = Math.max(to, from) < 0.3;
      try { app.audio?.play(opening ? (crack ? 'doorCreakOpen' : 'doorOpen') : (crack ? 'doorCreakClose' : 'doorClose'), { vol: 0.6 }); } catch { /* audio is optional */ }
    }
    const h = sys.run(dur, (k) => { this.setAmt(from + (to - from) * k); }, { ease: 'inOutQuad' });
    this.tw = h;
    return h.promise;
  }

  /**
   * A rattle of the shut leaf (shoves, a shoulder): a few millimetres of yaw, decaying, over `dur` sim seconds (default 0.25).
   * `strength` 0..1 scales it (0.02 rad at 1, about 18 mm at the leaf's free edge). The leaf returns to its swing exactly.
   */
  shake(strength: number, dur = 0.25): void {
    const sys = this.o.tweens ?? app.tweens?.sim;
    const amp = clamp01(strength) * SHAKE_RAD;
    this.shakeTw?.cancel();
    this.shakeTw = null;
    if (amp <= 0 || dur <= 0 || !sys) return;
    const h = sys.run(dur, (k) => {
      this.shk = amp * Math.sin(k * Math.PI * 6) * (1 - k);
      this.applyRot();
    }, { ease: 'linear' });
    this.shakeTw = h;
    void h.promise.then(() => {
      if (this.shakeTw !== h) return;
      this.shakeTw = null;
      this.shk = 0;
      this.applyRot();
    });
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
    this.shakeTw?.cancel();
    this.shakeTw = null;
    if (this.collider >= 0) this.o.collision?.remove(this.collider);
    this.collider = -1;
    this.o.dyn.remove(this.pivot);
  }

  private setAmt(v: number): void {
    this.amt = clamp01(v);
    this.applyRot();
    this.syncCollider();
  }

  private applyRot(): void {
    this.pivot.rotation.y = this.amt * DOOR_OPEN_RAD + this.shk;
  }

  /** The collider follows the leaf: one solid box, the leaf's footprint at the current swing (re-set each time it moves). */
  private syncCollider(): void {
    const col = this.o.collision;
    if (!col) return;
    if (this.collider >= 0) col.remove(this.collider);
    const [x0, z0, x1, z1] = leafFootprint(this.amt * DOOR_OPEN_RAD);
    const box = new THREE.Box3(new THREE.Vector3(...at(x0, 0, z0)), new THREE.Vector3(...at(x1, DOOR_H, z1)));
    this.collider = col.addStatic(box, 'solid');
  }

  /**
   * The chain. Taut: the links run in a straight line from the slide to the keeper. Slack: the slide hangs and the links
   * follow a shallow sag below it, each turned along the curve so the chain reads as hanging, not as a rod.
   */
  private layoutChain(on: boolean): void {
    const sx = on ? SLIDE_ON_X : SLIDE_OFF_X;
    this.slide.position.set(sx, CHAIN_Y, LINK_Z + 0.005);
    const n = this.links.length;
    // link centres along the chain: t = 0 at the slide, 1 at the keeper (taut) or the sag's lowest end (slack)
    const point = (t: number): [number, number] => on
      ? [sx + (KEEPER_X - sx) * t, CHAIN_Y]
      : [sx + SAG_BOW * Math.sin(Math.PI * t), CHAIN_Y - SAG_DROP * t];
    let prev = point(0);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const [px, py] = point(t);
      const link = this.links[i];
      // a link's length follows its chord, so the chain has no gaps taut and no slack gaps either
      const [ex, ey] = point((i + 1) / n);
      const chord = Math.hypot(ex - prev[0], ey - prev[1]);
      link.position.set(px, py, LINK_Z);
      link.rotation.set(0, 0, Math.atan2(ey - prev[1], ex - prev[0]));
      link.scale.set(chord / LINK_LEN, 1, 1);
      prev = [ex, ey];
    }
  }
}
