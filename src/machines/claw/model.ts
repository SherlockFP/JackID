/**
 * Claw Crane — procedural model (MACHINES_machines §15, plan.json modelBrief, ART_BIBLE §5.23).
 *  - `buildModel(kit, o)` returns the full `MachineModel` and nothing else touches the scene;
 *  - `ClawParts` is the contract with `index.ts`; metres, origin = floor centre, +Z = front (the player side).
 *
 * Cabinet 0.90 W × 0.90 D × 1.95 H. Candy-pink body (colourway 0–3), mint trim. Glass play box 0.80³ at y 0.95–1.75
 * with an interior light. Gantry (X/Z) carries the cable and the three-prong claw (Y driven). The pile sits on the
 * box floor, 20 prizes on two layers (`prizes[id]`, the id is the rules' prize id). Prize chute front-left, a doll
 * head at the back right (never grabbable), a joystick, the DROP dome, the marquee with 16 chase bulbs, LEDs and a
 * 2-digit timer.
 *
 * BUDGET: the brief asks ≤ 1,300 tris and ≤ 14 draws. Tris stay well inside. Draws are NOT: the 20 pile prizes are
 * individual meshes so the carried one can move, which costs ~20 draws. A pooled InstancedMesh is the T2 fix.
 */
import * as THREE from 'three';
import type { ButtonPart, LampPart, LedPanelPart, MarqueePart } from '@/kit/types';
import type { KitX } from '@/kit/index';
import type { MachineModel } from '@/machines/_base/types';
import type { ModelOpts } from '@/machines/_base/MachineBase';
import { CHUTE, type Kind } from './rules';

export type ClawParts = {
  gantry: THREE.Group;          // X/Z carriage inside the box
  clawHead: THREE.Group;        // Y driven on the cable
  cable: THREE.Mesh;            // unit cylinder scaled in Y
  prongs: THREE.Group[];        // 3 pivots, arm + elbow each; rotation.z = −close angle
  prizes: THREE.Object3D[];     // 20, index = prize id
  prizeMats: Record<Kind, THREE.Material>;
  dollHead: THREE.Group;        // porcelain head, turns to the player on each drop
  chuteLamp: LampPart;          // #FFFF80 flash on delivery
  joystick: THREE.Group;        // tilt pivot (±0.35 rad)
  buttons: { drop: ButtonPart };
  marquee: MarqueePart;
  leds: { credit: LampPart; bet: LampPart; win: LampPart };
  timer: LedPanelPart;
};

export const BOX = 0.80;           // play box edge
export const FLOOR_Y = 0.97;       // box floor, top face
export const BOX_TOP_Y = 1.75;
export const RAIL_Y = 1.72;        // gantry rail height
export const HEAD_TOP = 0.58;      // claw head height below the rail, open
export const HEAD_DOWN = 0.90;     // claw head height below the rail, at the floor
export const PRONG_R = 0.035;
export const PRONG_OPEN = 0.15;    // rad
export const PRONG_STRONG = 0.9;   // rad, close angle for a strong grip
export const PRONG_WEAK = 0.6;     // rad, close angle for a weak grip
export const PROP_H = 0.05;        // prize centre height above the floor (bottom layer)
export const TOP_LAYER_Y = 0.12;   // extra height of the top layer

const BODY: readonly number[] = [0xff5fa2, 0x7fd8b8, 0x2f4fa8, 0x6b1020];   // pink, mint, cobalt, oxblood
const TRIM: readonly number[] = [0x7fffd4, 0xffe8f4, 0xff5fa2, 0xffd040];
const SACK = 0xa0784a;
const CAP_C = 0xd8f4ff;
const CAP_R = 0xffd080;
const EGG = 0xffd040;
const PORCELAIN = 0xf2ebe0;
const INTERIOR = 0xfff0f8;
const CHUTE_DARK = 0x1a0a14;

