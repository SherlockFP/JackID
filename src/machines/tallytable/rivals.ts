/**
 * Rival looks for the Tally Table (Wave 25 TALLY, lane A): each rival is the same PSX mannequin with a body tint, one
 * accent colour and one or two accessory meshes attached to bones. Visual only; the rival's identity and the duel
 * rules come from the engine. Ids match `src/core/ui/manga/portrait.ts` (`PORTRAIT_IDS`).
 */
import * as THREE from 'three';
import type { Kit, MannequinActor } from '@/kit/types';

export interface RivalLook {
  /** The one accent colour (hex), also used for glints and the nameplate. */
  accent: number
  body: number
  joint: number
  /** Mannequin height in metres. */
  height: number
  /** Builds the accessories and attaches them to the actor; returns the detach functions. */
  dress(kit: Kit, a: MannequinActor): Array<() => void>
}

const WHITE = 0xf2f2ee
const BRASS = 0xc9852f

function ring(kit: Kit, a: MannequinActor, r: number, color: number): () => void {
  const m = kit.torus(r, r * 0.28, color, { seg: 10, tubeSeg: 5, rot: [90, 0, 0] })
  return a.attach(m, 'neck_01', { pos: [0, 0.02, 0] })
}

export const RIVAL_LOOKS: Readonly<Record<string, RivalLook>> = {
  // white gloves, silver bob (body tint), jade scarf
  tamsin: {
    accent: 0x4fd6a0, body: 0xcfd3d8, joint: 0x8a9298, height: 1.72,
    dress: (kit, a) => [
      a.attach(kit.sphere(0.055, WHITE, { wSeg: 6, hSeg: 4 }), 'hand_l'),
      a.attach(kit.sphere(0.055, WHITE, { wSeg: 6, hSeg: 4 }), 'hand_r'),
      ring(kit, a, 0.1, 0x4fd6a0),
    ],
  },
  // huge, soot-streaked, brass chest gauge
  kuro: {
    accent: BRASS, body: 0x3a2f2a, joint: 0x1c1816, height: 2.0,
    dress: (kit, a) => {
      const g = new THREE.Group()
      kit.cyl(0.11, 0.11, 0.03, BRASS, { seg: 10, rot: [90, 0, 0], parent: g })
      kit.box(0.012, 0.09, 0.012, 0x101010, { pos: [0, 0.03, 0.02], parent: g })
      return [a.attach(g, 'spine_03', { pos: [0, 0.05, 0.14] }), ring(kit, a, 0.12, 0x2a2420)]
    },
  },
  // ringmaster coat collar and a cracked pocket watch on a chain
  lucan: {
    accent: 0xd03a3a, body: 0x4a1218, joint: 0x1a0a0c, height: 1.84,
    dress: (kit, a) => [ring(kit, a, 0.11, 0xd03a3a), a.attach(kit.prop('watch'), 'hand_l')],
  },
  // oversized yellow coat, one shoe
  mimosa: {
    accent: 0xf2d23a, body: 0xd9c05a, joint: 0x6b5a1c, height: 1.6,
    dress: (kit, a) => [
      a.attach(kit.box(0.4, 0.5, 0.26, 0xf2d23a, { bevel: 0.02 }), 'spine_02', { pos: [0, 0.05, 0] }),
      ring(kit, a, 0.1, 0xb89a1a),
    ],
  },
  // grey tailcoat, the Manager's Key on a chain
  orrin: {
    accent: 0xe0b040, body: 0x6a6a72, joint: 0x2a2a30, height: 1.86,
    dress: (kit, a) => [a.attach(kit.prop('key'), 'hand_r'), ring(kit, a, 0.1, 0xe0b040)],
  },
  // rain coat, tape reels, greyscale
  vell: {
    accent: 0x9a9aa0, body: 0x50505a, joint: 0x202024, height: 1.8,
    dress: (kit, a) => [
      a.attach(kit.cyl(0.08, 0.08, 0.03, 0x9a9aa0, { seg: 10, rot: [0, 0, 90] }), 'clavicle_l', { pos: [0, 0.04, 0] }),
      a.attach(kit.cyl(0.08, 0.08, 0.03, 0x9a9aa0, { seg: 10, rot: [0, 0, 90] }), 'clavicle_r', { pos: [0, 0.04, 0] }),
    ],
  },
}

export const DEFAULT_LOOK: RivalLook = {
  accent: 0xc59c42, body: 0x2a2a30, joint: 0x101014, height: 1.76, dress: () => [],
}

export const lookOf = (rivalId: string): RivalLook => RIVAL_LOOKS[rivalId] ?? DEFAULT_LOOK
