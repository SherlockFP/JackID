/**
 * Character look presets (wave 88 art pass, docs/ART.md "Characters and props"). Every character is the same mannequin rig and
 * clip set; what tells them apart is clothing built in bone space, one colour accent and a silhouette:
 *
 *  - `tube`: a sleeve, a coat panel or a collar, an (elliptic) open cone from a bone toward its child. The direction is measured
 *    on the rig, so it follows the skeleton whatever its axes are;
 *  - `box` / `ball`: towels, lapels, gloves, tails, buttons, a bob of hair, in the bone's own space (+Y along the bone; on the
 *    spine and head +Z is the front);
 *  - `prop`: a kit prop (hat, ledger, mic, bow tie) on its attach hint, recoloured by `c`.
 *
 * Pieces on one bone with one colour are merged into one mesh. On a dark NPC (mannequin `npc`) every piece goes through the NPC
 * look, and `lift` (the share of the colour that survives the near-black body, default 0.6) is what makes the cloth read.
 * Units: the GLB's bone space, metres at a 1.83 m rig (torso radius about 0.13 to 0.16, upper arm 0.076, forearm 0.06,
 * thigh 0.09, neck 0.067; the face is at z +0.11 of `Head`).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Hex, V3 } from '@/core/types';
import { disposeObject3D } from '@/core/dispose';
import { psx } from './materials';
import type { MannequinActor } from './types';

const D2R = Math.PI / 180;

interface Cloth { c: Hex; lift?: number }
export type Piece =
  | (Cloth & { k: 'tube'; bone: string; to: string; r: readonly [number, number]; at?: readonly [number, number]; sq?: number; seg?: number; off?: V3 })
  | (Cloth & { k: 'box'; bone: string; size: V3; pos: V3; rot?: V3 })
  | (Cloth & { k: 'ball'; bone: string; r: number; pos: V3; scale?: V3 })
  | { k: 'prop'; id: string; bone?: string; pos?: V3; rot?: V3; scale?: number; c?: Hex; lift?: number };

/** A built piece: attach `obj` to `bone` (with `o` for props placed by hand). */
export interface WornPiece { bone: string; obj: THREE.Object3D; o?: { pos?: V3; rot?: V3; scale?: number } }
export type PropFn = (id: string, color?: Hex) => THREE.Object3D;

const DEFAULT_LIFT = 0.36;

/** The cone of a `tube` piece in `bone` space, or null when a bone is missing. */
function tubeGeo(p: Extract<Piece, { k: 'tube' }>, bone: (n: string) => THREE.Object3D | null): THREE.BufferGeometry | null {
  const b = bone(p.bone), ch = bone(p.to);
  if (!b || !ch) return null;
  b.updateWorldMatrix(true, false);
  ch.updateWorldMatrix(true, false);
  const d = b.worldToLocal(ch.getWorldPosition(new THREE.Vector3()));
  const len = d.length();
  if (len < 1e-4) return null;
  const [a0, a1] = p.at ?? [0, 1];
  const h = len * (a1 - a0);
  const g = new THREE.CylinderGeometry(p.r[1], p.r[0], h, p.seg ?? 9, 1, true);      // +Y end = toward the child
  g.scale(1, 1, p.sq ?? 1);
  g.translate(p.off?.[0] ?? 0, len * a0 + h / 2, p.off?.[2] ?? 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  return g;
}

function solidGeo(p: Extract<Piece, { k: 'box' | 'ball' }>): THREE.BufferGeometry {
  const g = p.k === 'box' ? new THREE.BoxGeometry(p.size[0], p.size[1], p.size[2]) : new THREE.SphereGeometry(p.r, 8, 6);
  if (p.k === 'ball' && p.scale) g.scale(p.scale[0], p.scale[1], p.scale[2]);
  if (p.k === 'box' && p.rot) g.applyQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(p.rot[0] * D2R, p.rot[1] * D2R, p.rot[2] * D2R)));
  g.translate(p.pos[0], p.pos[1], p.pos[2]);
  return g;
}

/**
 * Build an outfit on a rig: one mesh per (bone, colour, lift), plus the props. Bones come from `bone` (a live actor's `bone()` or the
 * rig map). Tubes need the rig in place; build before any non-uniform bone scale is applied (the female build scales the spine).
 */
