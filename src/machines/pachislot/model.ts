/**
 * Oni Feast pachislot — procedural model (ART §5.3 / MACHINES §7, plan.json modelBrief). Pattern as in `coinflip/model.ts`:
 *  - `buildModel(kit, o)` returns a full `MachineModel` and nothing else touches the scene;
 *  - the exported `PachislotParts` type is the contract with the coder (`index.ts`);
 *  - metres, origin = floor centre of the footprint, +Z = front (the player side), y up.
 *
 * Footprint 0.60 W × 0.95 D × 1.80 H (slot M). Counter section 0.95 m (top at 0.95) with the cabinet 0.50 × 0.45 × 0.85 on
 * it (top at 1.80). Front face at z = 0; reels at z −0.09 behind a 0.24 × 0.15 window; LCD 0.22 × 0.165 above the window;
 * marquee above the LCD; stop buttons under the reels; start lever on the left; medal tray in front of the counter;
 * a carved oni mask bottom-left and a paper lantern right. Stool at z +0.40. Colourways 0–3 change the trim.
 *
 * Symbols on the reel strips are painted here (oni, koi, replay, lantern, fan) and reuse the texgen `bar` / `blank`.
 */
import * as THREE from 'three';
import type { KitX } from '@/kit';
import type { BulbChain, ButtonPart, LampPart, LedPanelPart, LeverPart, MarqueePart, ReelPart, ScreenSurface } from '@/kit/types';
import type { MachineModel } from '@/machines/_base/types';
import type { ModelOpts } from '@/machines/_base/MachineBase';
import type { V3 } from '@/core/types';
import { STRIPS, STOPS, type Sym } from './rules';

/** Contract between modeler and coder. */
export type PachislotParts = {
  /** Three 21-facet drums, axis X, payline at +Z. Index = reel. */
  reels: [ReelPart, ReelPart, ReelPart];
  /** 160 × 120 LCD above the reel window. */
  screens: { lcd: ScreenSurface };
  buttons: { stop: [ButtonPart, ButtonPart, ButtonPart]; betMax: ButtonPart };
  /** Start lever on the left of the stops (press = pull, rotates about X). */
  startLever: LeverPart;
  leds: { credit: LedPanelPart; payout: LedPanelPart };
  /** Scoop in front of the counter; origin = where medals fall (FX anchor). */
  trays: { medals: THREE.Object3D };
  lamps: {
    /** Two vertical strips of 12 LEDs on the front corners (instanced). */
    side: [BulbChain, BulbChain];
    /** Two red eyes of the carved oni mask, lit on a held bonus / after the third stop. */
    oniEyes: [LampPart, LampPart];
    /** Paper lantern lamp (the `light` anchor glow). */
    lantern: LampPart;
  };
  marquee: MarqueePart;
  /** Rotating red card on top: spins during BIG. Origin = pivot. */
  beacon: THREE.Object3D;
  stool: THREE.Object3D;
};

const BODY = 0x111111;
const TRIM_BY_VARIANT = [0xe0218a, 0x30d0ff, 0xf2c14e, 0xe02020] as const;   // magenta, cyan, gold, red
const ONI_RED = 0xc01020;
const LANTERN_PAPER = 0xffcc66;
const LANTERN_RED = 0xc01e1e;
const EYE_RED = 0xff1010;

export const SYMBOL_TEX: Record<Sym, string> = {
  ONI: 'pachi.oni', KOI: 'pachi.koi', REP: 'pachi.replay', LAN: 'pachi.lantern', FAN: 'pachi.fan', BAR: 'bar', BLK: 'blank',
};

/** Window and reel geometry (shared with `index.ts` for the press timing). */
export const REEL_X = [-0.08, 0, 0.08] as const;
export const REEL_Y = 1.36;
export const REEL_Z = -0.09;
export const REEL_R = 0.085;
export const REEL_W = 0.065;
export const WIN_W = 0.24, WIN_H = 0.15;
export const LCD_Y = 1.56;
export const STOP_Y = 1.19;

