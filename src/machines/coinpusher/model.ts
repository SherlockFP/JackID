/**
 * Coin Pusher "The Shelf" — procedural model (MACHINES_machines §10, plan.json machines[id=coinpusher].modelBrief).
 *
 * Glass-fronted L-slot cabinet, 1.40 W × 1.20 D × 1.95 H m, two player stations side by side. Origin = floor centre of
 * the footprint, +Z = front. The playfield shelf is 1.00 W × 0.50 D with its top at SHELF_Y; the pusher block travels in z
 * over it. Coins are one InstancedMesh: slots 0..255 are the shelf pile (positions from the shelf count), slots 256..259
 * are the flying coins (the 4 drops in flight). Coin visuals are cosmetic: the outcome lives in `rules.ts`.
 *
 * BUDGET: static shell merged by kit.finalize; animated parts listed in `keep`. Draw calls exceed the 20-draw target
 * (six prize capsules, three reels, two gutter belts and the walls are separate by design, see the report).
 */
import * as THREE from 'three';
import type { Kit, LampPart, MarqueePart, ReelPart, ScreenSurface } from '@/kit/types';
import type { MachineModel, SeatDef } from '@/machines/_base/types';
import type { ModelOpts } from '@/machines/_base/MachineBase';
import { crispTexture } from '@/core/ui/textOverlay';
import { createRng } from '@/core/rng';
import { SHELF_CAP } from './rules';

export const CAB = { w: 1.40, d: 1.20, h: 1.95 };
export const SHELF_Y = 1.00;                          // shelf top, m
export const SHELF = { w: 1.00, d: 0.50 };
export const STATION_X: readonly [number, number] = [-0.35, 0.35];   // station centres (chute home)
export const CHUTE_TRAVEL = 0.15;                     // chute x = STATION_X + aim × 0.15 (stays on the shelf)
export const CHUTE_Y = 1.42;
export const TRAY_X: readonly [number, number] = [-0.25, 0.25];      // front drop trays under the split edge
export const TRAY_Y = 0.34, TRAY_Z = 0.34;
export const PILE_COLS = 16, PILE_ROWS = 16, PILE_SLOTS = 256;
export const FLY_FIRST = 256, FLY_COUNT = 4;
export const PRIZE_COUNT = 6;
export const REEL_SYMBOLS: readonly string[] = ['blank', 'cherry', 'coin', 'bell', 'bar', 'seven', 'star', 'jackpot'];
export const REEL_X = [-0.10, 0, 0.10] as const;
export const REEL_Y = 1.62, REEL_Z = -0.555;
export const GATE_Y = 1.36, GATE_Z = -0.565;
const COIN_R = 0.013, COIN_H = 0.002;

/** Contract between modeler and coder. Animated parts are addressed by name. */
export type CoinpusherParts = {
  /** Pusher block (Group, origin at its back edge); index.ts drives z. */
  pusher: THREE.Object3D;
  /** Coin pool: 0..255 shelf pile, 256..259 flying coins. */
  coins: THREE.InstancedMesh;
  /** 12 porcelain teeth among the coins (instanced, static). */
  teeth: THREE.InstancedMesh;
  /** Six two-tone charm capsules on the shelf (hidden when won). */
  prizes: THREE.Object3D[];
  /** Golden plate (worth 50 D); hidden until the jackpot drops it. */
  goldenPlate: THREE.Object3D;
  /** Coin chutes, one per station (slide across their half). */
  chutes: [THREE.Object3D, THREE.Object3D];
  /** Lucky-gate wheel on the back wall (turns 0.25 rev/s). */
  gate: THREE.Object3D;
  /** Three-reel bonus marquee. */
  bonusReels: [ReelPart, ReelPart, ReelPart];
  /** Side walls (Group, origin at the shelf floor; scale.y 0 → 1 when they rise). */
  walls: [THREE.Object3D, THREE.Object3D];
  /** Front drop trays (glow when a coin lands). */
  trays: [THREE.Object3D, THREE.Object3D];
  /** Side gutter conveyors (dark belts beside the shelf). */
  gutterConveyors: [THREE.Object3D, THREE.Object3D];
  /** Station lamps, one per seat. */
  stationLamps: [LampPart, LampPart];
  /** Tilt alarm lamp. */
  tiltLamp: LampPart;
  /** Per-station credit / bet / win display. */
  leds: { L: ScreenSurface; R: ScreenSurface };
  marquee: MarqueePart;
};

export const PRIZE_POS: ReadonlyArray<[number, number]> = [[-0.36, -0.12], [0.36, -0.12], [-0.20, 0.02], [0.20, 0.02], [-0.36, 0.14], [0.36, 0.14]];
export const TEETH_SEED = 0x5eed;