export function buildOutfit(bone: (n: string) => THREE.Object3D | null, pieces: readonly Piece[], prop?: PropFn): WornPiece[] {
  const groups = new Map<string, { bone: string; c: Hex; lift: number; geos: THREE.BufferGeometry[] }>();
  const out: WornPiece[] = [];
  for (const p of pieces) {
    if (p.k === 'prop') {
      if (!prop) continue;
      const obj = prop(p.id, p.c);
      if (p.lift !== undefined) obj.userData.npcLift = p.lift;
      const hint = obj.userData.attachHint as { bone?: string } | undefined;
      out.push({ bone: p.bone ?? hint?.bone ?? 'hand_r', obj, o: p.pos || p.rot || p.scale !== undefined ? { pos: p.pos, rot: p.rot, scale: p.scale } : undefined });
      continue;
    }
    const geo = p.k === 'tube' ? tubeGeo(p, bone) : solidGeo(p);
    if (!geo) continue;
    const lift = p.lift ?? DEFAULT_LIFT;
    const key = `${p.bone}|${p.c}|${lift}`;
    let gr = groups.get(key);
    if (!gr) { gr = { bone: p.bone, c: p.c, lift, geos: [] }; groups.set(key, gr); }
    gr.geos.push(geo.index ? geo.toNonIndexed() : geo);
    if (geo.index) geo.dispose();
  }
  for (const gr of groups.values()) {
    for (const g of gr.geos) g.deleteAttribute('uv');
    const geo = mergeGeometries(gr.geos);
    for (const g of gr.geos) g.dispose();
    if (!geo) continue;
    const grp = new THREE.Group();
    grp.name = `outfit_${gr.bone}`;
    grp.add(new THREE.Mesh(geo, psx({ color: gr.c, side: 'double' })));
    grp.userData.npcLift = gr.lift;
    out.push({ bone: gr.bone, obj: grp });
  }
  return out;
}

/**
 * Dress a live actor in `pieces` (now, or once its rig has loaded). Returns the undress function: it detaches every piece and frees
 * their geometry (shared materials stay).
 */
export function wear(a: MannequinActor, pieces: readonly Piece[], prop?: PropFn): () => void {
  const worn: Array<{ off: () => void; obj: THREE.Object3D }> = [];
  let gone = false;
  const go = (): void => {
    if (gone) return;
    for (const w of buildOutfit((n) => a.bone(n), pieces, prop)) worn.push({ off: a.attach(w.obj, w.bone, w.o), obj: w.obj });
  };
  if (a.isReady) go(); else void a.ready.then(go);
  return () => {
    gone = true;
    for (const w of worn.splice(0)) { w.off(); disposeObject3D(w.obj); }
  };
}

// ── pieces that several looks share ───────────────────────────────────────────────────────────────
const SIDES = ['l', 'r'] as const;
type Side = (typeof SIDES)[number];
const both = (f: (s: Side, x: 1 | -1) => Piece[]): Piece[] => SIDES.flatMap((s) => f(s, s === 'l' ? 1 : -1));

/** A jacket or a coat over the torso: waist, chest, shoulders up to the neck (`flare` widens the waist). */
export function torso(c: Hex, lift?: number, flare = 0, top = 0.85): Piece[] {
  return [
    { k: 'tube', bone: 'spine_01', to: 'spine_02', r: [0.148 + flare, 0.165], sq: 0.82, off: [0, 0, 0.02], c, lift },
    { k: 'tube', bone: 'spine_02', to: 'spine_03', r: [0.168, 0.182], sq: 0.82, off: [0, 0, 0.012], c, lift },
    { k: 'tube', bone: 'spine_03', to: 'neck_01', r: [0.19, 0.12], at: [0, top], sq: 0.86, off: [0, 0, -0.012], c, lift },
  ];
}
/** Sleeves from the shoulder to the wrist (`cuff`: a band at the wrist in another colour). */
export function sleeves(c: Hex, lift?: number, cuff?: Hex, wide = 0): Piece[] {
  return both((s) => [
    { k: 'tube', bone: `clavicle_${s}`, to: `upperarm_${s}`, r: [0.07, 0.088 + wide], at: [0.25, 1], c, lift },
    { k: 'tube', bone: `upperarm_${s}`, to: `lowerarm_${s}`, r: [0.088 + wide, 0.078 + wide], c, lift },
    { k: 'tube', bone: `lowerarm_${s}`, to: `hand_${s}`, r: [0.072 + wide, 0.066 + wide * 1.4], at: [0, cuff ? 0.84 : 0.95], c, lift },
    ...(cuff ? [{ k: 'tube', bone: `lowerarm_${s}`, to: `hand_${s}`, r: [0.07 + wide, 0.069 + wide * 1.4], at: [0.84, 0.97], c: cuff, lift } as Piece] : []),
  ]);
}
/** Gloves: a cuff over the wrist and a padded palm over the hand (the fingers keep the joint colour). */
export function gloves(c: Hex, lift?: number): Piece[] {
  return both((s, x) => [
    { k: 'tube', bone: `lowerarm_${s}`, to: `hand_${s}`, r: [0.064, 0.07], at: [0.82, 1.04], c, lift },
    { k: 'box', bone: `hand_${s}`, size: [0.062, 0.115, 0.104], pos: [x * 0.012, 0.055, 0], c, lift },
  ]);
}
/** Two lapels on the chest, turned out from the neck. */
export function lapels(c: Hex, lift?: number, w = 0.06): Piece[] {
  return both((_s, x) => [{ k: 'box', bone: 'spine_03', size: [w, 0.2, 0.014], pos: [x * 0.055, 0.1, 0.162], rot: [-12, x * 8, x * 16], c, lift }]);
}
/** Coat tails hanging behind from the waist. */
export function tails(c: Hex, lift?: number, len = 0.5): Piece[] {
  return both((_s, x) => [{ k: 'box', bone: 'pelvis', size: [0.13, len, 0.014], pos: [x * 0.07, 0.02 - len / 2, -0.15], rot: [-8, 0, x * -5], c, lift }]);
}

