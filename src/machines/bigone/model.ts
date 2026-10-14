/**
 * The Big One — XL hero cabinet, procedural model (MACHINES §2 / ART §5.1, owner: mdl-bigone).
 *  - `buildModel(kit, o)` returns the full `MachineModel` and nothing else touches the scene;
 *  - the exported `BigOneParts` type is the contract with the coder (`index.ts`);
 *  - metres, origin = floor centre, +Z = front (player side), Y up. Footprint 1.80 W × 1.40 D, height 3.10.
 *
 * Y bands: plinth 0–0.20 walnut + brass kick · belly 0.20–0.95 with the glass art (label + glass + crack/fog decals)
 * · deck 0.95–1.05 with the button panel (10° slope) and the LED strip · reel window 1.25–1.95 (five drums, r 0.55,
 * 16 facets, axis y 1.60) · top box 1.98–2.55 (amber top screen, last-10 lamps, hunger dial, hinged lid) ·
 * 13-ray sunburst crown 2.55–3.10 (medallion, crown chaser 48 bulbs). Left side: brass pattern plate with 15
 * lamps. Right side: chrome lever (pivot 0.95, 1.20, 0.10).
 *
 * Reel strips: each drum has a 32 × 512 canvas texture. Columns (x, 32 px) run ACROSS the reel axis, rows
 * (y, 512 px) run AROUND it, 32 px per facet (16 facets). The coder paints symbol cells per row.
 * The reel spins by rotating `reels[i].root` about X.
 *
 * Budget note: the spec asks for ≤ 24 draw calls and ≤ 6 textures; the keyed part list (5 drums, 15 cell frames,
 * 20 lamps, 13 rays, 2 bulb chains, …) makes that impossible. The model reports the real counts through
 * `kit.finalize` (logged in dev) so the director can decide what to merge.
 */
import * as THREE from 'three';
import type { V3 } from '@/core/types';
import type { ButtonPanelPart, PanelButton, LampPart, BulbChain, ScreenSurface, LabelPart } from '@/kit/types';
import type { KitX } from '@/kit/index';
import type { MachineModel } from '@/machines/_base/types';
import type { ModelOpts } from '@/machines/_base/MachineBase';
import { PATTERN_IDS } from './rules';

/** One drum of the five-reel window. `root` pivots on its axle (rotate X to spin); `strip` is the 32×512 painted symbol strip. */
export type BigOneReel = { root: THREE.Group; drum: THREE.Mesh; strip: THREE.Texture; canvas: HTMLCanvasElement };

/** Contract between modeler and coder. */
export type BigOneParts = {
  /** Five reels, index 0 = left. */
  reels: BigOneReel[];
  /** Emissive cell frames, index = row·5 + col (row 0 = top, col 0 = left reel). */
  cellFrames: THREE.Mesh[];
  /** Payline lamps: 0–2 left column (top→bottom), 3–5 right column. */
  paylineLamps: LampPart[];
  /** Left brass pattern plate, one lamp per PATTERN_IDS entry (two columns of eight, bottom→top). */
  patternLamps: LampPart[];
  /** Lever pivot at (0.95, 1.20, 0.10). Pull = rotation.x → +1.05 rad. */
  lever: THREE.Object3D;
  leverKnob: THREE.Mesh;
  /** Deck buttons: bet down / up / max, auto, spin, info. */
  buttons: Record<'betDn' | 'betUp' | 'betMax' | 'auto' | 'spin' | 'info', PanelButton>;
  /** The whole deck panel (single dynamic caps mesh, raycast via `pick`). */
  buttonPanel: ButtonPanelPart;
  leds: { credit: LampPart[]; bet: LampPart[]; win: LampPart[]; jackpot: LampPart[] };
  /** Thin chaser bar along the deck front lip. */
  ledStrip: BulbChain;
  /** Semicircle dial, pivot at its base. rotation.z 0 = needle up. */
  hungerNeedle: THREE.Object3D;
  /** Ten history lamps across the top box front. */
  last10: LampPart[];
  screens: { top: ScreenSurface };
  /** 48 crown bulbs (sunburst arc) and 40 window bulbs (chrome frame perimeter). */
  bulbs: { crown: BulbChain; window: BulbChain };
  /** Thirteen sunburst rays. */
  crownRays: THREE.Mesh[];
  /** Holder that spins about Y; `coin` (JackID medallion, r 0.22) is its only child. */
  medallion: THREE.Object3D;
  /** Hinged top lid, pivot at the back edge, opens by rotation.x = 25°. */
  topLid: THREE.Object3D;
  /** Coin tray root (front plinth). */
  tray: THREE.Object3D;
  /** Front glass over the belly art (ADD 0.25). */
  glass: THREE.Mesh;
  /** Crack decal on the glass art. Visible until the first upgrade is bought. */
  glassCrack: THREE.Mesh;
  fogDecal: THREE.Mesh;
  palmDecal: THREE.Mesh;
  /** Painted "THE BIG ONE" on the belly art (re-drawn on language change). */
  label: LabelPart;
};

