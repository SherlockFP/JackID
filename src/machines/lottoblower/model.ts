/**
 * Lotto Ball Blower — procedural model (MACHINES_tables §19, plan modelBrief `mdl-lottoblower`). `buildModel` returns a
 * full `MachineModel` and nothing else touches the scene; `LottoParts` is the contract with `index.ts`.
 * Metres, origin = floor centre of the footprint, +Z = player side.
 *
 * Footprint 1.20 W × 0.95 D × 2.20 H. Brass and walnut base (0.90 × 0.95 × 0.90) under a clear acrylic sphere (r 0.32,
 * centre y 1.30) holding 30 white balls. A small sphere (r 0.14) on the right holds 8 red Moon balls. A goose-neck tube
 * rises from the big sphere, curves down to a six-slot rack in front (5 main + 1 Moon). A 10-digit jackpot counter sits
 * on top of brass posts. A ticket kiosk (CRT + DRAW lever) stands at the right. Budget ≤ 1,500 tris, ≤ 14 draws.
 */
import * as THREE from 'three';
import type { KitX } from '@/kit';
import type { LampPart, LeverPart, LedPanelPart, ScreenSurface, BallPool } from '@/kit/types';
import type { MachineModel } from '@/machines/_base/types';
import type { ModelOpts } from '@/machines/_base/MachineBase';
import type { SeatDef } from '@/core/types';
import { createRng, hashSeed } from '@/core/rng';

export type LottoParts = {
  /** Clear acrylic sphere; the jackpot floods it gold. */
  sphere: THREE.Mesh;
  /** 30 white balls (instance `n-1` = number n). */
  balls: BallPool;
  moonSphere: THREE.Mesh;
  /** 8 red Moon balls (instance `m-1` = Moon m). */
  moonBalls: BallPool;
  /** Extraction tube centre-line, machine-local, bottom to top (for the drawn-ball animation). */
  tubePath: THREE.Vector3[];
  /** Six slot anchors in front of the base: rack[0..4] = main balls in draw order, rack[5] = Moon. */
  rack: THREE.Object3D[];
  /** Valve at the base of the sphere (opens for each draw). */
  valve: THREE.Group;
  /** 10-digit jackpot counter. */
  leds: { jackpot: LedPanelPart; credit: LampPart; bet: LampPart; win: LampPart };
  /** Ticket kiosk CRT (160 × 120). */
  kioskScreen: ScreenSurface;
  lever: LeverPart;
  /** Winners board (128 × 32 flip text). */
  winners: ScreenSurface;
  /** Black "0" ball, hidden; kept for curse presentation. */
  curseBall: THREE.Mesh;
};

// ── layout constants (metres, machine-local) ────────────────────────────────────────────────────
export const BASE_X = -0.15, BASE_W = 0.9, BASE_D = 0.9, BASE_H = 0.95;
export const SPHERE_C = new THREE.Vector3(BASE_X, 1.3, 0);
export const SPHERE_R = 0.32;
export const MOON_C = new THREE.Vector3(0.12, BASE_H + 0.14, -0.2);
export const MOON_R = 0.14;
export const KIOSK_X = 0.44, KIOSK_TOP = 1.0;
export const KIOSK_CRT = new THREE.Vector3(KIOSK_X, 1.154, 0.12);   // bottom sits on the pedestal top (CRT scaled 0.7 below)
export const LEVER_POS = new THREE.Vector3(0.555, 0.62, 0.05);
export const WINNERS_POS = new THREE.Vector3(BASE_X, 0.8, 0.46);
export const JACKPOT_POS = new THREE.Vector3(BASE_X, 1.92, -0.25);
/** Standing spots in front of the kiosk (x per seat). */
export const SEAT_X = [0.0, 0.2, 0.4, 0.6];
const SEAT_Z = 0.7, POSE_Z = 0.5;
/** Rack slot x positions (front of the base, y = rack top). */
const RACK_Y = BASE_H + 0.06, RACK_Z = 0.3;
export const rackXY = (i: number): [number, number] => [BASE_X - 0.25 + i * 0.1, RACK_Y];
const BALL_R = 0.022;
const BALL_COL = 0xf4f1e6;
const MOON_COL = 0xc0272d;