const painters: Record<string, (g: CanvasRenderingContext2D, s: number) => void> = {
  'pachi.oni': (g, s) => {
    g.fillStyle = '#C01020';
    g.beginPath(); g.ellipse(s / 2, s / 2 + s * 0.04, s * 0.30, s * 0.34, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.moveTo(s * 0.22, s * 0.22); g.lineTo(s * 0.12, s * 0.02); g.lineTo(s * 0.36, s * 0.16); g.fill();
    g.beginPath(); g.moveTo(s * 0.78, s * 0.22); g.lineTo(s * 0.88, s * 0.02); g.lineTo(s * 0.64, s * 0.16); g.fill();
    g.fillStyle = '#FFD040';
    g.fillRect(s * 0.32, s * 0.42, s * 0.12, s * 0.08); g.fillRect(s * 0.56, s * 0.42, s * 0.12, s * 0.08);
  },
  'pachi.koi': (g, s) => {
    g.fillStyle = '#FF7A1A';
    g.beginPath(); g.ellipse(s * 0.44, s / 2, s * 0.32, s * 0.2, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.moveTo(s * 0.7, s / 2); g.lineTo(s * 0.92, s * 0.28); g.lineTo(s * 0.92, s * 0.72); g.fill();
    g.fillStyle = '#FFF4E0';
    g.beginPath(); g.arc(s * 0.36, s * 0.44, s * 0.06, 0, Math.PI * 2); g.fill();
  },
  'pachi.replay': (g, s) => {
    g.strokeStyle = '#2060FF'; g.lineWidth = s * 0.12;
    g.beginPath(); g.arc(s / 2, s / 2, s * 0.30, Math.PI * 0.2, Math.PI * 1.7); g.stroke();
    g.fillStyle = '#2060FF';
    g.beginPath(); g.moveTo(s * 0.70, s * 0.14); g.lineTo(s * 0.92, s * 0.34); g.lineTo(s * 0.56, s * 0.38); g.fill();
  },
  'pachi.lantern': (g, s) => {
    g.fillStyle = '#FFCC66';
    g.fillRect(s * 0.30, s * 0.22, s * 0.40, s * 0.56);
    g.fillStyle = '#C01E1E';
    g.fillRect(s * 0.26, s * 0.16, s * 0.48, s * 0.08); g.fillRect(s * 0.26, s * 0.76, s * 0.48, s * 0.08);
  },
  'pachi.fan': (g, s) => {
    g.fillStyle = '#8040C0';
    g.beginPath(); g.moveTo(s * 0.5, s * 0.86); g.arc(s * 0.5, s * 0.86, s * 0.64, Math.PI * 1.2, Math.PI * 1.8); g.closePath(); g.fill();
    g.fillStyle = '#C8A0FF';
    g.fillRect(s * 0.46, s * 0.20, s * 0.08, s * 0.66);
  },
};

export function buildModel(kit: KitX, o: ModelOpts): MachineModel<PachislotParts> {
  const { pal } = kit;
  const trim = TRIM_BY_VARIANT[o.variant] ?? TRIM_BY_VARIANT[0];
  const root = kit.group('pachislot');

  for (const [id, paint] of Object.entries(painters)) kit.tex.registerSymbol(id, paint);

  // ── static shell (flat colours, merged by finalize) ──
  const at = (x: number, y: number, z: number): { pos: [number, number, number]; parent: THREE.Object3D } => ({ pos: [x, y, z], parent: root });
  kit.box(0.60, 0.95, 0.50, pal.black, at(0, 0.475, -0.225));                    // counter section (body in the kit black)
  kit.box(0.62, 0.03, 0.52, trim, at(0, 0.965, -0.225));                          // counter top trim
  kit.box(0.50, 0.85, 0.45, BODY, at(0, 1.375, -0.225));                          // cabinet
  kit.box(0.52, 0.02, 0.47, trim, at(0, 1.81, -0.225));                           // gaudy top edge
  kit.box(0.50, 0.012, 0.01, trim, at(0, 1.80, 0.0));                             // front top trim line
  for (const sx of [-1, 1]) kit.box(0.02, 0.85, 0.01, trim, at(sx * 0.25, 1.375, 0.0));   // front corner trims
  // reel window frame (gold / trim) around the 0.24 × 0.15 opening
  kit.box(WIN_W + 0.03, 0.012, 0.012, pal.gold, at(0, REEL_Y + WIN_H / 2 + 0.006, 0.006));
  kit.box(WIN_W + 0.03, 0.012, 0.012, pal.gold, at(0, REEL_Y - WIN_H / 2 - 0.006, 0.006));
  for (const sx of [-1, 1]) kit.box(0.012, WIN_H, 0.012, pal.gold, at(sx * (WIN_W / 2 + 0.006), REEL_Y, 0.006));
  kit.box(WIN_W, WIN_H, 0.004, pal.black, at(0, REEL_Y, 0.002));                  // dark backing behind the window
  // medal tray scoop (0.40 × 0.12) in front of the counter
  kit.box(0.40, 0.03, 0.12, pal.chrome, at(0, 0.975, 0.09));
  kit.box(0.40, 0.03, 0.01, trim, at(0, 0.99, 0.15));
  // stool (seat 0.65), low-poly, inside the footprint (radius 0.17 → front edge at z 0.40)
  const stool = new THREE.Group();
  stool.name = 'stool';
  kit.cyl(0.17, 0.17, 0.05, pal.leather, { pos: [0, 0.65, 0], seg: 8, parent: stool });
  kit.cyl(0.025, 0.025, 0.60, pal.chrome, { pos: [0, 0.32, 0], seg: 6, parent: stool });
  kit.cyl(0.18, 0.18, 0.02, pal.chrome, { pos: [0, 0.01, 0], seg: 8, parent: stool });
  stool.position.set(0, 0, 0.22);
  root.add(stool);

  // ── reels: 21 facets, strip 32 px per facet (32 × 672) ──
  const reels = REEL_X.map((x, r) => {
    const symbols = Array.from({ length: STOPS }, (_, i) => SYMBOL_TEX[STRIPS[r][i]]);
    const part = kit.reel({ radius: REEL_R, width: REEL_W, symbols, cell: 32 });
    part.root.position.set(x, REEL_Y, REEL_Z);
    root.add(part.root);
    return part;
  }) as [ReelPart, ReelPart, ReelPart];

  // ── LCD + marquee ──
  const lcd = kit.screen({ w: 0.22, h: 0.165, px: [160, 120], bezel: pal.black });
  lcd.mesh.position.set(0, LCD_Y, 0.004);
  root.add(lcd.mesh);
  const marquee = kit.marquee({ w: 0.46, h: 0.12, text: { key: 'm.pachislot.name' }, color: pal.neonYellow, bg: pal.black, bulbs: 8 });
  marquee.root.position.set(0, 1.725, 0.006);
  root.add(marquee.root);

  // ── stop buttons, max bet, lever, LEDs ──
  const stop = REEL_X.map((x) => {
    const b = kit.button({ shape: 'round', r: 0.035, color: pal.neonCyan });
    b.root.position.set(x, STOP_Y, 0.02);
    root.add(b.root);
    return b;
  }) as [ButtonPart, ButtonPart, ButtonPart];
  const betMax = kit.button({ shape: 'round', r: 0.03, color: pal.red });
  betMax.root.position.set(0.17, STOP_Y, 0.02);
  root.add(betMax.root);

  const startLever = kit.lever({ length: 0.2, knob: pal.red, side: 'left' });
  startLever.root.position.set(-0.17, STOP_Y, 0.03);
  root.add(startLever.root);

  const credit = kit.ledPanel({ digits: 2, color: '#ff2030', h: 0.035 });
  credit.root.position.set(-0.07, 1.10, 0.02);
  const payout = kit.ledPanel({ digits: 2, color: '#ff2030', h: 0.035 });
  payout.root.position.set(0.07, 1.10, 0.02);
  root.add(credit.root, payout.root);

  // ── side lamps: 2 vertical strips × 12 LEDs ──
  const strip = (x: number): BulbChain => {
    const path: V3[] = [[x, 1.00, 0.004], [x, 1.78, 0.004]];
    const chain = kit.bulbChain({ path, count: 12, colors: [pal.neonPink, pal.neonCyan], r: 0.008 });
    root.add(chain.root);
    return chain;
  };
  const side: [BulbChain, BulbChain] = [strip(-0.235), strip(0.235)];

  // ── carved oni mask (bottom-left) with red eyes ──
  const mask = kit.sphere(0.035, ONI_RED, { pos: [-0.19, 1.07, 0.02], wSeg: 8, hSeg: 6, parent: root });
  mask.scale.set(1, 1.1, 0.7);
  for (const sx of [-1, 1]) kit.box(0.012, 0.03, 0.012, ONI_RED, { pos: [-0.19 + sx * 0.03, 1.11, 0.02], parent: root, rot: [0, 0, sx * 25] });
  const oniEyes: [LampPart, LampPart] = [
    kit.lamp({ r: 0.008, color: EYE_RED, shape: 'flat' }),
    kit.lamp({ r: 0.008, color: EYE_RED, shape: 'flat' }),
  ];
  oniEyes.forEach((e, i) => { e.root.position.set(-0.19 + (i === 0 ? -0.013 : 0.013), 1.08, 0.052); root.add(e.root); });

  // ── paper lantern (lathe, 8 segments, r 0.05, h 0.09) and its lamp ──
  const lanternBody = kit.lathe([[0.02, 0], [0.05, 0.02], [0.05, 0.07], [0.02, 0.09]], 8, LANTERN_RED, { pos: [0.18, 1.46, 0.04], parent: root });
  void lanternBody;
  const lantern = kit.lamp({ r: 0.03, color: LANTERN_PAPER, shape: 'dome' });
  lantern.root.position.set(0.18, 1.52, 0.05);
  root.add(lantern.root);

  // ── beacon (BIG): a spinning red card on top ──
  const beacon = new THREE.Object3D();
  beacon.position.set(0, 1.84, -0.225);
  root.add(beacon);
  kit.box(0.12, 0.012, 0.02, 0xff2020, { parent: beacon });

  // ── anchors ──
  const speaker = new THREE.Object3D(); speaker.position.set(0, 1.40, 0.02); root.add(speaker);
  const label = new THREE.Object3D(); label.position.set(0, 1.15, 0.02); root.add(label);
  const servicePlate = new THREE.Object3D(); servicePlate.position.set(0.26, 0.60, 0.026); root.add(servicePlate);
  const stand = new THREE.Object3D(); stand.position.set(0, 0, 0.62); root.add(stand);
  const medals = new THREE.Object3D(); medals.position.set(0, 1.00, 0.10); root.add(medals);
  const light = new THREE.Object3D();
  light.position.set(0, 1.50, 0.20);
  light.userData = { color: 0xffcc66, intensity: 0.6, range: 1.0, flicker: 'STEADY' };
  root.add(light);
  const fxTwist = new THREE.Object3D(); fxTwist.position.set(0, LCD_Y, 0.02); root.add(fxTwist);

  const parts: PachislotParts = {
    reels, screens: { lcd }, buttons: { stop, betMax }, startLever,
    leds: { credit, payout }, trays: { medals }, lamps: { side, oniEyes, lantern }, marquee, beacon, stool,
  };
  kit.finalize(root, {
    keep: [
      ...reels.map((r) => r.root), lcd.mesh, marquee.root, startLever.root, ...stop.map((b) => b.root), betMax.root,
      credit.root, payout.root, ...side.map((c) => c.root), ...oniEyes.map((e) => e.root), lantern.root, beacon, light,
    ],
  });

  return {
    root,
    parts,
    playPose: { pos: new THREE.Vector3(0, 1.30, 0.55), look: new THREE.Vector3(0, 1.28, 0.05), fov: 50, mouse: 'primary' },
    colliders: [{ min: [-0.30, 0, -0.475], max: [0.30, 1.80, 0.025] }],
    interact: { min: [-0.30, 0.3, -0.475], max: [0.30, 1.80, 0.20] },
    anchors: {
      speaker, prompt: marquee.root, label, marqueeTop: beacon, servicePlate, stand, coinOut: medals, light, fxTwist,
    },
    dispose: () => lcd.dispose(),
  };
}