export const W = 1.8, D = 1.4, H = 3.1;
/** Reel axle height and horizontal drum spacing. */
export const REEL_Y = 1.6, REEL_R = 0.55, REEL_W = 0.26, REEL_GAP = 0.02;
const REEL_X = (i: number): number => -0.56 + i * (REEL_W + REEL_GAP); // 0.28 pitch
const CELL_ROW_Y = (r: number): number => REEL_Y + (1 - r) * 0.23;
const WIN_TOP = 1.95, WIN_BOT = 1.25, WIN_W = 1.4;
const FRONT = 0.7;

/** Crown centre (sunburst base) and medallion height. */
const CROWN_C: V3 = [0, 2.55, 0.6];
const RAYS = 13;

const LEDS_CREDIT = 8, LEDS_BET = 3, LEDS_WIN = 8, LEDS_JACKPOT = 8;
const LAST10 = 10;
const CROWN_BULBS = 48, WINDOW_BULBS = 40;

/** Pick a point on a unit circle arc, used by the crown bulb path. */
function arc(cx: number, cy: number, z: number, r: number, from: number, to: number, n: number): V3[] {
  const pts: V3[] = [];
  for (let i = 0; i < n; i++) {
    const t = from + ((to - from) * i) / (n - 1);
    pts.push([cx + Math.cos(t) * r, cy + Math.sin(t) * r, z]);
  }
  return pts;
}

