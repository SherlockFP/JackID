/**
 * Rival looks for the Tally Table (Wave 25 TALLY, lane A; wave 88 art pass): each rival is the same PSX mannequin with a body tint,
 * one accent colour and an outfit (kit/mannequinOutfits.ts) that gives them their own silhouette. Visual only; the rival's identity and the duel
 * rules come from the engine. Ids match `src/core/ui/manga/portrait.ts` (`PORTRAIT_IDS`).
 */
import * as THREE from 'three';
import type { Kit, MannequinActor } from '@/kit/types'
import { gloves, lapels, OUTFITS, sleeves, tails, torso, wear, type Piece, type PropFn } from '@/kit/mannequinOutfits'

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

/** The kit prop builder in the outfit's shape (a recolour for the props that take one). */
const propOf = (kit: Kit): PropFn => (id, c) => kit.prop(id, { color: c })
const SIDES = [['l', 1], ['r', -1]] as const

/**
 * Each rival is a silhouette and one accent (docs/ART.md "Characters and props"). On the dark NPC body only the cloth reads, so the
 * accent pieces carry a high `lift`.
 */
export const RIVAL_LOOKS: Readonly<Record<string, RivalLook>> = {
  // TAMSIN: a silver bob, a long jade scarf, white gloves, a fitted dealer's waistcoat
  tamsin: {
    accent: 0x4fd6a0, body: 0xcfd3d8, joint: 0x8a9298, height: 1.72,
    dress: (kit, a) => [wear(a, [
      ...torso(0x2a3a36, 0.36, 0, 0.6),
      { k: 'ball', bone: 'Head', r: 1, pos: [0, 0.185, -0.022], scale: [0.106, 0.085, 0.122], c: 0xd8dce2, lift: 0.51 },
      { k: 'ball', bone: 'Head', r: 1, pos: [0, 0.11, -0.045], scale: [0.112, 0.11, 0.09], c: 0xd8dce2, lift: 0.51 },
      { k: 'tube', bone: 'neck_01', to: 'Head', r: [0.088, 0.082], at: [-0.1, 0.45], c: 0x4fd6a0, lift: 0.6 },
      { k: 'box', bone: 'spine_03', size: [0.06, 0.36, 0.014], pos: [0.065, 0.02, 0.175], rot: [-8, 0, -6], c: 0x4fd6a0, lift: 0.6 },
      { k: 'box', bone: 'spine_03', size: [0.06, 0.5, 0.014], pos: [0.02, -0.05, -0.18], rot: [10, 0, 8], c: 0x4fd6a0, lift: 0.6 },
      ...gloves(WHITE, 0.6),
    ], propOf(kit))],
  },
  // KURO: huge, soot-streaked, brass chest gauge
  kuro: {
    accent: BRASS, body: 0x3a2f2a, joint: 0x1c1816, height: 2.0,
    dress: (kit, a) => {
      const g = new THREE.Group()
      kit.cyl(0.11, 0.11, 0.03, BRASS, { seg: 10, rot: [90, 0, 0], parent: g })
      kit.box(0.012, 0.09, 0.012, 0x101010, { pos: [0, 0.03, 0.02], parent: g })
      return [a.attach(g, 'spine_03', { pos: [0, 0.05, 0.14] }), ring(kit, a, 0.12, 0x2a2420)]
    },
  },
  // LUCAN: the ringmaster: a red tailcoat with gold epaulettes and a high collar, the cracked pocket watch in his hand
  lucan: {
    accent: 0xd03a3a, body: 0x4a1218, joint: 0x1a0a0c, height: 1.84,
    dress: (kit, a) => [wear(a, [
      ...torso(0x7a1a22, 0.42, 0, 1),
      ...sleeves(0x7a1a22, 0.42, 0xd8a840),
      ...tails(0x7a1a22, 0.42, 0.62),
      ...lapels(0x1a0a0c, 0.36, 0.07),
      { k: 'tube', bone: 'neck_01', to: 'Head', r: [0.1, 0.13], at: [-0.2, 0.8], c: 0xd03a3a, lift: 0.6 },
      ...SIDES.map(([, x]): Piece => ({ k: 'box', bone: 'spine_03', size: [0.12, 0.03, 0.13], pos: [x * 0.17, 0.19, -0.01], rot: [0, 0, x * -8], c: 0xd8a840, lift: 0.6 })),
      ...[0.02, 0.07].flatMap((y) => SIDES.map(([, x]): Piece => ({ k: 'ball', bone: 'spine_02', r: 0.013, pos: [x * 0.05, y, 0.17], c: 0xd8a840, lift: 0.6 }))),
      { k: 'prop', id: 'watch', bone: 'hand_l', lift: 0.6 },
    ], propOf(kit))],
  },
  // MIMOSA: an oversized yellow coat (wide sleeves over the hands, a big collar, the hem to the shins) and one red shoe
  mimosa: {
    accent: 0xf2d23a, body: 0xd9c05a, joint: 0x6b5a1c, height: 1.6,
    dress: (kit, a) => [wear(a, [
      { k: 'tube', bone: 'spine_01', to: 'spine_02', r: [0.2, 0.21], sq: 0.9, off: [0, 0, 0.02], c: 0xf2d23a, lift: 0.38 },
      { k: 'tube', bone: 'spine_02', to: 'spine_03', r: [0.21, 0.22], sq: 0.9, c: 0xf2d23a, lift: 0.38 },
      { k: 'tube', bone: 'spine_03', to: 'neck_01', r: [0.23, 0.15], at: [0, 0.9], sq: 0.9, c: 0xf2d23a, lift: 0.38 },
      { k: 'tube', bone: 'neck_01', to: 'Head', r: [0.13, 0.15], at: [-0.3, 0.35], c: 0xf2d23a, lift: 0.38 },
      ...sleeves(0xf2d23a, 0.38, undefined, 0.03),
      ...SIDES.map(([s]): Piece => ({ k: 'tube', bone: `hand_${s}`, to: `middle_01_${s}`, r: [0.1, 0.11], at: [-0.2, 0.6], c: 0xf2d23a, lift: 0.38 })),
      { k: 'prop', id: 'coat_long', c: 0xf2d23a, lift: 0.38, scale: 1.12 },
      { k: 'box', bone: 'foot_l', size: [0.11, 0.24, 0.1], pos: [0.01, 0.07, 0.03], c: 0xb02020, lift: 0.6 },
    ], propOf(kit))],
  },
  // ORRIN, the Collector across the table: his overcoat, gloves and hat, the Manager's Key in his hand
  orrin: {
    accent: 0xe0b040, body: 0x6a6a72, joint: 0x2a2a30, height: 1.86,
    dress: (kit, a) => [wear(a, OUTFITS.collector.filter((p) => !(p.k === 'prop' && p.id === 'ledger')), propOf(kit)), a.attach(kit.prop('key'), 'hand_r')],
  },
  // VELL: a long grey raincoat belted at the waist, a flat cap, the tape reels on his shoulders (greyscale, no colour)
  vell: {
    accent: 0x9a9aa0, body: 0x50505a, joint: 0x202024, height: 1.8,
    dress: (kit, a) => [wear(a, [
      ...torso(0x5a5a62, 0.36, 0.01, 1),
      ...sleeves(0x5a5a62, 0.36),
      { k: 'tube', bone: 'neck_01', to: 'Head', r: [0.095, 0.11], at: [-0.2, 0.7], c: 0x5a5a62, lift: 0.36 },
      { k: 'tube', bone: 'spine_01', to: 'spine_02', r: [0.158, 0.16], at: [0.1, 0.3], sq: 0.84, off: [0, 0, 0.02], c: 0x1e1e22, lift: 0.36 },
      { k: 'prop', id: 'coat_long', c: 0x5a5a62, lift: 0.36, scale: 1.08 },
      { k: 'prop', id: 'hat_flatcap', c: 0x6a6a72, lift: 0.36 },
      ...SIDES.map(([s]): Piece => ({ k: 'tube', bone: `clavicle_${s}`, to: `upperarm_${s}`, r: [0.08, 0.08], at: [0.55, 0.62], seg: 10, c: 0x9a9aa0, lift: 0.6 })),
    ], propOf(kit))],
  },
}

export const DEFAULT_LOOK: RivalLook = {
  accent: 0xc59c42, body: 0x2a2a30, joint: 0x101014, height: 1.76, dress: () => [],
}

export const lookOf = (rivalId: string): RivalLook => RIVAL_LOOKS[rivalId] ?? DEFAULT_LOOK
