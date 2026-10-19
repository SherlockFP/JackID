/**
 * Round card table for Son Kart (seat-views): a 0.46 m felt with a padded leather rail and a brass line, a walnut apron on four
 * legs (set on the diagonals so the knees at the chairs stay free) and four padded chairs on a 0.67 m circle, each facing the
 * middle. Numbers live in `layout.ts`. (pisti carries its own copy of the older, smaller party table: the machines do not
 * import each other.)
 *
 * Seat order (seen from above, +Z = seat 0's side): 0 = +Z, 1 = -X, 2 = -Z, 3 = +X.
 */
import * as THREE from 'three';
import type { KitX } from '@/kit/index';
import type { SeatDef } from '@/core/types';
import { CHAIR_H, CHAIR_R, FELT_R, FELT_Y, SEAT_DIR, SIT_FWD, seatCamera } from './layout';

export interface PartyTable {
  /** Chair centres (floor), one per seat. */
  chairs: THREE.Vector3[];
  seats: SeatDef[];
}

export function buildPartyTable(kit: KitX, root: THREE.Object3D, feltCol: number): PartyTable {
  const { pal } = kit;
  const wood = pal.woodDark;
  const woodMat = { color: wood, map: kit.tex.wood(wood) };
  const feltMat = { color: feltCol, map: kit.tex.felt(feltCol) };

  // felt disc, padded rail, brass line where felt meets rail, apron
  kit.cyl(FELT_R, FELT_R, 0.03, feltMat, { pos: [0, FELT_Y - 0.015, 0], seg: 24, parent: root });
  kit.torus(FELT_R + 0.035, 0.04, pal.leather, { pos: [0, FELT_Y + 0.005, 0], rot: [90, 0, 0], seg: 24, parent: root });
  kit.torus(FELT_R, 0.006, pal.brass, { pos: [0, FELT_Y + 0.004, 0], rot: [90, 0, 0], seg: 24, parent: root });
  kit.cyl(FELT_R + 0.06, FELT_R + 0.06, 0.1, woodMat, { pos: [0, FELT_Y - 0.08, 0], seg: 24, parent: root });
  for (const a of [45, 135, 225, 315]) {
    const x = Math.sin((a * Math.PI) / 180) * 0.4, z = Math.cos((a * Math.PI) / 180) * 0.4;
    kit.box(0.07, FELT_Y - 0.1, 0.07, woodMat, { pos: [x, (FELT_Y - 0.1) / 2, z], parent: root });
    kit.cyl(0.04, 0.045, 0.025, pal.brass, { pos: [x, 0.0125, z], seg: 8, parent: root });
  }

  const out: PartyTable = { chairs: [], seats: [] };
  SEAT_DIR.forEach(([dx, dz], s) => {
    const cx = dx * CHAIR_R, cz = dz * CHAIR_R;
    out.chairs.push(new THREE.Vector3(cx, 0, cz));
    const chair = kit.chair({ h: CHAIR_H, seat: s % 2 ? pal.redDark : pal.red });
    chair.position.set(cx, 0, cz);
    chair.rotation.y = Math.atan2(-dx, -dz);                       // the chair faces the table
    root.add(chair);
    const cam = seatCamera(s);
    out.seats.push({
      pose: { pos: new THREE.Vector3(...cam.pos), look: new THREE.Vector3(...cam.look), fov: cam.fov, mouse: 'pick' },
      stand: new THREE.Vector3(dx * (CHAIR_R - SIT_FWD), 0, dz * (CHAIR_R - SIT_FWD)),
      avatar: 'sit',
      standY: CHAIR_H,
    });
  });
  return out;
}