export function buildModel(kit: KitX, o: ModelOpts): MachineModel<LottoParts> {
  const { pal } = kit;
  const root = kit.group('lottoblower');
  const walnut = o.variant % 2 ? pal.wood : pal.woodDark;
  const at = (x: number, y: number, z: number): { pos: [number, number, number]; parent: THREE.Object3D } => ({ pos: [x, y, z], parent: root });

  // ── static shell (flat colours, merged) ──
  kit.box(BASE_W, BASE_H, BASE_D, walnut, at(BASE_X, BASE_H / 2, 0));           // base
  kit.box(BASE_W + 0.02, 0.02, BASE_D + 0.02, pal.brass, at(BASE_X, BASE_H, 0)); // brass top trim
  kit.box(BASE_W + 0.02, 0.03, 0.03, pal.brass, at(BASE_X, 0.015, 0.46));        // plinth lip
  for (const sx of [-0.3, 0.3]) kit.box(0.03, 0.9, 0.03, pal.brass, at(BASE_X + sx, 1.45, -0.3)); // frame posts
  kit.box(0.8, 0.04, 0.1, pal.brass, at(BASE_X, 1.9, -0.3));                     // counter bridge
  kit.cyl(0.07, 0.09, 0.05, pal.brass, { pos: [BASE_X, BASE_H + 0.025, 0], parent: root, seg: 8 }); // sphere cradle
  // ticket kiosk pedestal
  kit.box(0.26, KIOSK_TOP, 0.3, walnut, at(KIOSK_X, KIOSK_TOP / 2, 0));
  kit.box(0.28, 0.02, 0.32, pal.brass, at(KIOSK_X, KIOSK_TOP, 0));

  // ── acrylic sphere (balls live inside it) ──
  const glassMat = new THREE.MeshBasicMaterial({ color: pal.glass, transparent: true, opacity: 0.18, depthWrite: false });
  const sphere = kit.sphere(SPHERE_R, glassMat, { pos: [SPHERE_C.x, SPHERE_C.y, SPHERE_C.z], parent: root, wSeg: 10, hSeg: 6 });
  sphere.name = 'lottoblower.sphere';

  // ── white balls: random rest positions inside the sphere (seeded, deterministic per instance) ──
  const bRng = createRng(hashSeed(o.seed, 'lottoblower', 'balls'));
  const balls = kit.balls({ max: 30, r: BALL_R, color: BALL_COL });
  balls.root.position.set(0, 0, 0);
  root.add(balls.root);
  for (let i = 0; i < 30; i++) {
    const p = restPoint(bRng, SPHERE_C, SPHERE_R - BALL_R - 0.03);
    balls.set(i, p.x, p.y, p.z);
  }

  // ── Moon sphere (small, right side) and its 8 red balls ──
  const moonGlass = new THREE.MeshBasicMaterial({ color: pal.glass, transparent: true, opacity: 0.2, depthWrite: false });
  const moonSphere = kit.sphere(MOON_R, moonGlass, { pos: [MOON_C.x, MOON_C.y, MOON_C.z], parent: root, wSeg: 8, hSeg: 4 });
  moonSphere.name = 'lottoblower.moonSphere';
  const moonBalls = kit.balls({ max: 8, r: BALL_R, color: MOON_COL });
  moonBalls.root.position.set(0, 0, 0);
  root.add(moonBalls.root);
  for (let i = 0; i < 8; i++) {
    const p = restPoint(bRng, MOON_C, MOON_R - BALL_R - 0.02);
    moonBalls.set(i, p.x, p.y, p.z);
  }

  // ── valve (opens for each draw: thunk) ──
  const valve = new THREE.Group();
  valve.name = 'lottoblower.valve';
  valve.position.set(BASE_X, SPHERE_C.y - SPHERE_R + 0.02, 0);
  root.add(valve);
  kit.cyl(0.035, 0.045, 0.05, pal.chrome, { pos: [0, 0, 0], parent: valve, seg: 8 });
  kit.torus(0.04, 0.01, pal.brass, { pos: [0, 0.03, 0], rot: [90, 0, 0], parent: valve, seg: 8, tubeSeg: 4 });

  // ── goose-neck tube: out of the sphere top, over, down to the rack ──
  const tubePath = [
    new THREE.Vector3(BASE_X, SPHERE_C.y + SPHERE_R - 0.02, 0),
    new THREE.Vector3(BASE_X, 1.86, 0.02),
    new THREE.Vector3(BASE_X + 0.1, 1.88, 0.2),
    new THREE.Vector3(BASE_X + 0.15, 1.6, 0.34),
    new THREE.Vector3(BASE_X + 0.15, 1.36, RACK_Z + 0.04),
    new THREE.Vector3(BASE_X + 0.15, RACK_Y + 0.14, RACK_Z + 0.04),
  ];
  kit.tube(tubePath.map((v): [number, number, number] => [v.x, v.y, v.z]), 0.018, glassMat, { seg: 12, radialSeg: 5, parent: root });

  // ── six-slot rack in front (5 main + 1 Moon) ──
  const rack: THREE.Object3D[] = [];
  kit.box(0.7, 0.02, 0.12, pal.brass, at(BASE_X - 0.1, RACK_Y - 0.02, RACK_Z));  // rack shelf
  for (let i = 0; i < 6; i++) {
    const [x, y] = rackXY(i);
    const slot = new THREE.Object3D();
    slot.position.set(x, y, RACK_Z);
    root.add(slot);
    rack.push(slot);
    kit.cyl(0.03, 0.03, 0.012, i === 5 ? pal.redDark : pal.cream, { pos: [x, y + 0.006, RACK_Z], parent: root, seg: 8 });
  }

  // ── jackpot counter (10 digits) on top ──
  const jackpot = kit.ledPanel({ digits: 10, color: '#ffb000', h: 0.09 });
  jackpot.root.position.set(JACKPOT_POS.x, JACKPOT_POS.y, JACKPOT_POS.z);
  root.add(jackpot.root);

  // ── small status lamps on the base front ──
  const credit = kit.lamp({ r: 0.018, color: pal.neonCyan, shape: 'dome' });
  credit.root.position.set(BASE_X - 0.28, 0.82, 0.46);
  const bet = kit.lamp({ r: 0.018, color: pal.neonYellow, shape: 'dome' });
  bet.root.position.set(BASE_X - 0.2, 0.82, 0.46);
  const win = kit.lamp({ r: 0.018, color: pal.red, shape: 'dome' });
  win.root.position.set(BASE_X - 0.12, 0.82, 0.46);
  root.add(credit.root, bet.root, win.root);

  // ── winners board (flip text) on the base front ──
  const winners = kit.screen({ w: 0.42, h: 0.1, px: [128, 32], bezel: pal.black, glow: 0.3 });
  winners.mesh.position.set(WINNERS_POS.x, WINNERS_POS.y, WINNERS_POS.z);
  root.add(winners.mesh);

  // ── ticket kiosk: CRT + DRAW lever ──
  const crt = kit.crtMonitor({ w: 0.3, h: 0.23, px: [160, 120], scheme: 'amber', glow: 0.8 });
  crt.root.position.set(KIOSK_CRT.x, KIOSK_CRT.y, KIOSK_CRT.z);
  crt.root.scale.setScalar(0.7);   // housing + side brackets were 0.52 m wide: x 0.26..0.62 keeps the footprint
  root.add(crt.root);
  const lever = kit.lever({ length: 0.4, knob: pal.red, side: 'right' });
  lever.root.position.set(LEVER_POS.x, LEVER_POS.y, LEVER_POS.z);
  root.add(lever.root);

  // ── curse ball (hidden, P47 black "0") ──
  const curseBall = kit.sphere(BALL_R * 1.2, pal.black, { pos: [SPHERE_C.x + 0.1, SPHERE_C.y, 0.1], parent: root, wSeg: 6, hSeg: 4 });
  curseBall.visible = false;
  curseBall.name = 'lottoblower.curseBall';

  // ── anchors ──
  const speaker = new THREE.Object3D(); speaker.position.set(0, 1.5, -0.42); root.add(speaker);
  const prompt = new THREE.Object3D(); prompt.position.set(KIOSK_X, 1.45, 0.3); root.add(prompt);
  const label = new THREE.Object3D(); label.position.set(BASE_X, 2.05, -0.3); root.add(label);
  const marqueeTop = new THREE.Object3D(); marqueeTop.position.set(BASE_X, 2.12, 0.0); root.add(marqueeTop);
  const servicePlate = new THREE.Object3D(); servicePlate.position.set(0.6, 0.5, -0.3); root.add(servicePlate);
  const sphereCam = new THREE.Object3D(); sphereCam.position.set(BASE_X, SPHERE_C.y, 0.55); root.add(sphereCam);
  const light = new THREE.Object3D();
  light.position.set(BASE_X, 0.3, 0.35);
  light.userData = { color: pal.neonYellow, intensity: 0.6, range: 1.5 };
  root.add(light);

  const leds = { jackpot, credit, bet, win };
  const parts: LottoParts = {
    sphere, balls, moonSphere, moonBalls, tubePath: tubePath.map((v) => v.clone()), rack, valve,
    leds, kioskScreen: crt.screen, lever, winners, curseBall,
  };
  const keep: Array<THREE.Object3D | { root: THREE.Object3D }> = [
    sphere, moonSphere, balls.root, moonBalls.root, valve, ...rack, jackpot, credit, bet, win, winners.mesh,
    crt.root, lever.root, curseBall, speaker, prompt, label, marqueeTop, servicePlate, sphereCam, light,
  ];
  kit.finalize(root, { keep });

  const seats: SeatDef[] = SEAT_X.map((x) => ({
    // seat standard: tank, winners board, kiosk and jackpot board in frame, the base well clear of the lens (was 5 cm)
    pose: { pos: new THREE.Vector3(0, 1.6, 1.9), look: new THREE.Vector3(0, 1.2, 0), fov: 62, mouse: 'primary' },
    stand: new THREE.Vector3(x, 0, SEAT_Z),
    avatar: 'stand',
  }));

  return {
    root,
    parts,
    playPose: seats[0].pose,
    seats,
    colliders: [
      { min: [BASE_X - BASE_W / 2, 0, -BASE_D / 2], max: [BASE_X + BASE_W / 2, BASE_H, BASE_D / 2] },
      { min: [KIOSK_X - 0.14, 0, -0.16], max: [KIOSK_X + 0.14, KIOSK_TOP + 0.02, 0.16] },
    ],
    interact: { min: [-0.62, 0, -0.5], max: [0.62, 2.1, 0.6] },
    anchors: { speaker, prompt, label, marqueeTop, servicePlate, sphereCam, light },
    dispose: () => { winners.dispose(); crt.screen.dispose(); },
  };
}

/** Random point inside a sphere of radius `r` around `c` (rejection sampling on the seeded stream). */
function restPoint(rng: { next(): number }, c: THREE.Vector3, r: number): THREE.Vector3 {
  for (;;) {
    const x = rng.next() * 2 - 1, y = rng.next() * 2 - 1, z = rng.next() * 2 - 1;
    if (x * x + y * y + z * z <= 1) return new THREE.Vector3(c.x + x * r, c.y + y * r, c.z + z * r);
  }
}
