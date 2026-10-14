/**
 * A doorway for THE HOLLOW DOOR: a black opening in a frame, with two leaves that split apart.
 * The crack variant's leaves are the cracked wall plate (concrete with a hairline crack); the seam variant's leaves are
 * a dark red membrane with a red rim. Local space: the opening is centred on x = 0, runs y ∈ [0, DOOR_H], and the front
 * faces +Z. Place with `root.position` and `root.rotation.y` (yaw).
 */
import * as THREE from 'three';
import type { KitX } from '@/kit';
import type { Hex } from '@/core/types';
import { DOOR_H, DOOR_W } from './config';

export interface DoorwayOpts {
  /** Material of the two leaves (the plate, or the membrane). Made with `kit.mat`. */
  leaves: THREE.Material;
  /** Frame colour. */
  frame?: Hex;
  /** Red rim colour (seam), or null for none. */
  rim?: Hex | null;
}

export interface Doorway {
  readonly root: THREE.Group;
  /** 0 = leaves shut over the opening, 1 = leaves parted. */
  setSplit(t: number): void;
  /** Rim brightness, 0..1 (1 = full colour). The caller decides any pulse; Calm Mode keeps it steady. */
  setGlow(k: number): void;
  dispose(): void;
}

const LEAF_W = DOOR_W / 2;   // each leaf covers half the opening when shut
const LEAF_TRAVEL = 0.62;    // how far a leaf moves outward when parted

export function buildDoorway(kit: KitX, o: DoorwayOpts): Doorway {
  const root = kit.group('hollow:doorway');
  const frame = kit.mat({ color: o.frame ?? 0x2a1e16 });
  const voidMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
  kit.plane(DOOR_W, DOOR_H, voidMat, { pos: [0, DOOR_H / 2, -0.04], parent: root });

  const fh = DOOR_H + 0.25;
  kit.box(0.14, fh, 0.24, frame, { pos: [-DOOR_W / 2 - 0.07, fh / 2, 0], parent: root });
  kit.box(0.14, fh, 0.24, frame, { pos: [DOOR_W / 2 + 0.07, fh / 2, 0], parent: root });
  kit.box(DOOR_W + 0.28, 0.2, 0.24, frame, { pos: [0, DOOR_H + 0.15, 0], parent: root });

  const left = kit.box(LEAF_W, DOOR_H, 0.08, o.leaves, { pos: [-LEAF_W / 2, DOOR_H / 2, 0.02], parent: root });
  const right = kit.box(LEAF_W, DOOR_H, 0.08, o.leaves, { pos: [LEAF_W / 2, DOOR_H / 2, 0.02], parent: root });

  const base = new THREE.Color(o.rim ?? 0x000000);
  let glow: THREE.MeshBasicMaterial | null = null;
  if (o.rim != null) {
    glow = new THREE.MeshBasicMaterial({ color: base.clone() });
    const e = 0.03;
    kit.box(e, DOOR_H, e, glow, { pos: [-DOOR_W / 2 - 0.02, DOOR_H / 2, 0.13], parent: root });
    kit.box(e, DOOR_H, e, glow, { pos: [DOOR_W / 2 + 0.02, DOOR_H / 2, 0.13], parent: root });
    kit.box(DOOR_W, e, e, glow, { pos: [0, DOOR_H + 0.02, 0.13], parent: root });
  }

  return {
    root,
    setSplit(t) {
      const k = Math.min(1, Math.max(0, t));
      left.position.x = -LEAF_W / 2 - LEAF_TRAVEL * k;
      right.position.x = LEAF_W / 2 + LEAF_TRAVEL * k;
    },
    setGlow(k) {
      if (!glow) return;
      glow.color.copy(base).multiplyScalar(Math.min(1, Math.max(0, k)));
    },
    dispose() {
      root.traverse((obj) => {
        const m = obj as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
      });
      voidMat.dispose();
      glow?.dispose();
    },
  };
}