// ── the looks ──────────────────────────────────────────────────────────────────────────────────────
export type OutfitId = 'collector' | 'selim' | 'compere' | 'loki';

/**
 * THE COLLECTOR (Tahsildar): a tired, precise debt man. A long charcoal overcoat with its collar up, black leather gloves, the
 * wide-brimmed hat with a gold band, and the ledger in his left hand.
 */
const COAT = 0x2c2a30, LEATHER = 0x141216;
const COLLECTOR: Piece[] = [
  ...torso(COAT, 0.33, 0.01, 1),
  { k: 'tube', bone: 'neck_01', to: 'Head', r: [0.098, 0.112], at: [-0.2, 0.75], sq: 0.92, c: COAT, lift: 0.36 },   // the collar, turned up
  ...lapels(0x3a3640, 0.42, 0.07),
  ...sleeves(COAT, 0.33),
  ...gloves(LEATHER, 0.21),
  ...both((_s, x) => [{ k: 'ball', bone: 'spine_02', r: 0.012, pos: [x * 0.045, 0.05, 0.165], c: 0xc9a040, lift: 0.54 }]),   // buttons
  { k: 'prop', id: 'coat_long', c: COAT, lift: 0.33 },
  { k: 'prop', id: 'hat_collector', lift: 0.3 },
  { k: 'prop', id: 'ledger', lift: 0.42 },
];

/**
 * SELIM, the bartender and the friend: a cream shirt with the sleeves rolled to the elbow, a brown waistcoat with brass buttons,
 * a bar towel over his left shoulder and a half apron.
 */
const SHIRT = 0xe6dccb, VEST = 0x4a2c1c, TOWEL = 0xf0ece2;
const SELIM: Piece[] = [
  ...torso(VEST, 0.36, 0, 0.62),
  { k: 'box', bone: 'spine_03', size: [0.07, 0.13, 0.012], pos: [0, 0.11, 0.17], rot: [-14, 0, 0], c: SHIRT, lift: 0.51 },      // the shirt in the V
  { k: 'tube', bone: 'spine_03', to: 'neck_01', r: [0.13, 0.09], at: [0.6, 1.05], sq: 0.9, c: SHIRT, lift: 0.51 },             // shirt yoke
  { k: 'tube', bone: 'neck_01', to: 'Head', r: [0.074, 0.075], at: [0, 0.45], c: SHIRT, lift: 0.51 },                           // collar
  ...both((s) => [
    { k: 'tube', bone: `clavicle_${s}`, to: `upperarm_${s}`, r: [0.07, 0.086], at: [0.25, 1], c: SHIRT, lift: 0.51 },
    { k: 'tube', bone: `upperarm_${s}`, to: `lowerarm_${s}`, r: [0.086, 0.08], c: SHIRT, lift: 0.51 },
    { k: 'tube', bone: `lowerarm_${s}`, to: `hand_${s}`, r: [0.082, 0.074], at: [-0.04, 0.16], c: SHIRT, lift: 0.57 },        // the roll
  ]),
  ...[0.03, 0.075].flatMap((y) => [{ k: 'ball', bone: 'spine_02', r: 0.011, pos: [0, y, 0.172], c: 0xd0a040, lift: 0.6 } as Piece]),
  { k: 'ball', bone: 'spine_03', r: 0.011, pos: [0, 0.035, 0.168], c: 0xd0a040, lift: 0.6 },
  // the towel: folded over the left shoulder, hanging front and back
  { k: 'box', bone: 'spine_03', size: [0.085, 0.022, 0.32], pos: [0.13, 0.205, 0], c: TOWEL, lift: 0.54 },
  { k: 'box', bone: 'spine_03', size: [0.085, 0.24, 0.016], pos: [0.13, 0.09, 0.168], rot: [-6, 0, 0], c: TOWEL, lift: 0.54 },
  { k: 'box', bone: 'spine_03', size: [0.085, 0.3, 0.016], pos: [0.13, 0.06, -0.17], rot: [6, 0, 0], c: TOWEL, lift: 0.54 },
  { k: 'box', bone: 'spine_03', size: [0.087, 0.012, 0.018], pos: [0.13, 0.0, 0.17], c: 0xb03030, lift: 0.54 },                // the towel's red stripe
  // half apron from the waist
  { k: 'box', bone: 'pelvis', size: [0.32, 0.44, 0.014], pos: [0, -0.16, 0.15], rot: [-4, 0, 0], c: 0x2a2a2e, lift: 0.42 },
  { k: 'tube', bone: 'pelvis', to: 'spine_01', r: [0.152, 0.152], at: [0.3, 0.55], sq: 0.86, c: 0x2a2a2e, lift: 0.42 },          // its band
];

