/**
 * Craps "The Bone Pit" — procedural model (MACHINES_tables §7, plan modelBrief, ART_BIBLE §5.9). Pattern: `buildModel`
 * returns a full `MachineModel`; the exported `CrapsParts` type is the contract with `index.ts`. Metres, origin = floor
 * centre of the footprint, +Z = player side (the rail spots), the Hook stands at −Z.
 *
 * Tub table 3.20 × 1.50 m: felt at 0.64 m, rail top 0.92 m (tub depth 0.28). Black felt with a bone-white layout print
 * (2.88 × 1.24 m, drawn by `drawLayout` so the labels follow the language). Budget ≤ 2,500 tris, ≤ 20 draws.
 */
import * as THREE from 'three';
import type { ChipPool, DicePool, Kit, LampPart, ScreenSurface } from '@/kit/types';
import type { MachineModel } from '@/machines/_base/types';
import type { ModelOpts } from '@/machines/_base/MachineBase';
import type { SeatDef } from '@/core/types';
import { makeCanvas } from '@/core/texgen/pixel';

export type CrapsParts = {
  /** Pivot of the stickman's stick (a Group, rotated about X to point at the dice). */
  stick: THREE.Object3D;
  /** The Hook: the stickman mannequin's root (never rotated by the machine). */
  hook: THREE.Object3D;
  /** Two translucent dice (ChipPool-style pool; meshes live under `root`). */
  dice: DicePool;
  /** Puck, OFF side (black) and ON side (bone) children; `on` flips them. */
  puckOff: THREE.Object3D;
  puckOn: THREE.Object3D;
  puck: THREE.Object3D;
  /** Six point-box lamps: 4, 5, 6, 8, 9, 10 (index = PLACE_ORDER). */
  pointLamps: LampPart[];
  /** Six flame lamps on the far rail (Furnace), #FF6A00. */
  furnaceLamps: LampPart[];
  /** Last-10 roll strip on the far wall. */
  last10: ScreenSurface;
  /** Chip pool for every seat's layout (public felt chips). */
  chips: ChipPool;
  /** Eight lamps on the near rail, one per standing spot. */
  seatLamps: LampPart[];
  /** Layout plane (pointer hit-test) and its paint source. */
  layout: THREE.Mesh;
  layoutCanvas: HTMLCanvasElement;
  layoutTex: THREE.CanvasTexture;
  /** Eight throw origins, one per rail spot. */
  throwOrigins: THREE.Object3D[];
  /** Pendant light anchors (BUZZ flicker on seven-out). */
  light: THREE.Object3D;
  light2: THREE.Object3D;
};

export const TOP = 0.64;          // felt height
export const RAIL = 0.92;         // rail top
const HX = 1.6, HZ = 0.75;        // rail half extents
export const SEAT_X: readonly number[] = [-1.12, -0.8, -0.48, -0.16, 0.16, 0.48, 0.8, 1.12];
export const SEAT_Z = 0.95;
export const DICE_REST: readonly [number, number, number][] = [[-0.12, TOP + 0.02, -0.2], [0.12, TOP + 0.02, -0.2]];
export const PLACE_ORDER: readonly number[] = [4, 5, 6, 8, 9, 10];
export const LAYOUT_W = 384, LAYOUT_H = 192;   // 1 px ≈ 0.75 cm over 2.88 × 1.24 m

// Layout spots (felt-plane x, z in metres). Canvas top = far rail (−Z), so z grows toward the players.
const PLACE_Z = 0.34;
/** x of each point number on the place row (also the column of its come / odds rows). */
const NUM_X: Record<number, number> = { 4: -0.8, 5: -0.48, 6: -0.16, 8: 0.16, 9: 0.48, 10: 0.8 };
export const SPOT_XZ: Readonly<Record<string, [number, number]>> = (() => {
  const m: Record<string, [number, number]> = {
    pass: [0, 0.66], odds: [0, 0.52], dpass: [0, -0.66], dodds: [0, -0.52],
    come: [1.18, 0.34], dcome: [-1.18, -0.34],
    'big:6': [-1.18, 0.0], 'big:8': [1.18, 0.0],
    field: [0, 0.06],
    'hard:4': [-0.48, -0.14], 'hard:6': [-0.16, -0.14], 'hard:8': [0.16, -0.14], 'hard:10': [0.48, -0.14],
    'p:2': [-0.8, -0.34], 'p:3': [-0.48, -0.34], anycraps: [-0.16, -0.34], any7: [0.16, -0.34], 'p:11': [0.48, -0.34], 'p:12': [0.8, -0.34],
    horn: [-0.7, -0.52], furnace: [0.7, -0.52], ce: [1.18, -0.52],
    'buy:4': [-0.8, 0.2], 'buy:10': [0.8, 0.2],
  };
  for (const n of PLACE_ORDER) m[`place:${n}`] = [NUM_X[n], PLACE_Z];
  return m;
})();
/** Rows for the come-point odds and travelled come bets (x of the number, z row). */
const COME_Z = 0.46, CODDS_Z = 0.56, DCOME_Z = -0.44, DCODDS_Z = -0.6;

