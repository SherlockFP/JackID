/**
 * Round party table for the four-seat card games (seat-views). The kit's `feltTable` sizes its FELT as `w - 2 * 0.73`, so a
 * 1.5 m "footprint" gave a 0.1 m felt with the cards floating over the rail, and its chair backs filled the seat camera.
 * This table is built to the size the layout code assumes: a 0.46 m felt radius, a rail, and four chairs OUTSIDE the rail.
 *
 *  - `anchors`   LOGICAL seat anchors (0.51 m from the centre, y = felt): hands, piles and lamps are placed from these
 *  - `chairs`    where the chairs / house mannequins actually sit (0.80 m)
 *  - `seats`     seat defs; the pose is a steep look-down from a little behind the seat, so the whole felt, the cards and the
 *                local hand sit between the HUD strip and the control bar at 16:9 and 4:3, and no chair back is in frame
 *
 * Seat order (seen from above, +Z = seat 0's side): 0 = +Z, 1 = -X, 2 = -Z, 3 = +X.
 * (sonkart carries an identical copy: the two machines do not import each other.)
 */
import * as THREE from 'three';
import type { KitX } from '@/kit/index';
import type { SeatDef } from '@/core/types';
import type { LocalAABB } from '@/core/types';

export const FELT_Y = 0.76;
export const FELT_R = 0.46;
export const ANCHOR_R = 0.51;
const CHAIR_R = 0.80;
const CHAIR_H = 0.46;
const SEAT_DIR: ReadonlyArray<readonly [number, number]> = [[0, 1], [-1, 0], [0, -1], [1, 0]];

export interface PartyTable {
  feltY: number;
  anchors: THREE.Vector3[];
  chairs: THREE.Vector3[];
  seats: SeatDef[];
  colliders: LocalAABB[];
}

export function buildPartyTable(kit: KitX, root: THREE.Object3D, feltCol: number, seats = 4): PartyTable {
  const { pal } = kit;
  const wood = pal.woodDark;
  const woodMat = { color: wood, map: kit.tex.wood(wood) };
  const feltMat = { color: feltCol, map: kit.tex.felt(feltCol) };

  // felt disc, padded rail, apron, pedestal and foot
  kit.cyl(FELT_R, FELT_R, 0.03, feltMat, { pos: [0, FELT_Y - 0.015, 0], seg: 24, parent: root });
  kit.torus(FELT_R + 0.035, 0.04, pal.leather, { pos: [0, FELT_Y + 0.005, 0], rot: [90, 0, 0], seg: 24, parent: root });
  kit.torus(FELT_R, 0.006, pal.brass, { pos: [0, FELT_Y + 0.004, 0], rot: [90, 0, 0], seg: 24, parent: root });   // brass line where felt meets rail
  kit.cyl(FELT_R + 0.06, FELT_R + 0.06, 0.1, woodMat, { pos: [0, FELT_Y - 0.08, 0], seg: 24, parent: root });
  kit.cyl(0.1, 0.12, FELT_Y - 0.2, woodMat, { pos: [0, (FELT_Y - 0.2) / 2 + 0.05, 0], seg: 8, parent: root });
  kit.cyl(0.36, 0.4, 0.05, pal.brass, { pos: [0, 0.025, 0], seg: 12, parent: root });

  const out: PartyTable = { feltY: FELT_Y, anchors: [], chairs: [], seats: [], colliders: [{ min: [-0.6, 0, -0.6], max: [0.6, FELT_Y + 0.06, 0.6] }] };
  for (let s = 0; s < seats; s++) {
    const [dx, dz] = SEAT_DIR[s];
    out.anchors.push(new THREE.Vector3(dx * ANCHOR_R, FELT_Y, dz * ANCHOR_R));
    const cx = dx * CHAIR_R, cz = dz * CHAIR_R;
    out.chairs.push(new THREE.Vector3(cx, 0, cz));
    const chair = kit.chair({ h: CHAIR_H, seat: s % 2 ? pal.redDark : pal.red });
    chair.position.set(cx, 0, cz);
    chair.rotation.y = Math.atan2(-dx, -dz);                      // faces the table
    root.add(chair);
    out.colliders.push({ min: [cx - 0.24, 0, cz - 0.24], max: [cx + 0.24, CHAIR_H + 0.5, cz + 0.24], tag: 'solid' });
    out.seats.push({
      pose: {
        pos: new THREE.Vector3(dx * 0.35, 2.3, dz * 0.35),
        look: new THREE.Vector3(dx * 0.06, FELT_Y, dz * 0.06),
        fov: 55, mouse: 'pick',
      },
      stand: new THREE.Vector3(cx - dx * 0.3, 0, cz - dz * 0.3),
      avatar: 'sit',
      standY: CHAIR_H,
    });
  }
  return out;
}