/** Seat pose, shared by both stations: the camera backs off to 1.15 m and looks down at the shelf, so the bonus reels and
 *  the upper coin chutes (1.42 to 1.72) stay under the top band and the shelf stays above the bottom bar. */
export const SEAT_POSE = { pos: new THREE.Vector3(0, 1.62, 1.15), look: new THREE.Vector3(0, 1.19, -0.20), fov: 58 } as const;

/** Seats (TECH §3.4): standing, offset to each station; both stations share the framing. */
export function seatDefs(): SeatDef[] {
  return STATION_X.map((x) => ({
    pose: { pos: new THREE.Vector3(x * 0.5, SEAT_POSE.pos.y, SEAT_POSE.pos.z), look: new THREE.Vector3(x * 0.3, SEAT_POSE.look.y, SEAT_POSE.look.z), fov: SEAT_POSE.fov, mouse: 'primary' as const },
    stand: new THREE.Vector3(x, 0, 0.92),
    avatar: 'stand' as const,
  }));
}

/** Pile slot → shelf position (cosmetic grid; index 0 is the back-left corner). */
export function pileXZ(i: number): [number, number] {
  const col = i % PILE_COLS, row = Math.floor(i / PILE_COLS);
  return [-0.46 + col * (0.92 / (PILE_COLS - 1)), -0.22 + row * (0.44 / (PILE_ROWS - 1))];
}

/** Two-element tuple from an array (stations). */
function pair<T>(a: readonly T[]): [T, T] { return [a[0], a[1]]; }
function triple<T>(a: readonly T[]): [T, T, T] { return [a[0], a[1], a[2]]; }