/** Machine-local felt position for any spot id (dynamic come points included). Null for an unknown spot. */
export function spotXZ(spot: string): [number, number] | null {
  const direct = SPOT_XZ[spot];
  if (direct) return direct;
  const [kind, arg = ''] = spot.split(/:(.*)/s);
  const n = Number(arg);
  if (!(n in NUM_X)) return null;
  if (kind === 'come') return [NUM_X[n], COME_Z];
  if (kind === 'codds') return [NUM_X[n], CODDS_Z];
  if (kind === 'dcome') return [NUM_X[n], DCOME_Z];
  if (kind === 'dcodds') return [NUM_X[n], DCODDS_Z];
  return null;
}

/** Box sizes for the printed layout (metres). */
const BOX: Record<string, [number, number]> = {
  pass: [0.9, 0.12], dpass: [0.9, 0.12], odds: [0.5, 0.1], dodds: [0.5, 0.1], field: [1.26, 0.22],
  come: [0.46, 0.2], dcome: [0.46, 0.2], 'big:6': [0.3, 0.2], 'big:8': [0.3, 0.2], furnace: [0.36, 0.14], horn: [0.36, 0.14], ce: [0.36, 0.14],
};
const boxOf = (spot: string): [number, number] => BOX[spot] ?? (spot.startsWith('place') || spot.startsWith('buy') ? [0.3, 0.14] : [0.3, 0.12]);

/** Paints the bone-white layout. `label` maps the `lay.*` keys to the current language. */
export function drawLayout(c: HTMLCanvasElement, label: (key: string) => string): void {
  const g = c.getContext('2d');
  if (!g) return;
  g.fillStyle = '#121212';
  g.fillRect(0, 0, LAYOUT_W, LAYOUT_H);
  const px = (x: number): number => ((x + 1.44) / 2.88) * LAYOUT_W;
  const pz = (z: number): number => ((z + 0.62) / 1.24) * LAYOUT_H;
  g.strokeStyle = '#e8e0c8';
  g.fillStyle = '#e8e0c8';
  g.lineWidth = 1;
  g.font = 'bold 9px monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const spot of Object.keys(SPOT_XZ)) {
    const [x, z] = SPOT_XZ[spot];
    const [w, h] = boxOf(spot);
    const cx = px(x), cy = pz(z), bw = (w / 2.88) * LAYOUT_W, bh = (h / 1.24) * LAYOUT_H;
    g.strokeRect(cx - bw / 2, cy - bh / 2, bw, bh);
    const [kind, arg = ''] = spot.split(':');
    // place boxes show the number only; the rest read as "LABEL n" (e.g. BIG 6, HARD 8, PROP 2)
    const text = kind === 'place' ? arg : arg ? `${label(`lay.${kind}`)} ${arg}` : label(`lay.${spot}`);
    g.fillText(text, cx, cy);
  }
}