/** Floor-plan position of a pile prize; `layer` lifts it. */
export function pileSpot(x: number, z: number, layer: 0 | 1): { x: number; y: number; z: number } {
  return { x, y: FLOOR_Y + PROP_H + (layer ? TOP_LAYER_Y : 0), z };
}

/** The chute centre in model space (the prize drop point on the floor, box-local x/z). */
/** Scale of the shared prize sphere (r 0.05) per kind: sacks grow S → M → L, the egg is tall, capsules are small. */
const PRIZE_SCALE: Readonly<Record<Kind, readonly [number, number, number]>> = {
  sackS: [0.9, 0.8, 0.9], sackM: [1.1, 0.95, 1.1], sackL: [1.4, 1.1, 1.4],
  capC: [0.8, 0.8, 0.8], capR: [0.8, 0.8, 0.8], egg: [0.7, 1.0, 0.7],
};

/** Pile slot mesh. `dressPrize` swaps its material and scale to the kind it holds (one draw per slot). */
function prizeMesh(kit: KitX): THREE.Mesh {
  return kit.sphere(0.05, SACK, { wSeg: 8, hSeg: 6 });
}

/** Give pile slot `id` the look of `kind` (scale and material; the prize's own geometry is shared). */
export function dressPrize(parts: ClawParts, id: number, kind: Kind): void {
  const m = parts.prizes[id] as THREE.Mesh | undefined;
  if (!m) return;
  m.material = parts.prizeMats[kind];
  const s = PRIZE_SCALE[kind];
  m.scale.set(s[0], s[1], s[2]);
}

