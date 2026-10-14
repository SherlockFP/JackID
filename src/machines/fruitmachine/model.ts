/**
 * Nudge & Hold fruit machine — procedural model (MACHINES §17, plan.json modelBrief). Pattern as in `pachislot/model.ts`:
 *  - `buildModel(kit, o)` returns a full `MachineModel` and nothing else touches the scene;
 *  - the exported `FruitParts` type is the contract with the coder (`index.ts`);
 *  - metres, origin = floor centre of the footprint, +Z = front (the player side), y up.
 *
 * Footprint 0.70 W × 0.60 D × 1.80 H (slot M). Glossy enamel body with gold lettering (colourways 0–3). Top glass
 * 0.60 × 0.36 (trail, ladder and the nudge count, drawn on a canvas screen), three 20-facet reels 0.10 wide behind a gold
 * window, a row of buttons (HOLD 1–3, START, COLLECT, HI, LO), LED panels, a coin tray and side bulb chains.
 */
import * as THREE from 'three';
import type { KitX } from '@/kit';
import type { BulbChain, ButtonPart, LampPart, LedPanelPart, MarqueePart, ReelPart, ScreenSurface } from '@/kit/types';
import type { MachineModel } from '@/machines/_base/types';
import type { ModelOpts } from '@/machines/_base/MachineBase';
import { crispTexture } from '@/core/ui/textOverlay';
import { STRIPS, type Sym } from './rules';

/** Contract between modeler and coder. */
export type FruitParts = {
  /** Three 20-facet drums, axis X, payline at +Z. Index = reel. */
  reels: [ReelPart, ReelPart, ReelPart];
  buttons: {
    hold: [ButtonPart, ButtonPart, ButtonPart];
    start: ButtonPart;
    collect: ButtonPart;
    hi: ButtonPart;
    lo: ButtonPart;
  };
  /** 1-digit nudge count, 2-digit HI/LO number, credit / win / bet readouts. */
  leds: { nudges: LedPanelPart; hilo: LedPanelPart; credit: LedPanelPart; win: LedPanelPart; bet: LedPanelPart };
  lamps: { hold: LampPart; feature: LampPart };
  /** Top glass: trail squares, ladder rungs, the state line. */
  glass: ScreenSurface;
  marquee: MarqueePart;
  /** Two vertical strips of 12 bulbs on the front corners. */
  side: [BulbChain, BulbChain];
  /** Coin tray in front of the cabinet (origin = where coins fall). */
  tray: THREE.Object3D;
};

const GOLD_LETTER = 0xe8c060;
const CHROME = 0x9aa3ab;
const BLACK = 0x121212;
const BODY_BY_VARIANT = [0x0f6b3a, 0x6b1520, 0x1a3a8a, 0x161616] as const;   // green, oxblood, cobalt, black
const TRIM_BY_VARIANT = [0xe8c060, 0xe8c060, 0xe8c060, 0xd0a040] as const;
const YELLOW = 0xf2c81c, GREEN = 0x2fbf4a, RED = 0xd42a2a, LAMP_HOLD = 0xffd030, LAMP_FEATURE = 0xff6a20;

export const SYMBOL_TEX: Record<Sym, string> = {
  PEAR: 'fruit.PEAR', GRAPES: 'fruit.GRAPES', STRAW: 'fruit.STRAW', MELON: 'fruit.MELON', BAR: 'fruit.BAR',
  STAR: 'fruit.STAR', BAG: 'fruit.BAG', STEP: 'fruit.STEP',
};

/** Reel geometry (shared with `index.ts`). */
export const REEL_X = [-0.12, 0, 0.12] as const;
export const REEL_Y = 1.10;
export const REEL_Z = 0.30;
export const REEL_R = 0.08;
export const REEL_W = 0.10;
export const GLASS_Y = 1.52;
export const BUTTON_Y = 0.93;