export function buildModel(kit: Kit, o: ModelOpts): MachineModel<CrapsParts> {
  const { pal } = kit;
  const root = kit.group('craps');
  const at = (x: number, y: number, z: number): { pos: [number, number, number]; parent: THREE.Object3D } => ({ pos: [x, y, z], parent: root });
  const felt = 0x121212, leather = 0x1b1b1b, bone = 0xe8e0c8, flame = 0xff6a00;
  const walnut = o.variant % 2 ? pal.wood : pal.woodDark;

  // ── static shell (flat colours, merged into one draw) ──
  kit.box(3.2, TOP - 0.02, 1.5, walnut, at(0, (TOP - 0.02) / 2, 0));                 // tub base
  kit.box(2.9, 0.02, 1.22, felt, at(0, TOP - 0.01, 0));                               // black felt floor
  kit.box(3.2, RAIL - TOP, 0.1, leather, at(0, (TOP + RAIL) / 2, HZ - 0.05));           // near wall
  kit.box(3.2, RAIL - TOP, 0.1, leather, at(0, (TOP + RAIL) / 2, -HZ + 0.05));          // far wall
  kit.box(0.1, RAIL - TOP, 1.5, leather, at(-HX + 0.05, (TOP + RAIL) / 2, 0));          // ends
  kit.box(0.1, RAIL - TOP, 1.5, leather, at(HX - 0.05, (TOP + RAIL) / 2, 0));
  kit.box(3.24, 0.04, 0.09, leather, at(0, RAIL - 0.02, HZ + 0.02));                    // padded rail caps
  kit.box(3.24, 0.04, 0.09, leather, at(0, RAIL - 0.02, -HZ - 0.02));
  kit.box(0.09, 0.04, 1.54, leather, at(-HX - 0.02, RAIL - 0.02, 0));
  kit.box(0.09, 0.04, 1.54, leather, at(HX + 0.02, RAIL - 0.02, 0));
  kit.box(2.9, 0.28, 0.02, 0x1e1e1e, at(0, (TOP + RAIL) / 2, -HZ + 0.1));             // rubber pyramid lining (far)
  kit.box(0.02, 0.28, 1.2, 0x1e1e1e, at(-HX + 0.11, (TOP + RAIL) / 2, 0));             // rubber lining (ends)
  kit.box(0.02, 0.28, 1.2, 0x1e1e1e, at(HX - 0.11, (TOP + RAIL) / 2, 0));
  kit.box(0.06, 0.06, 0.06, pal.brass, at(-HX - 0.02, 0.4, -HZ));                       // brass corner feet
  kit.box(0.06, 0.06, 0.06, pal.brass, at(HX + 0.02, 0.4, HZ));
  for (const sx of SEAT_X) kit.box(0.2, 0.06, 0.1, leather, at(sx, RAIL - 0.02, HZ + 0.08)); // chip grooves (rail)
  kit.box(2.4, 0.02, 0.06, pal.bone, at(0, RAIL + 0.01, HZ - 0.02));                    // rail brass strip
  // ceiling pendant (red shade)
  kit.cyl(0.008, 0.008, 1.0, pal.chrome, { pos: [0, 2.7, 0], seg: 4, parent: root });
  kit.cyl(0.12, 0.2, 0.16, { color: 0x7a1a1a }, { pos: [0, 2.2, 0], seg: 12, parent: root });

  // ── layout print (canvas texture, repainted on language change) ──
  const [layoutCanvas] = makeCanvas(LAYOUT_W, LAYOUT_H);
  drawLayout(layoutCanvas, (k) => k);
  const layoutTex = new THREE.CanvasTexture(layoutCanvas);
  layoutTex.colorSpace = THREE.NoColorSpace;
  const layoutMat = kit.mat({ map: layoutTex, lit: false, side: 'double', snap: false, affine: false });
  const layout = kit.plane(2.88, 1.24, layoutMat, { pos: [0, TOP + 0.012, 0], rot: [-90, 0, 0], shade: false, name: 'layout' });
  root.add(layout);

  // ── the Hook: a porcelain-masked stickman behind the table, with his stick ──
  const hook = kit.mannequin({ style: 'porcelain', mask: 'mask_porcelain', height: 1.78, color: 0x1c1c1c, clip: 'Idle_Loop' });
  hook.root.position.set(0, 0, -1.02);
  root.add(hook.root);
  const stick = new THREE.Object3D();
  stick.position.set(0.3, 1.02, -0.92);
  root.add(stick);
  kit.cyl(0.012, 0.012, 1.2, walnut, { pos: [0, 0.2, 0], rot: [0, 0, 18], seg: 6, parent: stick });
  kit.sphere(0.022, bone, { pos: [-0.05, -0.36, 0.02], wSeg: 6, hSeg: 4, parent: stick });   // bone-white finger hook

  // ── last-10 strip on the far wall, behind the Hook ──
  const last10 = kit.screen({ w: 0.9, h: 0.2, px: [64, 16], bezel: pal.black });
  last10.mesh.position.set(0, 1.42, -HZ - 0.12);
  root.add(last10.mesh);

  // ── dice (translucent red, white pips) ──
  const dice = kit.dice({ count: 2, size: 0.019, body: 0xb0101c, pip: 0xffffff });
  dice.dice.forEach((m, i) => { m.position.set(...DICE_REST[i]); root.add(m); });

  // ── puck (OFF black / ON bone) ──
  const puck = new THREE.Object3D();
  puck.position.set(-1.36, TOP + 0.012, 0.5);
  root.add(puck);
  const puckOff = kit.cyl(0.035, 0.035, 0.012, 0x0a0a0a, { pos: [0, 0, 0], seg: 12, parent: puck });
  const puckOn = kit.cyl(0.035, 0.035, 0.012, bone, { pos: [0, 0, 0], seg: 12, parent: puck });
  puckOn.visible = false;

  // ── point lamps (on the place row) and furnace flames (far rail) ──
  const pointLamps: LampPart[] = PLACE_ORDER.map((n) => {
    const l = kit.lamp({ r: 0.02, color: pal.gold, shape: 'dome' });
    const [x, z] = spotXZ(`place:${n}`) ?? [0, 0];
    l.root.position.set(x + 0.1, TOP + 0.014, z - 0.1);
    root.add(l.root);
    return l;
  });
  const furnaceLamps: LampPart[] = [-1.0, -0.6, -0.2, 0.2, 0.6, 1.0].map((x) => {
    const l = kit.lamp({ r: 0.022, color: flame, shape: 'bulb' });
    l.root.position.set(x, RAIL + 0.03, -HZ - 0.02);
    root.add(l.root);
    return l;
  });

  // ── eight rail spots: seat lamps, standing poses, throw origins ──
  const seatLamps: LampPart[] = [];
  const seats: SeatDef[] = [];
  const throwOrigins: THREE.Object3D[] = [];
  SEAT_X.forEach((sx) => {
    const l = kit.lamp({ r: 0.018, color: pal.gold, shape: 'dome' });
    l.root.position.set(sx, RAIL + 0.02, HZ + 0.02);
    root.add(l.root);
    seatLamps.push(l);
    const origin = new THREE.Object3D();
    origin.position.set(sx * 0.7, TOP + 0.16, 0.5);
    root.add(origin);
    throwOrigins.push(origin);
    seats.push({
      pose: { pos: new THREE.Vector3(sx, 1.55, SEAT_Z + 0.15), look: new THREE.Vector3(0, 0.7, -0.2), fov: 62, mouse: 'pick' },
      stand: new THREE.Vector3(sx, 0, SEAT_Z + 0.03), avatar: 'stand',
    });
  });

  // ── chips (instanced, public felt chips) ──
  const chips = kit.chips({ max: 600 });
  root.add(chips.root);

  // ── light, prompt and anchors ──
  root.add(kit.blobShadow(3.4, 1.8));
  const light = new THREE.Object3D();
  light.position.set(-0.8, 2.1, 0);
  light.userData = { color: 0xff6a00, intensity: 1.2, range: 4.0, flicker: 'BUZZ' };
  root.add(light);
  const light2 = new THREE.Object3D();
  light2.position.set(0.8, 2.1, 0);
  light2.userData = { color: 0xff6a00, intensity: 1.2, range: 4.0, flicker: 'BUZZ' };
  root.add(light2);
  const prompt = new THREE.Object3D(); prompt.position.set(0, 1.25, 0.9); root.add(prompt);
  const speaker = new THREE.Object3D(); speaker.position.set(0, RAIL, 0.2); root.add(speaker);
  const label = new THREE.Object3D(); label.position.set(0, 1.25, -HZ - 0.2); root.add(label);
  const marqueeTop = new THREE.Object3D(); marqueeTop.position.set(0, 1.9, -HZ - 0.2); root.add(marqueeTop);
  const servicePlate = new THREE.Object3D(); servicePlate.position.set(HX + 0.2, 0.9, 0.5); root.add(servicePlate);
  const diceCam = new THREE.Object3D(); diceCam.position.set(0, 1.35, 0.5); root.add(diceCam);
  const coinOut = new THREE.Object3D(); coinOut.position.set(0, TOP + 0.02, 0.5); root.add(coinOut);

  const parts: CrapsParts = {
    stick, hook: hook.root, dice, puckOff, puckOn, puck, pointLamps, furnaceLamps, last10, chips, seatLamps,
    layout, layoutCanvas, layoutTex, throwOrigins, light, light2,
  };
  kit.finalize(root, {
    keep: [
      stick, hook.root, puck, chips.root, last10.mesh, layout, light, light2, prompt, ...dice.dice,
      ...pointLamps, ...furnaceLamps, ...seatLamps,
    ],
  });

  return {
    root, parts, seats, playPose: seats[3].pose,
    colliders: [
      { min: [-HX, 0, -HZ], max: [HX, RAIL, HZ] },
      { min: [-0.3, 0, -1.2], max: [0.3, 1.8, -0.88] },
    ],
    interact: { min: [-1.7, 0.2, -1.3], max: [1.7, 1.6, 1.3] },
    anchors: {
      speaker, prompt, label, marqueeTop, servicePlate, diceCam, light, light2, coinOut,
    },
    dispose: () => { last10.dispose(); layoutTex.dispose(); },
  };
}