export function buildModel(kit: Kit, o: ModelOpts): MachineModel<CoinpusherParts> {
  const { pal } = kit;
  const root = kit.group('coinpusher');
  const at = (x: number, y: number, z: number): { pos: [number, number, number]; parent: THREE.Object3D } => ({ pos: [x, y, z], parent: root });
  const lacquer = 0x9e1b32, chrome = 0xc0c4ca, mirror = 0x8c949c, brass = 0xc9a227, gold = 0xffd040;
  const dark = 0x14141a, glass = 0xbfe6ff;
  const { w, d, h } = CAB;

  // ── static shell (flat colours, merged by kit.finalize) ──────────────────────────────────────────
  kit.box(w, 0.12, d, lacquer, at(0, 0.06, 0));                              // plinth
  kit.box(0.05, h - 0.12, d, lacquer, at(-w / 2 + 0.025, 0.12 + (h - 0.12) / 2, 0));
  kit.box(0.05, h - 0.12, d, lacquer, at(w / 2 - 0.025, 0.12 + (h - 0.12) / 2, 0));
  kit.box(w, 0.10, d, lacquer, at(0, h - 0.05, 0));                          // top
  kit.box(w - 0.1, h - 0.12, 0.04, dark, at(0, 0.12 + (h - 0.12) / 2, -d / 2 + 0.02)); // mirror-dark back wall
  kit.box(w, 0.025, 0.03, chrome, at(0, h - 0.11, d / 2 - 0.015));           // chrome trims
  kit.box(w, 0.025, 0.03, chrome, at(0, 0.14, d / 2 - 0.015));
  kit.box(0.025, h - 0.3, 0.03, chrome, at(-w / 2 + 0.03, h / 2, d / 2 - 0.015));
  kit.box(0.025, h - 0.3, 0.03, chrome, at(w / 2 - 0.03, h / 2, d / 2 - 0.015));
  kit.box(SHELF.w, 0.02, SHELF.d, mirror, at(0, SHELF_Y - 0.01, 0));         // mirror-steel shelf
  kit.box(SHELF.w + 0.04, 0.03, 0.03, chrome, at(0, SHELF_Y - 0.035, SHELF.d / 2 + 0.015)); // drop lip
  kit.box(0.025, 0.09, SHELF.d, dark, at(-0.5125, SHELF_Y - 0.035, 0));    // gutter wall left
  kit.box(0.025, 0.09, SHELF.d, dark, at(0.5125, SHELF_Y - 0.035, 0));     // gutter wall right
  kit.box(0.5, 0.04, 0.16, brass, at(TRAY_X[0], TRAY_Y, TRAY_Z));          // trays
  kit.box(0.5, 0.04, 0.16, brass, at(TRAY_X[1], TRAY_Y, TRAY_Z));
  kit.box(0.12, 0.05, 0.10, chrome, at(0, 1.92, 0.58));                     // marquee cap
  kit.box(w - 0.1, 0.40, 0.03, lacquer, at(0, 0.60, d / 2 - 0.015));       // front kick panel
  kit.box(0.05, 0.50, 0.04, chrome, at(0, 0.58, 0.61));                     // front divider

  // ── gutter conveyors (dark belts) ────────────────────────────────────────────────────────────────
  const gutterL = kit.box(0.02, 0.012, SHELF.d * 0.95, 0x222228, at(-0.5125, SHELF_Y - 0.001, 0));
  const gutterR = kit.box(0.02, 0.012, SHELF.d * 0.95, 0x222228, at(0.5125, SHELF_Y - 0.001, 0));

  // ── pusher (Group, drives z over the shelf) ──────────────────────────────────────────────────────
  const pusher = new THREE.Group();
  pusher.name = 'pusher';
  pusher.position.set(0, SHELF_Y + 0.02, -0.15);
  root.add(pusher);
  kit.box(SHELF.w, 0.04, 0.20, chrome, { parent: pusher, pos: [0, 0.02, 0] });

  // ── coins: one instanced pool, brass and gold colours via instanceColor ─────────────────────────
  const coinGeo = new THREE.CylinderGeometry(COIN_R, COIN_R, COIN_H, 6);
  const coins = new THREE.InstancedMesh(coinGeo, kit.mat({ color: 0xffffff }), SHELF_CAP);
  const m4 = new THREE.Matrix4();
  const brassCol = new THREE.Color(brass);
  const hide = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < SHELF_CAP; i++) {
    coins.setMatrixAt(i, hide);        // every slot starts hidden; index.ts lays the pile out from the shelf count
    coins.setColorAt(i, brassCol);
  }
  coins.instanceMatrix.needsUpdate = true;
  if (coins.instanceColor) coins.instanceColor.needsUpdate = true;
  root.add(coins);

  // ── teeth: 12 porcelain teeth among the coins (static, instanced) ───────────────────────────────
  const toothRng = createRng(TEETH_SEED ^ (o.seed | 0));
  const teethGeo = new THREE.IcosahedronGeometry(0.012, 0);
  const teeth = new THREE.InstancedMesh(teethGeo, kit.mat({ color: pal.bone, lit: true }), 12);
  for (let i = 0; i < 12; i++) {
    const x = toothRng.float(-0.42, 0.42), z = toothRng.float(-0.18, 0.12);
    m4.makeTranslation(x, SHELF_Y + 0.008, z);
    teeth.setMatrixAt(i, m4);
  }
  teeth.instanceMatrix.needsUpdate = true;
  root.add(teeth);

  // ── prizes: six two-tone capsules (red top, cream bottom) ───────────────────────────────────────
  const prizes: THREE.Object3D[] = PRIZE_POS.map(([x, z], i) => {
    const g = new THREE.Group();
    g.name = `prize${i}`;
    g.position.set(x, SHELF_Y + 0.004, z);
    const top = kit.sphere(0.018, i % 2 === 0 ? lacquer : 0x2b6cb0, { hemi: true, wSeg: 8, hSeg: 4, parent: g });
    const bot = kit.sphere(0.018, 0xf2ead8, { hemi: true, wSeg: 8, hSeg: 4, parent: g, rot: [180, 0, 0] });
    void top; void bot;
    root.add(g);
    return g;
  });

  // ── golden plate (hidden until the jackpot) ─────────────────────────────────────────────────────
  const goldenPlate = kit.cyl(0.03, 0.03, 0.004, gold, at(0, SHELF_Y + 0.003, 0.02));
  goldenPlate.visible = false;

  // ── station chutes: slide across their half ─────────────────────────────────────────────────────
  const chutes = pair(STATION_X.map((x, s) => {
    const c = new THREE.Group();
    c.name = `chute${s}`;
    c.position.set(x, CHUTE_Y, 0.10);
    kit.box(0.09, 0.035, 0.12, brass, { parent: c, pos: [0, 0, 0] });
    kit.box(0.04, 0.06, 0.04, chrome, { parent: c, pos: [0, -0.045, -0.04] });
    root.add(c);
    return c;
  }));

  // ── lucky gate: wheel on the back wall ──────────────────────────────────────────────────────────
  const gate = new THREE.Group();
  gate.name = 'gate';
  gate.position.set(0, GATE_Y, GATE_Z);
  const disc = kit.cyl(0.075, 0.075, 0.012, brass, { rot: [90, 0, 0], parent: gate });
  void disc;
  for (let s = 0; s < 4; s++) kit.box(0.14, 0.012, 0.014, chrome, { parent: gate, rot: [0, 0, s * 45] });
  kit.box(0.02, 0.04, 0.02, gold, { parent: gate, pos: [0, 0.07, 0.01] });   // the 0.05 m lucky slot marker
  root.add(gate);

  // ── bonus reels in a small marquee ──────────────────────────────────────────────────────────────
  const bonusReels = triple(REEL_X.map((x) => {
    const r = kit.reel({ radius: 0.04, width: 0.03, symbols: [...REEL_SYMBOLS], cell: 32 });
    r.root.position.set(x, REEL_Y, REEL_Z);
    root.add(r.root);
    return r;
  }));

  // ── side walls: rise from the shelf (origin at floor level) ─────────────────────────────────────
  const walls = pair([-0.51, 0.51].map((x, s) => {
    const g = new THREE.Group();
    g.name = `wall${s}`;
    g.position.set(x, SHELF_Y, 0);
    g.scale.y = 0.0001;
    kit.box(0.02, 0.24, SHELF.d, glass, { parent: g, pos: [0, 0.12, 0], shade: false });
    root.add(g);
    return g;
  }));

  // ── lamps, marquee, screens, glass ──────────────────────────────────────────────────────────────
  const stationLamps = pair(STATION_X.map((x) => {
    const l = kit.lamp({ r: 0.014, color: 0x40c8ff, shape: 'bulb' });
    l.root.position.set(x, 0.86, 0.615);
    root.add(l.root);
    return l;
  }));
  const tiltLamp = kit.lamp({ r: 0.014, color: 0xff3030, shape: 'bulb' });
  tiltLamp.root.position.set(0, 0.86, 0.615);
  root.add(tiltLamp.root);

  const ledL = kit.screen({ w: 0.30, h: 0.09, px: [240, 72], bezel: 0x000000 });
  ledL.mesh.position.set(STATION_X[0], 0.74, 0.612);
  root.add(ledL.mesh);
  const ledR = kit.screen({ w: 0.30, h: 0.09, px: [240, 72], bezel: 0x000000 });
  ledR.mesh.position.set(STATION_X[1], 0.74, 0.612);
  root.add(ledR.mesh);

  const marquee = kit.marquee({ w: 0.9, h: 0.13, text: { key: 'm.coinpusher.marquee' }, color: gold, bg: 0x000000, bulbs: 16 });
  marquee.root.position.set(0, 1.84, 0.605);
  root.add(marquee.root);

  const front = kit.glass({ w: w - 0.1, h: 1.02, d: 0.02, tint: 0xbfe6ff, opacity: 0.18 });
  front.position.set(0, 1.20, 0.60);
  root.add(front);

  const trays = pair(TRAY_X.map((x) => {
    const t = kit.box(0.42, 0.01, 0.14, 0xffe27a, at(x, TRAY_Y + 0.025, TRAY_Z));
    return t;
  }));

  const light = new THREE.Object3D();
  light.position.set(0, 1.55, 0.2);
  light.userData = { color: 0xffd080, intensity: 0.6, range: 2.4, flicker: 'STEADY' };
  root.add(light);

  const anchor = (x: number, y: number, z: number): THREE.Object3D => {
    const a = new THREE.Object3D(); a.position.set(x, y, z); root.add(a); return a;
  };
  const speaker = anchor(0, 1.00, 0.52);
  const prompt = marquee.root;
  const label = anchor(0, 0.46, 0.62);
  const marqueeTop = anchor(0, h, 0);
  const servicePlate = anchor(-w / 2 - 0.005, 1.2, 0);
  const coinOutL = anchor(TRAY_X[0], 0.36, 0.44);
  const coinOutR = anchor(TRAY_X[1], 0.36, 0.44);

  const parts: CoinpusherParts = {
    pusher, coins, teeth, prizes, goldenPlate, chutes, gate, bonusReels, walls, trays,
    gutterConveyors: [gutterL, gutterR], stationLamps, tiltLamp, leds: { L: ledL, R: ledR }, marquee,
  };
  crispTexture(ledL.tex, 4);                                   // on-machine text: linear + mips, not nearest
  crispTexture(ledR.tex, 4);
  kit.finalize(root, {
    keep: [pusher, coins, teeth, ...prizes, goldenPlate, ...chutes, gate, ...bonusReels.map((r) => r.root), ...walls,
      gutterL, gutterR, ...trays, ...stationLamps.map((l) => l.root), tiltLamp.root, ledL.mesh, ledR.mesh, marquee.root, front, light],
  });

  return {
    root,
    parts,
    playPose: { pos: SEAT_POSE.pos.clone(), look: SEAT_POSE.look.clone(), fov: SEAT_POSE.fov, mouse: 'primary' },
    seats: seatDefs(),
    colliders: [{ min: [-w / 2, 0, -d / 2], max: [w / 2, h, d / 2 - 0.1] }],
    interact: { min: [-w / 2, 0.2, -d / 2], max: [w / 2, h, d / 2 + 0.3] },
    anchors: { speaker, prompt, label, marqueeTop, servicePlate, coinOutL, coinOutR, light },
    dispose: () => { ledL.dispose(); ledR.dispose(); },
  };
}