/**
 * THE COMPERE, the showman: a black tuxedo with satin lapels and long tails, white cuffs and shirt front, a red bow tie, a top hat
 * and a hand microphone. The cold cyan rim is his own.
 */
const TUX = 0x16161c, SATIN = 0x4a4a5c;
const COMPERE: Piece[] = [
  ...torso(TUX, 0.36, 0, 1),
  { k: 'box', bone: 'spine_03', size: [0.08, 0.17, 0.012], pos: [0, 0.09, 0.172], rot: [-14, 0, 0], c: 0xf2f0ea, lift: 0.6 },
  ...lapels(SATIN, 0.54, 0.065),
  ...sleeves(TUX, 0.36, 0xf2f0ea),
  ...tails(TUX, 0.36, 0.56),
  { k: 'prop', id: 'bowtie', c: 0xd02030, lift: 0.6 },
  { k: 'prop', id: 'hat_top', lift: 0.36 },
  { k: 'prop', id: 'mic', lift: 0.54 },
];

/**
 * LOKI, the borrowed memory (docs/JOKER.md §1): the Compere as he was when he still won. A slim black suit with the Compere's satin
 * on narrow lapels, a white shirt open at the collar, the Compere's red worn as a loosened tie, slicked-back hair and a playing card
 * between the right fingers. No hat, no tails, no mic: the hint is in the cloth and the colours, not the costume. The green grin
 * pin and the face are lit marks the apparition adds (game/joker/lokiArt.ts).
 */
const SLIM = 0x121216, HAIR = 0x0e0c0c;
const LOKI: Piece[] = [
  ...torso(SLIM, 0.4, -0.006, 1),
  { k: 'tube', bone: 'pelvis', to: 'spine_01', r: [0.17, 0.158], at: [-0.75, 0.2], sq: 0.84, off: [0, 0, 0.012], c: SLIM, lift: 0.4 },   // jacket skirt over the hips
  { k: 'box', bone: 'spine_03', size: [0.085, 0.19, 0.012], pos: [0, 0.09, 0.172], rot: [-14, 0, 0], c: 0xf2f0ea, lift: 0.62 },        // shirt in the V
  { k: 'tube', bone: 'neck_01', to: 'Head', r: [0.074, 0.08], at: [0, 0.4], c: 0xf2f0ea, lift: 0.62 },                                  // open collar
  ...lapels(SATIN, 0.56, 0.05),
  ...sleeves(SLIM, 0.4, 0xf2f0ea),
  // the loosened tie: the knot pulled down and off-centre, the blade hanging a little crooked
  { k: 'box', bone: 'spine_03', size: [0.036, 0.034, 0.02], pos: [0.01, 0.15, 0.182], rot: [-14, 0, -8], c: 0xd02030, lift: 0.66 },
  { k: 'box', bone: 'spine_03', size: [0.042, 0.2, 0.01], pos: [0.016, 0.03, 0.188], rot: [-10, 0, -5], c: 0xd02030, lift: 0.66 },
  // slicked back: a low crown swept to the nape, the forehead left clear
  { k: 'ball', bone: 'Head', r: 0.1, pos: [0, 0.222, -0.036], scale: [0.96, 0.56, 1.22], c: HAIR, lift: 0.5 },
  { k: 'ball', bone: 'Head', r: 0.1, pos: [0, 0.14, -0.062], scale: [0.93, 0.9, 0.7], c: HAIR, lift: 0.5 },
  // a card between the right fingers
  { k: 'box', bone: 'hand_r', size: [0.006, 0.09, 0.064], pos: [0, 0.13, 0.03], rot: [0, 0, 8], c: 0xf4f0e6, lift: 0.9 },
];

export const OUTFITS: Readonly<Record<OutfitId, readonly Piece[]>> = { collector: COLLECTOR, selim: SELIM, compere: COMPERE, loki: LOKI };
