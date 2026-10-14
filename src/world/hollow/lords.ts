/**
 * The three Dark Lords (THE UNDERNEATH): giant shadow mannequins at 1.6x, behind the Lords' table, each with one
 * accessory. Ash wears antlers, Ledgers a crown, Mirrors a black veil over a chrome face. They turn their heads slowly
 * to random points in the room, and to the player when the player is close. `react` is the hook the duel machine uses
 * for a pull, a shot or a taken run.
 */
import * as THREE from 'three';
import type { KitX } from '@/kit';
import type { MannequinActor } from '@/kit/types';
import type { Rng } from '@/core/rng';
import { LORD_IDS, LORD_POS, LORD_SCALE, TABLE_POS, type LordId } from './config';

export type LordReaction = 'pull' | 'shot' | 'taken';

export interface LordRig {
  readonly id: LordId;
  readonly actor: MannequinActor;
  /** World position of the station (feet). */
  readonly pos: THREE.Vector3;
  /** Head-height world point, for gaze and the eye glow. */
  readonly eye: THREE.Vector3;
  /** Turn the head to `target` (null lets it drift again). */
  gaze(target: THREE.Vector3 | null, dur?: number): void;
  react(kind: LordReaction, player: THREE.Vector3 | null): void;
  tick(dt: number, player: THREE.Vector3 | null, calm: boolean): void;
  dispose(): void;
}

const HEAD_Y = 1.62 * LORD_SCALE;   // head height above the feet, before the 1.6x root scale is applied to the offsets

/** Antlers: two bent tines per side, bone colour. */
function antlers(kit: KitX, parent: THREE.Object3D): void {
  const bone = kit.mat({ color: 0x6b5a48 });
  for (const s of [-1, 1]) {
    kit.cyl(0.012, 0.045, 0.55, bone, { pos: [s * 0.1, 0.22, 0], rot: [0, 0, s * 24], parent });
    kit.cyl(0.008, 0.02, 0.22, bone, { pos: [s * 0.22, 0.42, 0.02], rot: [0, 0, s * 70], parent });
    kit.cyl(0.008, 0.02, 0.2, bone, { pos: [s * 0.2, 0.5, -0.03], rot: [0, 0, s * 40], parent });
  }
}

/** Crown: a gold ring with five points. */
function crown(kit: KitX, parent: THREE.Object3D): void {
  const gold = kit.mat({ color: 0xc9a54a });
  kit.torus(0.13, 0.016, gold, { pos: [0, 0.02, 0], rot: [90, 0, 0], parent });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    kit.cyl(0, 0.024, 0.11, gold, { pos: [Math.cos(a) * 0.13, 0.08, Math.sin(a) * 0.13], parent });
  }
}

/** Veil: a black cloth hanging behind the head, and a chrome face plate. */
function veil(kit: KitX, parent: THREE.Object3D): void {
  const cloth = new THREE.MeshBasicMaterial({ color: 0x0a0708, transparent: true, opacity: 0.72, side: THREE.DoubleSide });
  kit.plane(0.62, 0.95, cloth, { pos: [0, -0.32, -0.12], parent });
  kit.sphere(0.09, kit.mat({ color: 0xb8c4cc }), { pos: [0, 0.02, 0.1], scale: [0.8, 1.15, 0.5], parent });
}

class Lord implements LordRig {
  readonly pos: THREE.Vector3;
  readonly eye: THREE.Vector3;
  readonly actor: MannequinActor;
  private wander = 0;
  private tracking = false;

  constructor(readonly id: LordId, private readonly rng: Rng, kit: KitX, root: THREE.Group) {
    const [x, y, z] = LORD_POS[id];
    this.pos = new THREE.Vector3(x, y, z);
    this.eye = new THREE.Vector3(x, y + HEAD_Y, z);
    this.actor = kit.mannequin({
      style: 'shadow', color: 0x120a10, jointColor: 0x1e1418, height: 1.75,
      mask: id === 'mirrors' ? null : 'mask_porcelain', clip: 'Idle_Loop', stepFps: 8,
    });
    this.actor.root.position.copy(this.pos);
    this.actor.root.scale.setScalar(LORD_SCALE);
    root.add(this.actor.root);
    // accessories ride the Head bone; offsets are in bone space
    const acc = new THREE.Group();
    if (id === 'ash') antlers(kit, acc);
    if (id === 'ledgers') crown(kit, acc);
    if (id === 'mirrors') veil(kit, acc);
    this.actor.attach(acc, 'Head', { pos: [0, 0.08, 0] });
    this.wander = rng.float(1, 3);
  }

  gaze(target: THREE.Vector3 | null, dur = 2.5): void {
    this.tracking = false;
    this.actor.lookAt(target, dur);
  }

  react(kind: LordReaction, player: THREE.Vector3 | null): void {
    if (kind === 'pull' && player) this.gaze(player, 0.5);
    if (kind === 'shot') { this.gaze(null, 0.4); this.actor.stop(0.3); }
    if (kind === 'taken' && player) this.gaze(player, 0.8);
  }

  /** Slow idle head turns: a new random point in the room every few seconds; the player wins the gaze when close. */
  tick(dt: number, player: THREE.Vector3 | null, calm: boolean): void {
    const near = player !== null && player.distanceTo(this.pos) < 7;
    if (near && player) {
      if (!this.tracking) this.gaze(player, 1.6);
      this.tracking = true;
      return;
    }
    if (this.tracking) { this.tracking = false; this.wander = 0; }
    this.wander -= dt;
    if (this.wander > 0) return;
    const span = calm ? 2.0 : 3.0;
    const target = new THREE.Vector3(
      TABLE_POS[0] + this.rng.float(-span, span),
      this.pos.y + this.rng.float(1.1, 2.1),
      TABLE_POS[2] + this.rng.float(-1.5, 1.5),
    );
    this.gaze(target, calm ? 4.0 : 2.8);
    this.wander = this.rng.float(3.5, 6.5);
  }

  dispose(): void {
    this.actor.dispose();
  }
}

/** Build the three Lords into `root`. Their mannequins load asynchronously and swap in place. */
export function buildLords(kit: KitX, root: THREE.Group, rng: Rng): LordRig[] {
  return LORD_IDS.map((id) => new Lord(id, rng.fork(id), kit, root));
}