/** Contract between modeler and coder. */
export function buildModel(kit: KitX, o: ModelOpts): MachineModel<ClawParts> {
  const { pal } = kit;
  const body = BODY[o.variant] ?? BODY[0];
  const trim = TRIM[o.variant] ?? TRIM[0];
  const steel = 0x3a2a34;
  const chrome = pal.chrome;
  const root = kit.group('claw');
  const at = (x: number, y: number, z: number): { pos: [number, number, number]; parent: THREE.Object3D } => ({ pos: [x, y, z], parent: root });

  // ── cabinet shell (flat colours: merged by kit.finalize) ──
  kit.box(0.90, 0.95, 0.90, body, at(0, 0.475, 0));                    // base, top at 0.95
  kit.box(0.90, 0.20, 0.90, body, at(0, 1.85, 0));                     // head, marquee area 1.75–1.95
  kit.box(0.84, 0.04, 0.84, steel, at(0, 0.02, 0));                    // plinth
  for (const sx of [-1, 1]) kit.box(0.02, 0.80, 0.84, trim, at(sx * 0.46, 0.55, 0));   // trim strips on the sides
  kit.box(0.92, 0.02, 0.92, trim, at(0, 0.96, 0));                     // mint lip under the box
  kit.box(0.92, 0.02, 0.92, trim, at(0, 1.76, 0));                     // mint lip over the box

  // the play box: a floor, four glass walls (the glass is a single transparent mesh)
  kit.box(BOX, 0.02, BOX, INTERIOR, at(0, FLOOR_Y - 0.01, 0));
  const glass = kit.glass({ w: BOX, h: BOX - 0.02, d: BOX, tint: pal.glass, opacity: 0.18 });
  glass.position.set(0, (0.95 + BOX_TOP_Y) / 2, 0);
  root.add(glass);

  // prize chute: dark hole in the floor (front-left) and an acrylic guard, a tube down the front
  kit.box(0.22, 0.01, 0.22, CHUTE_DARK, { pos: [CHUTE.x, FLOOR_Y + 0.005, CHUTE.z], parent: root });
  kit.box(0.22, 0.15, 0.01, pal.glass, { pos: [CHUTE.x, 1.05, CHUTE.z + 0.11], parent: root });
  kit.box(0.24, 0.22, 0.24, steel, { pos: [CHUTE.x, 0.85, 0.36], parent: root });   // chute bin on the front
  const chuteLamp = kit.lamp({ r: 0.02, color: 0xffff80, shape: 'dome' });
  chuteLamp.root.position.set(CHUTE.x, 1.05, CHUTE.z);
  root.add(chuteLamp.root);

  // gantry: a bridge over the box on two rails, then the cable and the claw head
  const gantry = kit.group('claw_gantry');
  gantry.position.set(0, RAIL_Y, 0);
  root.add(gantry);
  for (const sx of [-1, 1]) kit.box(0.02, 0.02, BOX, chrome, { pos: [sx * 0.42, RAIL_Y, 0], parent: root });   // Z rails
  kit.box(BOX, 0.02, 0.02, steel, { pos: [0, RAIL_Y, 0.42], parent: root });                                 // front rail
  kit.box(BOX, 0.02, 0.02, chrome, { parent: gantry });                                                       // X bar (rides the Z rails)
  kit.box(0.10, 0.06, 0.10, steel, { pos: [0, -0.02, 0], parent: gantry });                                   // carriage block

  const cable = kit.cyl(0.004, 0.004, 1, steel, { parent: gantry, seg: 5 });
  cable.scale.set(1, HEAD_TOP, 1);
  cable.position.y = -HEAD_TOP / 2;
  const clawHead = kit.group('claw_head');
  clawHead.position.set(0, -HEAD_TOP, 0);
  gantry.add(clawHead);
  kit.cyl(0.03, 0.03, 0.02, steel, { pos: [0, 0.01, 0], parent: clawHead, seg: 8 });   // hub

  const prongs: THREE.Group[] = [];
  for (let i = 0; i < 3; i++) {
    const th = (i * 2 * Math.PI) / 3;
    const pivot = kit.group(`prong_${i}`);
    pivot.position.set(PRONG_R * Math.cos(th), -0.012, PRONG_R * Math.sin(th));
    pivot.rotation.y = -th;
    pivot.rotation.z = -PRONG_OPEN;
    clawHead.add(pivot);
    kit.box(0.008, 0.07, 0.008, chrome, { pos: [0.012, -0.035, 0], parent: pivot });   // segment 1
    const elbow = kit.group(`prong_${i}_elbow`);
    elbow.position.set(0.012, -0.07, 0);
    elbow.rotation.z = 0.35;
    pivot.add(elbow);
    kit.box(0.008, 0.06, 0.008, chrome, { pos: [0.005, -0.03, 0], parent: elbow });   // segment 2
    prongs.push(pivot);
  }

  // prizes: one mesh per pile slot, dressed and placed by `index.ts` from the pile state
  const prizes: THREE.Object3D[] = [];
  for (let i = 0; i < 20; i++) {
    const p = prizeMesh(kit);
    p.visible = false;
    root.add(p);
    prizes.push(p);
  }
  const prizeMats = {
    sackS: kit.mat(SACK), sackM: kit.mat(SACK), sackL: kit.mat(SACK),
    capC: kit.mat(CAP_C), capR: kit.mat(CAP_R), egg: kit.mat(EGG),
  } as Record<Kind, THREE.Material>;

  // doll head: porcelain, rests facing the back until a drop turns it to the player
  const dollHead = kit.group('claw_doll');
  dollHead.position.set(0.24, FLOOR_Y + 0.12, -0.24);
  dollHead.rotation.y = Math.PI;
  root.add(dollHead);
  kit.sphere(0.05, PORCELAIN, { parent: dollHead, wSeg: 10, hSeg: 8 });
  kit.box(0.03, 0.01, 0.008, 0x3a2030, { pos: [0.02, 0.012, 0.045], parent: dollHead });   // eye line
  kit.box(0.03, 0.01, 0.008, 0x3a2030, { pos: [-0.02, 0.012, 0.045], parent: dollHead });

  // control panel at 1.00 m: joystick, DROP dome, LEDs, a 2-digit timer, the cabinet label
  const joystick = kit.group('claw_joy');
  joystick.position.set(-0.18, 1.00, 0.46);
  root.add(joystick);
  kit.cyl(0.012, 0.012, 0.02, steel, { pos: [0, 0.01, 0], parent: joystick, seg: 8 });
  kit.cyl(0.006, 0.006, 0.08, chrome, { pos: [0, 0.06, 0], parent: joystick, seg: 6 });
  kit.sphere(0.02, pal.red, { pos: [0, 0.10, 0], parent: joystick, wSeg: 8, hSeg: 6 });
  joystick.rotation.x = -0.1;

  const drop = kit.button({ shape: 'round', r: 0.06, color: pal.red, lit: true });
  drop.root.position.set(0.12, 1.00, 0.46);
  root.add(drop.root);

  const leds = {
    credit: kit.lamp({ r: 0.012, color: pal.red, shape: 'flat' }),
    bet: kit.lamp({ r: 0.012, color: pal.neonYellow, shape: 'flat' }),
    win: kit.lamp({ r: 0.012, color: pal.green, shape: 'flat' }),
  };
  leds.credit.root.position.set(0.22, 1.08, 0.455);
  leds.bet.root.position.set(0.25, 1.08, 0.455);
  leds.win.root.position.set(0.28, 1.08, 0.455);
  root.add(leds.credit.root, leds.bet.root, leds.win.root);

  const timer = kit.ledPanel({ digits: 2, color: '#ff5fa2', h: 0.05 });
  timer.root.position.set(-0.04, 1.08, 0.455);
  root.add(timer.root);

  const marquee = kit.marquee({ w: 0.8, h: 0.2, text: { key: 'm.claw.marquee' }, color: pal.neonYellow, bg: pal.black, bulbs: 16 });
  marquee.root.position.set(0, 1.85, 0.46);
  root.add(marquee.root);

  // interior lamps (light hints for the world's pooled lights)
  const anchor = (x: number, y: number, z: number): THREE.Object3D => { const o3 = new THREE.Object3D(); o3.position.set(x, y, z); root.add(o3); return o3; };
  const light = anchor(-0.25, 1.70, 0.25);
  light.userData = { color: INTERIOR, intensity: 0.7, range: 1.5, flicker: 'STEADY' };
  const light2 = anchor(0.25, 1.70, -0.25);
  light2.userData = { color: INTERIOR, intensity: 0.7, range: 1.5, flicker: 'STEADY' };

  const speaker = anchor(0, 0.5, 0.455);
  const prompt = anchor(0, 1.25, 0.2);
  const label = anchor(0, 0.78, 0.455);
  const marqueeTop = anchor(0, 1.96, 0);
  const servicePlate = anchor(-0.46, 0.5, 0);
  const stand = anchor(0, 0, 0.78);
  const coinOut = anchor(CHUTE.x, 0.80, 0.48);
  // RMB side-peek: 70° to the right of the box, 0.9 m out
  const sideCam = anchor(0.9 * Math.sin((70 * Math.PI) / 180), 1.30, 0.9 * Math.cos((70 * Math.PI) / 180));

  const parts: ClawParts = {
    gantry, clawHead, cable, prongs, prizes, prizeMats, dollHead, chuteLamp, joystick, buttons: { drop }, marquee, leds, timer,
  };
  kit.finalize(root, {
    keep: [
      gantry, cable, clawHead, ...prongs, ...prizes, dollHead, chuteLamp.root, joystick, drop.root, marquee.root,
      leds.credit.root, leds.bet.root, leds.win.root, timer.root, glass, light, light2,
    ],
  });

  return {
    root,
    parts,
    // seat standard: the glass play box, prize pit, chute, control panel and the marquee top in frame
    playPose: { pos: new THREE.Vector3(0, 1.75, 2.0), look: new THREE.Vector3(0, 1.30, 0), fov: 62, mouse: 'pick' },
    colliders: [{ min: [-0.45, 0, -0.45], max: [0.45, 1.95, 0.45] }],
    interact: { min: [-0.45, 0.1, -0.45], max: [0.45, 1.95, 0.6] },
    anchors: {
      speaker, prompt, label, marqueeTop, servicePlate, stand, coinOut, sideCam, light, light2,
    },
  };
}