export function buildModel(kit: KitX, _o: ModelOpts): MachineModel<BigOneParts> {
  const { pal } = kit;
  const root = kit.group('bigone');

  const walnut = pal.woodDark, enamel = pal.red, gold = pal.gold, brass = pal.brass, chrome = pal.chrome;
  const at = (x: number, y: number, z: number): { pos: V3; parent: THREE.Object3D } => ({ pos: [x, y, z], parent: root });

  // ── static shell: flat colours; everything not in `keep` merges into one draw call ──
  // plinth + brass kick
  kit.box(W, 0.2, D, walnut, at(0, 0.1, 0));
  kit.box(W - 0.04, 0.03, 0.02, brass, at(0, 0.035, FRONT + 0.005));
  // belly (full depth 0.20–0.95) + front window cut-outs handled by the blocks below
  kit.box(W, 0.75, 1.3, enamel, at(0, 0.575, 0));
  // deck base (0.95–1.05)
  kit.box(W, 0.1, 0.9, enamel, at(0, 1.0, 0.25));
  // mid solid below / above the reel window, side blocks beside it
  kit.box(W, 0.3, 1.3, enamel, at(0, 1.1, 0));          // 0.95–1.25 solid strip
  kit.box(W, 0.03, 1.3, enamel, at(0, 1.965, 0));       // 1.95–1.98 solid strip
  kit.box(0.2, WIN_TOP - WIN_BOT, 1.3, enamel, at(0.8, (WIN_TOP + WIN_BOT) / 2, 0));
  kit.box(0.2, WIN_TOP - WIN_BOT, 1.3, enamel, at(-0.8, (WIN_TOP + WIN_BOT) / 2, 0));
  // top box (1.98–2.55)
  kit.box(W, 0.57, 1.3, enamel, at(0, 2.265, 0));
  // back panel and walnut sides
  kit.box(W, 2.55, 0.04, walnut, at(0, 1.275, -0.67));
  for (const sx of [-1, 1]) {
    kit.box(0.08, 2.35, 1.4, walnut, at(sx * 0.86, 1.375, 0));
    // three brass chevrons per side
    for (const y of [0.4, 0.6, 0.8]) kit.box(0.012, 0.05, 0.05, brass, { pos: [sx * 0.905, y, 0.2], rot: [0, 0, 45], parent: root });
    // two magenta neon tubes on the front edges, 1.6 m tall
    kit.tube([[sx * 0.915, 0.5, 0.66], [sx * 0.915, 2.1, 0.66]], 0.012, pal.neonPink, { parent: root, seg: 4, radialSeg: 4 });
  }
  // gold trim under the top box and along the lid edge
  kit.box(W - 0.04, 0.03, 0.04, gold, at(0, 1.98, 0.655));
  kit.box(W - 0.04, 0.03, 0.04, gold, at(0, 2.55, 0.655));
  // chrome window frame (1.40 × 0.70 around the drums), front face
  kit.box(WIN_W + 0.04, 0.03, 0.05, chrome, at(0, WIN_TOP + 0.015, 0.66));
  kit.box(WIN_W + 0.04, 0.03, 0.05, chrome, at(0, WIN_BOT - 0.015, 0.66));
  for (const sx of [-1, 1]) kit.box(0.03, WIN_TOP - WIN_BOT + 0.06, 0.05, chrome, at(sx * (WIN_W / 2 + 0.015), REEL_Y, 0.66));
  // pattern plate (left side, 0.40 × 0.90, brass)
  kit.box(0.02, 0.9, 0.4, brass, at(-0.912, 1.45, 0));
  // coin tray is built separately (kit.coinTray) and is kept

  // ── reels (5 drums) ──
  const reels: BigOneReel[] = [];
  for (let i = 0; i < 5; i++) {
    const rootR = kit.group(`reel${i}`);
    rootR.position.set(REEL_X(i), REEL_Y, 0);
    root.add(rootR);
    const strip = kit.tex.canvas(32, 512, (g, w, h) => {
      // placeholder strip so the drum reads before the coder paints it: 16 facets, alternating
      for (let k = 0; k < 16; k++) {
        g.fillStyle = k % 2 ? '#f1e2b8' : '#2a1a14';
        g.fillRect(0, (k * h) / 16, w, h / 16);
      }
    });
    strip.colorSpace = THREE.NoColorSpace;
    strip.magFilter = THREE.NearestFilter;
    const drum = kit.cyl(REEL_R, REEL_R, REEL_W, kit.mat({ map: strip, lit: false }), { seg: 16, parent: rootR, name: `drum${i}` });
    drum.rotation.z = Math.PI / 2;
    // remap UVs so u = across the reel axis (32 px wide), v = around the drum (512 px = 16 facets × 32)
    const pos = drum.geometry.attributes.position as THREE.BufferAttribute;
    const uv = drum.geometry.attributes.uv as THREE.BufferAttribute;
    if (pos && uv) {
      for (let v = 0; v < pos.count; v++) {
        const x = pos.getX(v), y = pos.getY(v), z = pos.getZ(v);
        const t = (y + REEL_W / 2) / REEL_W;
        const a = Math.atan2(z, x) / (2 * Math.PI) + 0.5;
        uv.setXY(v, t, a);
      }
      uv.needsUpdate = true;
    }
    reels.push({ root: rootR, drum, strip, canvas: strip.image as HTMLCanvasElement });
  }

  // ── cell frames: 15 emissive frames over the window (index r·5 + c) ──
  const cellFrames: THREE.Mesh[] = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 5; c++) {
      const f = kit.plane(0.26, 0.21, { color: pal.black, emissive: pal.neonYellow, emissiveIntensity: 0.26, lit: false, transparent: true, opacity: 0.5, additive: true }, {
        pos: [REEL_X(c), CELL_ROW_Y(r), 0.685], parent: root, name: `cell${r * 5 + c}`,
      });
      cellFrames.push(f);
    }
  }

  // ── payline lamps (6): three each side of the window ──
  const paylineLamps: LampPart[] = [];
  for (let k = 0; k < 6; k++) {
    const side = k < 3 ? -1 : 1;
    const row = k % 3;
    const lamp = kit.lamp({ r: 0.02, color: gold, shape: 'dome' });
    lamp.root.position.set(side * 0.76, CELL_ROW_Y(row), 0.665);
    root.add(lamp.root);
    paylineLamps.push(lamp);
  }

  // ── pattern lamps (one per PATTERN_IDS entry, 15) on the left brass plate: two columns of eight ──
  const patternLamps: LampPart[] = [];
  for (let col = 0; col < 2; col++) {
    for (let row = 0; row < 8; row++) {
      if (patternLamps.length >= PATTERN_IDS.length) break;
      const lamp = kit.lamp({ r: 0.018, color: pal.neonCyan, shape: 'flat' });
      lamp.root.position.set(-0.925, 1.04 + row * 0.108, col === 0 ? -0.12 : 0.12);
      lamp.root.rotation.y = -Math.PI / 2;
      root.add(lamp.root);
      patternLamps.push(lamp);
    }
  }

  // ── lever (right side) ──
  const lever = new THREE.Object3D();
  lever.name = 'lever';
  lever.position.set(0.95, 1.2, 0.1);
  root.add(lever);
  kit.cyl(0.025, 0.025, 0.95, chrome, { pos: [0, 0.475, 0], parent: lever, seg: 8 });
  const leverKnob = kit.sphere(0.075, pal.red, { pos: [0, 0.95, 0], parent: lever, wSeg: 6, hSeg: 4 });

  // ── deck button panel + LEDs (children of the panel root, so they tilt with it) ──
  const buttonPanel = kit.buttonPanel({
    w: 1.7, d: 0.44, slope: 10, plate: pal.blood, capH: 0.02,
    buttons: [
      { id: 'betDn', color: gold, x: -0.62, z: 0, w: 0.12, h: 0.1 },
      { id: 'betUp', color: gold, x: -0.48, z: 0, w: 0.12, h: 0.1 },
      { id: 'betMax', color: pal.red, x: -0.34, z: 0, w: 0.12, h: 0.1 },
      { id: 'auto', color: pal.neonCyan, x: -0.1, z: 0, w: 0.14, h: 0.1 },
      { id: 'spin', color: pal.red, x: 0.3, z: 0, w: 0.26, h: 0.18 },
      { id: 'info', color: chrome, x: 0.62, z: 0, w: 0.12, h: 0.1 },
    ],
  });
  buttonPanel.root.position.set(0, 1.06, 0.42);
  root.add(buttonPanel.root);

  const ledRow = (n: number, x0: number, step: number, color: number): LampPart[] => {
    const out: LampPart[] = [];
    for (let i = 0; i < n; i++) {
      const l = kit.lamp({ r: 0.011, color, shape: 'flat' });
      l.root.position.set(x0 + i * step, 0.012, -0.15);
      buttonPanel.root.add(l.root);
      out.push(l);
    }
    return out;
  };
  const leds = {
    credit: ledRow(LEDS_CREDIT, -0.8, 0.04, pal.neonYellow),
    bet: ledRow(LEDS_BET, -0.42, 0.04, pal.gold),
    win: ledRow(LEDS_WIN, 0.15, 0.04, pal.neonPink),
    jackpot: ledRow(LEDS_JACKPOT, 0.5, 0.04, pal.red),
  };
  const ledStrip = kit.lightStrip({ length: 1.7, color: pal.neonYellow, thickness: 0.012, segments: 24, axis: 'x' });
  ledStrip.root.position.set(0, 1.13, FRONT - 0.01);
  root.add(ledStrip.root);

  // ── top box: screen, hunger dial, last-10 lamps ──
  const screen = kit.screen({ w: 0.8, h: 0.24, px: [160, 48], bezel: pal.black });
  screen.mesh.position.set(0, 2.3, 0.655);
  root.add(screen.mesh);

  const last10: LampPart[] = [];
  for (let i = 0; i < LAST10; i++) {
    const l = kit.lamp({ r: 0.02, color: gold, shape: 'dome' });
    l.root.position.set(-0.72 + i * 0.09, 2.03, 0.665);
    root.add(l.root);
    last10.push(l);
  }

  const dialShape: Array<[number, number]> = [];
  for (let i = 0; i <= 12; i++) {
    const t = (Math.PI * i) / 12;
    dialShape.push([Math.cos(t) * 0.13, Math.sin(t) * 0.13]);
  }
  kit.extrude(dialShape, 0.01, pal.cream, { pos: [0.55, 2.1, 0.655], parent: root, name: 'hungerDial' });
  const hungerNeedle = new THREE.Object3D();
  hungerNeedle.name = 'hungerNeedle';
  hungerNeedle.position.set(0.55, 2.1, 0.67);
  root.add(hungerNeedle);
  kit.box(0.012, 0.12, 0.012, pal.red, { pos: [0, 0.06, 0], parent: hungerNeedle });

  // ── bulb chains: crown arc (48) and window perimeter (40) ──
  const crownBulbs = kit.bulbChain({
    path: arc(CROWN_C[0], CROWN_C[1], CROWN_C[2] + 0.02, 0.46, 0, Math.PI, CROWN_BULBS),
    count: CROWN_BULBS,
    colors: [gold, pal.red],
    r: 0.012,
  });
  root.add(crownBulbs.root);
  const windowBulbs = kit.bulbChain({ path: { rect: [WIN_W + 0.06, WIN_TOP - WIN_BOT + 0.06] }, count: WINDOW_BULBS, colors: [gold, pal.neonPink], r: 0.012 });
  windowBulbs.root.position.set(0, REEL_Y, 0.69);
  root.add(windowBulbs.root);

  // ── crown: 13-ray sunburst fanning from the lid edge ──
  const crownRays: THREE.Mesh[] = [];
  for (let i = 0; i < RAYS; i++) {
    const th = (Math.PI * i) / (RAYS - 1);
    const cx = CROWN_C[0] + Math.cos(th) * 0.4;
    const cy = CROWN_C[1] + Math.sin(th) * 0.4;
    const ray = kit.box(0.035, 0.2, 0.02, i % 2 ? gold : pal.red, {
      pos: [cx, cy, CROWN_C[2]],
      rot: [0, 0, ((th - Math.PI / 2) * 180) / Math.PI],
      parent: root,
      name: `ray${i}`,
    });
    crownRays.push(ray);
  }

  // medallion: holder spins about Y; the coin face points to the front (rotation.x = π/2)
  const medallion = new THREE.Object3D();
  medallion.name = 'medallion';
  medallion.position.set(0, 2.78, 0.62);
  root.add(medallion);
  const coin = kit.coin({ r: 0.22, thick: 0.03, heads: 'crown', tails: 'eye', color: gold });
  coin.rotation.x = Math.PI / 2;
  medallion.add(coin);

  // top lid (hinged at the back edge, closed at rotation 0)
  const topLid = new THREE.Object3D();
  topLid.name = 'topLid';
  topLid.position.set(0, 2.55, -0.65);
  root.add(topLid);
  kit.box(1.76, 0.03, 1.28, enamel, { pos: [0, 0.015, 0.64], parent: topLid });

  // coin tray (front plinth), its anchor is the coinOut point
  const trayPart = kit.coinTray({ w: 0.5, color: brass });
  trayPart.root.position.set(0, 0.2, 0.72);
  root.add(trayPart.root);

  // ── glass art: label, glass, crack / fog / palm decals ──
  const label = kit.label({ text: { key: 'm.bigone.name' }, w: 1.4, h: 0.55, px: [256, 100], color: gold, bg: pal.black });
  label.mesh.position.set(0, 0.575, 0.655);
  root.add(label.mesh);
  const glass = kit.glass({ w: 1.4, h: 0.55, d: 0.02, tint: pal.glass, opacity: 0.25 });
  glass.position.set(0, 0.575, 0.675);
  root.add(glass);

  // one 256×256 decal atlas: top-left crack, top-right fog, bottom-left palm
  const atlas = kit.tex.canvas(256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(10, 10); g.lineTo(60, 60); g.lineTo(50, 90); g.lineTo(100, 120);
    g.moveTo(60, 60); g.lineTo(120, 50);
    g.stroke();
    const grd = g.createRadialGradient(192, 64, 4, 192, 64, 110);
    grd.addColorStop(0, 'rgba(255,255,255,0.7)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(128, 0, 128, 128);
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.beginPath();
    g.moveTo(40, 220); g.lineTo(70, 160); g.lineTo(90, 210); g.lineTo(120, 150); g.lineTo(115, 230); g.closePath();
    g.fill();
  });
  atlas.colorSpace = THREE.NoColorSpace;
  const quad = (ox: number, oy: number): THREE.Texture => {
    const t = atlas.clone();
    t.repeat.set(0.5, 0.5);
    t.offset.set(ox, oy);
    t.needsUpdate = true;
    return t;
  };
  const glassCrack = kit.decal({ tex: quad(0, 0.5), w: 1.4, h: 0.55, alphaTest: 0.1 });
  glassCrack.position.set(0, 0.575, 0.686);
  root.add(glassCrack);
  const fogDecal = kit.decal({ tex: quad(0.5, 0.5), w: 1.4, h: 0.2, alphaTest: 0.05 });
  fogDecal.position.set(0, 0.3, 0.687);
  root.add(fogDecal);
  const palmDecal = kit.decal({ tex: quad(0, 0), w: 0.28, h: 0.24, alphaTest: 0.1 });
  palmDecal.position.set(-0.65, 2.3, 0.661);
  root.add(palmDecal);

  // ── lights and anchors (no THREE.Light inside machines) ──
  const light = new THREE.Object3D();
  light.position.set(0, 2.9, 0.4);
  light.userData = { color: gold, intensity: 1.2, range: 6, flicker: 'BUZZ' };
  root.add(light);
  const light2 = new THREE.Object3D();
  light2.position.set(0, 1.6, 1.0);
  light2.userData = { color: pal.neonPink, intensity: 0.8, range: 4, flicker: 'STEADY' };
  root.add(light2);

  const anchor = (name: string, x: number, y: number, z: number): THREE.Object3D => {
    const o = new THREE.Object3D();
    o.name = name;
    o.position.set(x, y, z);
    root.add(o);
    return o;
  };
  const speaker = anchor('speaker', 0, 1.1, 0);
  const prompt = anchor('prompt', 0, 2.8, 0.7);
  const labelAnchor = anchor('label', 0, 0.575, 0.66);
  const marqueeTop = anchor('marqueeTop', 0, 3.1, 0);
  const servicePlate = anchor('servicePlate', 0, 0.12, 0.71);
  const upgradeMounts = anchor('upgradeMounts', 0, 2.55, -0.6);
  const stand = anchor('stand', 0, 0, 0.9);
  const coinOut = anchor('coinOut', 0, 0.38, 0.7);
  const insideGlass = anchor('insideGlass', 0, 1.6, 0.3);

  const buttons = buttonPanel.buttons as BigOneParts['buttons'];

  const parts: BigOneParts = {
    reels,
    cellFrames,
    paylineLamps,
    patternLamps,
    lever,
    leverKnob,
    buttons,
    buttonPanel,
    leds,
    ledStrip,
    hungerNeedle,
    last10,
    screens: { top: screen },
    bulbs: { crown: crownBulbs, window: windowBulbs },
    crownRays,
    medallion,
    topLid,
    tray: trayPart.root,
    glass,
    glassCrack,
    fogDecal,
    palmDecal,
    label,
  };

  const keep: Array<THREE.Object3D | { root: THREE.Object3D }> = [
    ...reels.map((r) => r.root),
    ...cellFrames,
    ...paylineLamps.map((l) => l.root),
    ...patternLamps.map((l) => l.root),
    lever,
    buttonPanel.root,
    ledStrip.root,
    hungerNeedle,
    ...last10.map((l) => l.root),
    screen.mesh,
    crownBulbs.root,
    windowBulbs.root,
    ...crownRays,
    medallion,
    topLid,
    trayPart.root,
    glass,
    glassCrack,
    fogDecal,
    palmDecal,
    label.mesh,
    light,
    light2,
  ];
  const stats = kit.finalize(root, { keep });
  void stats; // { drawCalls, tris } — checked with bench F3

  return {
    root,
    parts,
    playPose: { pos: new THREE.Vector3(0, 1.62, 1.5), look: new THREE.Vector3(0, 1.5, 0.45), fov: 58, mouse: 'primary' },
    colliders: [{ min: [-W / 2, 0, -D / 2], max: [W / 2, H - 0.02, D / 2] }],
    interact: { min: [-W / 2, 0.2, -D / 2], max: [W / 2, H - 0.02, FRONT + 0.1] },
    anchors: {
      speaker, prompt, label: labelAnchor, marqueeTop, servicePlate, upgradeMounts, stand, coinOut, insideGlass, light, light2,
    },
    dispose: () => screen.dispose(),
  };
}