const painters: Record<string, (g: CanvasRenderingContext2D, s: number) => void> = {
  'fruit.PEAR': (g, s) => {
    g.fillStyle = '#B8D040';
    g.beginPath(); g.ellipse(s * 0.5, s * 0.6, s * 0.26, s * 0.3, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#4a7a20'; g.fillRect(s * 0.48, s * 0.12, s * 0.05, s * 0.2);
  },
  'fruit.GRAPES': (g, s) => {
    g.fillStyle = '#6A2C8E';
    for (const [x, y] of [[0.38, 0.42], [0.62, 0.42], [0.5, 0.56], [0.4, 0.7], [0.6, 0.7], [0.5, 0.84]]) {
      g.beginPath(); g.arc(s * x, s * y, s * 0.1, 0, Math.PI * 2); g.fill();
    }
  },
  'fruit.STRAW': (g, s) => {
    g.fillStyle = '#E0203A';
    g.beginPath(); g.moveTo(s * 0.5, s * 0.9); g.lineTo(s * 0.22, s * 0.35); g.lineTo(s * 0.78, s * 0.35); g.closePath(); g.fill();
    g.fillStyle = '#3A9A3A'; g.fillRect(s * 0.3, s * 0.2, s * 0.4, s * 0.1);
  },
  'fruit.MELON': (g, s) => {
    g.fillStyle = '#3A9A3A';
    g.beginPath(); g.arc(s * 0.5, s * 0.5, s * 0.36, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#E8F0C0';
    g.beginPath(); g.arc(s * 0.5, s * 0.5, s * 0.22, 0, Math.PI * 2); g.fill();
  },
  'fruit.BAR': (g, s) => {
    g.fillStyle = '#101010'; g.fillRect(s * 0.14, s * 0.32, s * 0.72, s * 0.36);
    g.fillStyle = '#FFD040'; g.font = `bold ${Math.floor(s * 0.26)}px monospace`; g.textAlign = 'center';
    g.fillText('BAR', s * 0.5, s * 0.6);
  },
  'fruit.STAR': (g, s) => {
    g.fillStyle = '#FFD040';
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? s * 0.4 : s * 0.18;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      g.lineTo(s * 0.5 + Math.cos(a) * r, s * 0.5 + Math.sin(a) * r);
    }
    g.closePath(); g.fill();
  },
  'fruit.BAG': (g, s) => {
    g.fillStyle = '#8A6A30';
    g.beginPath(); g.ellipse(s * 0.5, s * 0.62, s * 0.3, s * 0.27, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#FFD040'; g.font = `bold ${Math.floor(s * 0.3)}px monospace`; g.textAlign = 'center';
    g.fillText('$', s * 0.5, s * 0.7);
  },
  'fruit.STEP': (g, s) => {
    g.fillStyle = '#FFD040';
    g.beginPath(); g.moveTo(s * 0.12, s * 0.4); g.lineTo(s * 0.58, s * 0.4); g.lineTo(s * 0.58, s * 0.22);
    g.lineTo(s * 0.9, s * 0.5); g.lineTo(s * 0.58, s * 0.78); g.lineTo(s * 0.58, s * 0.6); g.lineTo(s * 0.12, s * 0.6);
    g.closePath(); g.fill();
  },
};

export function buildModel(kit: KitX, o: ModelOpts): MachineModel<FruitParts> {
  const { pal } = kit;
  const variant = o.variant ?? 0;
  const body = BODY_BY_VARIANT[variant] ?? BODY_BY_VARIANT[0];
  const trim = TRIM_BY_VARIANT[variant] ?? TRIM_BY_VARIANT[0];
  const root = kit.group('fruitmachine');

  for (const [id, paint] of Object.entries(painters)) kit.tex.registerSymbol(id, paint);

  // ── static shell (flat colours, merged by finalize) ──
  const at = (x: number, y: number, z: number): { pos: [number, number, number]; parent: THREE.Object3D } => ({ pos: [x, y, z], parent: root });
  kit.box(0.70, 1.80, 0.60, body, at(0, 0.90, 0));                              // cabinet
  kit.box(0.72, 0.03, 0.62, trim, at(0, 1.80, 0));                              // top trim
  kit.box(0.72, 0.03, 0.62, trim, at(0, 0.02, 0));                              // plinth trim
  for (const sx of [-1, 1]) kit.box(0.02, 1.80, 0.01, trim, at(sx * 0.355, 0.90, 0.301));   // front corner trims
  // reel window frame (gold) around the 0.36 × 0.12 strip
  kit.box(0.38, 0.012, 0.012, pal.gold, at(0, REEL_Y + 0.07, REEL_Z + 0.006));
  kit.box(0.38, 0.012, 0.012, pal.gold, at(0, REEL_Y - 0.07, REEL_Z + 0.006));
  for (const sx of [-1, 1]) kit.box(0.012, 0.14, 0.012, pal.gold, at(sx * 0.19, REEL_Y, REEL_Z + 0.006));
  // coin tray (chrome lip) in front of the lower cabinet
  kit.box(0.46, 0.04, 0.14, CHROME, at(0, 0.44, 0.37));
  kit.box(0.46, 0.02, 0.01, trim, at(0, 0.47, 0.44));

  // ── reels: 20 facets, strip 32 px per facet ──
  const reels = REEL_X.map((x, r) => {
    const symbols = STRIPS[r].map((s) => SYMBOL_TEX[s]);
    const part = kit.reel({ radius: REEL_R, width: REEL_W, symbols, cell: 32 });
    part.root.position.set(x, REEL_Y, REEL_Z);
    root.add(part.root);
    return part;
  }) as [ReelPart, ReelPart, ReelPart];

  // ── top glass + marquee ──
  const glass = kit.screen({ w: 0.60, h: 0.36, px: [240, 144], bezel: BLACK });
  glass.mesh.position.set(0, GLASS_Y, 0.304);
  root.add(glass.mesh);
  const marquee = kit.marquee({ w: 0.50, h: 0.09, text: { key: 'm.fruitmachine.marquee' }, color: GOLD_LETTER, bg: body, bulbs: 10 });
  marquee.root.position.set(0, 1.755, 0.306);
  root.add(marquee.root);

  // ── buttons: HOLD 1–3 (yellow), START (green), COLLECT (red), HI / LO ──
  const hold = REEL_X.map((x) => {
    const b = kit.button({ shape: 'round', r: 0.03, color: YELLOW });
    b.root.position.set(x, BUTTON_Y, REEL_Z + 0.01);
    root.add(b.root);
    return b;
  }) as [ButtonPart, ButtonPart, ButtonPart];
  const start = kit.button({ shape: 'round', r: 0.04, color: GREEN });
  start.root.position.set(0.25, BUTTON_Y, REEL_Z + 0.01);
  const collect = kit.button({ shape: 'round', r: 0.03, color: RED });
  collect.root.position.set(0.25, 0.85, REEL_Z + 0.01);
  const hi = kit.button({ shape: 'round', r: 0.028, color: pal.neonCyan });
  hi.root.position.set(-0.25, BUTTON_Y, REEL_Z + 0.01);
  const lo = kit.button({ shape: 'round', r: 0.028, color: pal.neonPink });
  lo.root.position.set(-0.25, 0.85, REEL_Z + 0.01);
  root.add(start.root, collect.root, hi.root, lo.root);

  // ── LED panels (front, below the buttons) ──
  const nudges = kit.ledPanel({ digits: 1, color: '#ffb020', h: 0.035 });
  nudges.root.position.set(-0.12, 0.74, REEL_Z + 0.01);
  const hilo = kit.ledPanel({ digits: 2, color: '#ffb020', h: 0.035 });
  hilo.root.position.set(0.0, 0.74, REEL_Z + 0.01);
  const win = kit.ledPanel({ digits: 4, color: '#ff3030', h: 0.03 });
  win.root.position.set(0.12, 0.74, REEL_Z + 0.01);
  const credit = kit.ledPanel({ digits: 4, color: '#ff3030', h: 0.03 });
  credit.root.position.set(-0.13, 0.66, REEL_Z + 0.01);
  const bet = kit.ledPanel({ digits: 2, color: '#ff3030', h: 0.03 });
  bet.root.position.set(0.13, 0.66, REEL_Z + 0.01);
  root.add(nudges.root, hilo.root, win.root, credit.root, bet.root);

  // ── feature lamps (HOLD lit, a feature awarded) ──
  const holdLamp = kit.lamp({ r: 0.02, color: LAMP_HOLD, shape: 'dome' });
  holdLamp.root.position.set(-0.28, 1.10, REEL_Z + 0.01);
  const featureLamp = kit.lamp({ r: 0.02, color: LAMP_FEATURE, shape: 'dome' });
  featureLamp.root.position.set(0.28, 1.10, REEL_Z + 0.01);
  root.add(holdLamp.root, featureLamp.root);

  // ── side bulb chains: 2 vertical strips × 12 bulbs ──
  const strip = (x: number): BulbChain => {
    const chain = kit.bulbChain({
      path: [[x, 0.55, REEL_Z + 0.01], [x, 1.72, REEL_Z + 0.01]], count: 12, colors: [pal.neonYellow, pal.neonPink], r: 0.008,
    });
    root.add(chain.root);
    return chain;
  };
  const side: [BulbChain, BulbChain] = [strip(-0.335), strip(0.335)];

  // ── anchors ──
  const speaker = new THREE.Object3D(); speaker.position.set(0, 1.30, REEL_Z + 0.01); root.add(speaker);
  const prompt = new THREE.Object3D(); prompt.position.set(0, 0.60, REEL_Z + 0.02); root.add(prompt);
  const label = new THREE.Object3D(); label.position.set(0, 1.00, REEL_Z + 0.02); root.add(label);
  const servicePlate = new THREE.Object3D(); servicePlate.position.set(0.32, 0.60, REEL_Z + 0.02); root.add(servicePlate);
  const stand = new THREE.Object3D(); stand.position.set(0, 0, REEL_Z + 0.22); root.add(stand);
  const tray = new THREE.Object3D(); tray.position.set(0, 0.46, 0.38); root.add(tray);
  const light = new THREE.Object3D();
  light.position.set(0, 1.45, 0.50);
  light.userData = { color: 0xffb040, intensity: 0.6, range: 1.0, flicker: 'STEADY' };
  root.add(light);
  const marqueeTop = new THREE.Object3D(); marqueeTop.position.set(0, 1.80, 0); root.add(marqueeTop);
  const fxTwist = new THREE.Object3D(); fxTwist.position.set(0, GLASS_Y, 0.32); root.add(fxTwist);

  const parts: FruitParts = {
    reels,
    buttons: { hold, start, collect, hi, lo },
    leds: { nudges, hilo, credit, win, bet },
    lamps: { hold: holdLamp, feature: featureLamp },
    glass,
    marquee,
    side,
    tray,
  };
  crispTexture(glass.tex, 4);                                  // on-machine text: linear + mips, not nearest
  for (const p of [nudges, hilo, win, credit, bet]) crispTexture(p.screen.tex, 4);
  kit.finalize(root, {
    keep: [
      ...reels.map((r) => r.root), glass.mesh, marquee.root, ...hold.map((b) => b.root),
      start.root, collect.root, hi.root, lo.root, nudges.root, hilo.root, win.root, credit.root, bet.root,
      holdLamp.root, featureLamp.root, ...side.map((c) => c.root), tray,
    ],
  });

  return {
    root,
    parts,
    // seat view: level camera 0.9 m off the reel plane, so the glass ladder, reels, buttons and LEDs all sit in the band between the HUD strips
    playPose: { pos: new THREE.Vector3(0, 1.09, 1.50), look: new THREE.Vector3(0, 1.09, 0), fov: 68, mouse: 'primary' },
    colliders: [{ min: [-0.36, 0, -0.31], max: [0.36, 1.82, 0.31] }],
    interact: { min: [-0.36, 0.3, -0.31], max: [0.36, 1.82, 0.36] },
    anchors: {
      speaker, prompt, label, marqueeTop, servicePlate, stand, coinOut: tray, light, fxTwist,
    },
    dispose: () => glass.dispose(),
  };
}
