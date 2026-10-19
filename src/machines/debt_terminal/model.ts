/**
 * Debt Terminal — procedural model (devices-core, system category). Pattern: see `coinflip/model.ts`.
 *
 * The House Bank at MOUTH-TERM, an old bank teller booth: walnut posts and canopy, a walnut counter with raised panels and a
 * brass lip, a brass-barred glass teller window (an arched pass at the sill, pigeonholes and a green banker's lamp inside, the
 * House eye behind the glass: `emblemLid` lifts when the House looks at you), the red quota LED on the window sill, a green
 * phosphor CRT in a putty terminal housing below it, tall mechanical keys in chrome collars on a sloped plate, the amber deposit
 * LED, a deposit mouth with chewing lips, a receipt printer, the ledger on its stand with a rubber stamp, the cash drawer under
 * the lip (`teller`: a deposit slides it out and thumps PAID / ÖDENDİ into the ledger), a card reader for the JackID, the brass
 * SETTLE lever (right), OPEN THE FLOOR lever (left) and a bell rope on the right post.
 *
 * Footprint 1.20 × 0.90 × 2.40 m (M slot, PLAN §4.3). Origin = floor centre, +Z = player side. Keypad is the only
 * mouse target (play pose `mouse: 'pick'`). Digits come from the keyboard (n1…n9, Backspace, Enter).
 */
import * as THREE from 'three';
import type { ButtonPanelPart, LedPanelPart, LampPart, LeverPart, ScreenSurface } from '@/kit/types';
import type { KitX } from '@/kit';
import type { MachineModel } from '@/machines/_base/types';
import type { ModelOpts } from '@/machines/_base/MachineBase';
import type { PanelButtonSpec } from '@/kit/types';
import { KEYS } from './rules';
import { crispTexture } from '@/core/ui/textOverlay';
import { presets } from '@/kit/presets';

/** The teller's desk animation: `pose('out', k)` slides the drawer out and lifts the stamp, `pose('back', k)` thumps it and closes. */
export type TellerPart = {
  drawer: THREE.Object3D;
  stamp: THREE.Object3D;
  /** The PAID / ÖDENDİ ink on the ledger page: hidden until the first thump. */
  imprint: THREE.Object3D;
  pose(phase: 'out' | 'back', k: number): void;
};

export type DebtParts = {
  /** 512 × 384 green phosphor CRT: due, deposited, left, the amount being typed. */
  crt: ScreenSurface;
  /** Red 10-digit quota LED and amber deposit LED. */
  leds: { quota: LedPanelPart; deposit: LedPanelPart };
  /** Keypad, one dynamic mesh. Cells follow `rules.KEYS`. Its words are DOM chips (`labels.ts`), not part of the model. */
  keys: ButtonPanelPart;
  /** Gold frame that marks the keypad cursor cell (moved by `index.ts`, child of `keys.root`). */
  keyCursor: THREE.Object3D;
  /** Receipt paper, 64 × 80 px, slides up from the printer on every deposit. */
  receipt: ScreenSurface;
  receiptPivot: THREE.Object3D;
  /** Deposit mouth lips: open wide, then chew. */
  mouthLips: THREE.Object3D;
  /** House eye lid over the alcove. */
  emblemLid: THREE.Object3D;
  settleLever: LeverPart;
  floorLever: LeverPart;
  bellRope: THREE.Object3D;
  /** Swipe-slot light: blinks green on each card swipe. */
  swipe: LampPart;
  /** Ready lamp next to the bell rope. */
  readyLamp: LampPart;
  /** Cash drawer, ledger stamp and its ink (deposit animation). */
  teller: TellerPart;
};

export const W = 1.2, D = 0.9, H = 2.4;
const COUNTER_TOP = 1.07;
const KEYPAD_Z = 0.18;

/** Keypad layout: 3 columns × 3 rows, cells named by `rules.KEYS`. Caps are KEY_W × KEY_H on a 0.16 × 0.09 pitch.
 *  The caps were 0.2 × 0.1 on a 0.22 × 0.12 pitch — oversized against the counter and crowding the plate edge. */
export const KEY_POS: Record<(typeof KEYS)[number], { x: number; z: number }> = {
  dep: { x: -0.16, z: -0.09 }, wd: { x: 0, z: -0.09 }, quota: { x: 0.16, z: -0.09 },
  p10: { x: -0.16, z: 0 }, p25: { x: 0, z: 0 }, p50: { x: 0.16, z: 0 },
  all: { x: -0.16, z: 0.09 }, rest: { x: 0, z: 0.09 }, enter: { x: 0.16, z: 0.09 },
};
export const KEY_W = 0.152, KEY_H = 0.082;     // bigger caps: the labels are what the player reads at the PSX frame size
/** Cap height: tall mechanical keys, like an old adding machine. */
export const KEY_CAP_H = 0.048;
/** Top of a keypad cap in panel space (`kit.buttonPanel`: plate 0.012 + cap). `labels.ts` lays the key chips on it. */
export const CAP_TOP = 0.012 + KEY_CAP_H;
/** The CRT's plane (m) and texture (px): `labels.ts` maps the tab strip's texture rectangles onto it. */
export const SCR_W = 0.58, SCR_H = 0.435, SCR_Y = 1.55;
export const CRT_PX: [number, number] = [512, 384];

export function buildModel(kit: KitX, o: ModelOpts): MachineModel<DebtParts> {
  const { pal } = kit;
  const root = kit.group('debt_terminal');

  // ── static shell: an old bank teller booth (walnut, brass, green leather), merged by kit.finalize ──
  const at = (x: number, y: number, z: number): { pos: [number, number, number]; parent: THREE.Object3D } => ({ pos: [x, y, z], parent: root });
  const M = presets(kit.tex);
  const walnut = pal.woodDark, panel = pal.wood, leather = M.leather(0x1c3a26, false), putty = M.enamel(0x9a9078, 0.2);
  const gunDark = 0x1c1c24;
  kit.box(W, 0.12, D, walnut, at(0, 0.06, 0));                                               // plinth
  kit.box(W, 0.025, 0.02, pal.brass, at(0, 0.11, D / 2 + 0.005));                            // brass kick on the plinth nose
  kit.box(W, H - 0.12, 0.12, walnut, at(0, (H + 0.12) / 2, -D / 2 + 0.06));                  // alcove back
  kit.box(W - 0.2, 0.95, 0.02, leather, at(0, 1.62, -D / 2 + 0.13));                         // green leather behind the window
  for (const sx of [-1, 1]) {
    kit.box(0.08, H - 0.12, D, walnut, at(sx * (W / 2 - 0.04), (H + 0.12) / 2, 0));          // posts
    kit.box(0.1, 0.06, 0.1, pal.brass, at(sx * (W / 2 - 0.04), 0.15, D / 2 - 0.05));          // brass shoes on the post feet
    kit.box(0.012, H - 0.4, 0.012, pal.brass, at(sx * (W / 2 - 0.085), H / 2, D / 2 - 0.02));  // brass bead on the post edge
  }
  kit.box(W, 0.1, D, walnut, at(0, H - 0.05, 0));                                            // canopy
  kit.box(W - 0.02, 0.03, D - 0.02, pal.brass, at(0, H - 0.12, 0));                          // brass trim under canopy
  // the counter: a walnut cabinet with raised panels, a brass lip and kick, and the cash drawer under the lip
  kit.box(1.0, COUNTER_TOP - 0.12, 0.62, panel, { ...at(0, (COUNTER_TOP + 0.12) / 2, 0.1), bevel: 0.012 });   // cabinet body
  kit.box(1.06, 0.035, 0.7, leather, at(0, COUNTER_TOP - 0.0175, 0.1));                                     // green leather counter top
  kit.box(1.07, 0.04, 0.02, pal.brass, at(0, COUNTER_TOP - 0.02, 0.455));                                    // brass nosing
  kit.box(1.02, 0.07, 0.64, pal.brass, at(0, 0.155, 0.1));                                                   // kick strip
  kit.box(0.9, 0.5, 0.02, walnut, at(0, 0.62, 0.41));                                                         // front fascia
  for (const sx of [-1, 1]) kit.box(0.17, 0.4, 0.012, panel, at(sx * 0.33, 0.62, 0.424));                     // raised side panels
  kit.box(0.94, 0.03, 0.03, pal.brass, at(0, 0.89, 0.415));                                                   // fascia top rail
  kit.box(0.94, 0.03, 0.03, pal.brass, at(0, 0.35, 0.415));                                                   // fascia bottom rail
  kit.box(0.9, 0.03, 0.01, pal.redDark, at(0, 0.28, 0.42));                                                   // oxblood base stripe
  for (const sx of [-1, 1]) for (const sy of [0.4, 0.84]) kit.sphere(0.014, pal.gold, { ...at(sx * 0.42, sy, 0.425), wSeg: 5, hSeg: 3 });   // brass bosses
  kit.box(0.6, 0.1, 0.012, gunDark, at(0, 0.96, 0.412));                                      // the drawer's dark slot
  // keypad rail: a brass frame round the sloped plate
  for (const sx of [-1, 1]) kit.box(0.035, 0.05, 0.46, pal.brass, at(sx * 0.395, COUNTER_TOP + 0.025, KEYPAD_Z));
  kit.box(0.82, 0.05, 0.035, pal.brass, at(0, COUNTER_TOP + 0.025, KEYPAD_Z + 0.225));
  kit.box(0.82, 0.07, 0.035, pal.brass, at(0, COUNTER_TOP + 0.035, KEYPAD_Z - 0.225));
  // receipt printer: putty housing (the terminal's) with a black feed slot and a brass bezel
  kit.box(0.26, 0.1, 0.22, putty, { ...at(-0.38, COUNTER_TOP + 0.05, 0.12), bevel: 0.008 });
  kit.box(0.2, 0.012, 0.03, pal.black, at(-0.38, COUNTER_TOP + 0.101, 0.05));
  kit.box(0.27, 0.014, 0.23, pal.brass, at(-0.38, COUNTER_TOP + 0.003, 0.12));
  // card reader for the JackID on the fascia: brass plate, black slot, a small guide arrow
  kit.box(0.26, 0.13, 0.02, pal.brass, at(0.36, 0.6, 0.43));
  kit.box(0.2, 0.014, 0.022, pal.black, at(0.36, 0.615, 0.435));
  kit.box(0.2, 0.03, 0.014, gunDark, at(0.36, 0.565, 0.438));
  kit.box(0.22, 0.12, 0.04, pal.black, at(0, 0.7, 0.42));                                    // deposit mouth recess
  kit.box(0.5, 0.2, 0.04, pal.brass, at(0, 0.73, 0.43));                                     // mouth plate
  kit.box(0.46, 0.04, 0.12, pal.gold, at(0, 1.22, -0.02));                                   // deposit LED bezel

  // ── the teller window above the CRT: a walnut sill carrying the quota LED, a glass pane, brass bars with an arched pass ──
  const WIN_B = 1.965, WIN_T = H - 0.18, WIN_Y = (WIN_B + WIN_T) / 2, WIN_H = WIN_T - WIN_B, WIN_W = W - 0.16;
  kit.box(WIN_W, 0.125, 0.14, walnut, at(0, 1.9, -0.06));                                    // sill beam (the quota LED's housing)
  kit.box(0.5, 0.11, 0.012, gunDark, at(0, 1.9, 0.016));                                    // dark plate round the quota LED
  for (const sy of [-1, 1]) kit.box(0.5, 0.008, 0.016, pal.brass, at(0, 1.9 + sy * 0.055, 0.018));
  kit.box(WIN_W, 0.02, 0.18, walnut, at(0, WIN_B + 0.01, -0.05));                             // sill top
  kit.box(WIN_W, 0.01, 0.012, pal.brass, at(0, WIN_B + 0.015, 0.035));                         // its brass edge
  const pane = kit.glass({ w: WIN_W, h: WIN_H, d: 0.008, tint: pal.glass, opacity: 0.16 });
  pane.position.set(0, WIN_Y, -0.03);
  root.add(pane);
  const ARCH_R = 0.15, ARCH_Y = WIN_B + 0.02;                                                 // the pass: an open arch at the sill
  kit.torus(ARCH_R, 0.008, pal.brass, { pos: [0, ARCH_Y, -0.012], arc: Math.PI, seg: 10, tubeSeg: 3, parent: root });
  for (let x = -WIN_W / 2 + 0.04; x <= WIN_W / 2 - 0.039; x += 0.064) {
    const inArch = Math.abs(x) < ARCH_R;
    const y0 = inArch ? ARCH_Y + Math.sqrt(ARCH_R * ARCH_R - x * x) : WIN_B + 0.02;
    kit.cyl(0.006, 0.006, WIN_T - y0, pal.brass, { pos: [x, (y0 + WIN_T) / 2, -0.012], seg: 5, parent: root });
  }
  for (const y of [WIN_T - 0.01, WIN_Y + 0.04]) kit.box(WIN_W, 0.012, 0.02, pal.brass, at(0, y, -0.012));   // top and middle rails
  // inside the booth: the teller's pigeonholes and a green banker's lamp, seen through the glass
  for (let c = 0; c < 6; c++) for (let r = 0; r < 2; r++) {
    const x = -0.4 + c * 0.16, y = 2.02 + r * 0.11;
    kit.box(0.15, 0.1, 0.06, walnut, at(x, y, -0.3));
    kit.box(0.1, 0.04, 0.004, (c + r) % 3 ? pal.white : pal.bone, at(x, y - 0.02, -0.268));
  }
  kit.cyl(0.035, 0.045, 0.02, pal.brass, { pos: [-0.33, WIN_B + 0.03, -0.18], seg: 8, parent: root });
  kit.cyl(0.006, 0.006, 0.14, pal.brass, { pos: [-0.33, WIN_B + 0.11, -0.18], seg: 4, parent: root });
  kit.cyl(0.04, 0.04, 0.2, kit.mat({ color: 0x2ab060, lit: false }), { pos: [-0.33, WIN_B + 0.19, -0.18], rot: [0, 0, 90], seg: 6, parent: root });

  // ── animated parts (listed in `keep`) ──
  // 512 × 384 texels (2× the old 256 × 192): the CRT is the readout, so its figures need the texels
  // Built on the screen itself (not `crtMonitor`) with the scanlines off: they dim every other texel row and thin the figures.
  const crtScreen = kit.screen({ w: SCR_W, h: SCR_H, px: CRT_PX, bezel: pal.black, glow: 0.95, scanlines: false });
  crtScreen.clear('#010602');
  crispTexture(crtScreen.tex, 4);                       // after the psx material (it forces nearest): linear + mips at native size
  crtScreen.mesh.position.set(0, SCR_Y, 0.03);
  // a chunky period terminal: a putty enamel housing behind the glass, a raised frame round it and a brass inner lip
  kit.box(SCR_W + 0.12, SCR_H + 0.12, 0.1, putty, { ...at(0, SCR_Y, -0.03), bevel: 0.012 });
  for (const sy of [-1, 1]) {
    kit.box(SCR_W + 0.12, 0.055, 0.07, putty, at(0, SCR_Y + sy * (SCR_H / 2 + 0.0275), 0.03));
    kit.box(SCR_W + 0.02, 0.012, 0.075, pal.brass, at(0, SCR_Y + sy * (SCR_H / 2 + 0.002), 0.03));
  }
  for (const sx of [-1, 1]) {
    kit.box(0.055, SCR_H + 0.12, 0.07, putty, at(sx * (SCR_W / 2 + 0.0275), SCR_Y, 0.03));
    kit.box(0.012, SCR_H + 0.02, 0.075, pal.brass, at(sx * (SCR_W / 2 + 0.002), SCR_Y, 0.03));
  }
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) kit.sphere(0.012, pal.gold, { ...at(sx * (SCR_W / 2 + 0.03), SCR_Y + sy * (SCR_H / 2 + 0.03), 0.07), wSeg: 5, hSeg: 3 });
  root.add(crtScreen.mesh);

  const quota = kit.ledPanel({ digits: 10, color: '#ff2a2a', h: 0.08 });
  quota.root.position.set(0, 1.9, 0.0);
  const deposit = kit.ledPanel({ digits: 10, color: '#ffb000', h: 0.07 });
  deposit.root.position.set(0, 1.22, 0.0);
  root.add(quota.root, deposit.root);

  // The caps carry colour only. Their words are DOM chips laid over them each frame (labels.ts: the world is drawn at 360 lines,
  // where a cap is about 30 x 8 pixels and no texture word read), and a gold frame marks the cursor cell.
  const specs: PanelButtonSpec[] = KEYS.map((id) => ({
    id,
    color: id === 'enter' ? pal.red : id === 'dep' ? pal.green : id === 'wd' ? pal.neonPink : id === 'quota' ? pal.gold : id === 'all' ? pal.brass : pal.cream,
    x: KEY_POS[id].x,
    z: KEY_POS[id].z,
    w: KEY_W,
    h: KEY_H,
  }));
  const keys = kit.buttonPanel({ buttons: specs, w: 0.72, d: 0.4, slope: 12, plate: 0x1a1a20, capH: KEY_CAP_H });
  keys.root.position.set(0, COUNTER_TOP, KEYPAD_Z);
  root.add(keys.root);
  const keyCursor = new THREE.Group();
  keyCursor.userData.kitKeep = true;
  const cw = KEY_W + 0.01, ch = KEY_H + 0.006, bar = 0.01, by = CAP_TOP + 0.004, bh = 0.008;
  kit.box(cw, bh, bar, pal.gold, { pos: [0, by, -(ch - bar) / 2], parent: keyCursor });
  kit.box(cw, bh, bar, pal.gold, { pos: [0, by, (ch - bar) / 2], parent: keyCursor });
  kit.box(bar, bh, ch, pal.gold, { pos: [-(cw - bar) / 2, by, 0], parent: keyCursor });
  kit.box(bar, bh, ch, pal.gold, { pos: [(cw - bar) / 2, by, 0], parent: keyCursor });
  keys.root.add(keyCursor);
  // chrome skirts under the tall caps: each key reads as a mechanical key standing in its own collar
  for (const id of KEYS) kit.box(KEY_W + 0.012, KEY_CAP_H * 0.45, KEY_H + 0.012, pal.chrome, { pos: [KEY_POS[id].x, 0.012 + KEY_CAP_H * 0.225, KEY_POS[id].z], parent: keys.root });

  // ── the teller's desk things: the cash drawer under the lip, the ledger on its stand and the rubber stamp (TellerPart) ──
  const drawer = new THREE.Group();
  drawer.position.set(0, 0.96, 0.41);
  kit.box(0.56, 0.085, 0.025, panel, { pos: [0, 0, 0.0125], parent: drawer, bevel: 0.004 });
  kit.box(0.16, 0.014, 0.014, pal.brass, { pos: [0, 0, 0.032], parent: drawer });
  kit.box(0.5, 0.06, 0.3, leather, { pos: [0, -0.005, -0.15], parent: drawer });           // the felt-lined till, hidden in the counter
  for (let i = 0; i < 4; i++) kit.cyl(0.022, 0.022, 0.02 + (i % 3) * 0.012, pal.gold, { pos: [-0.18 + i * 0.07, 0.03, -0.08], seg: 8, parent: drawer });
  for (const x of [0.12, 0.2]) kit.box(0.07, 0.012, 0.12, 0x5f8a4a, { pos: [x, 0.03, -0.12], parent: drawer });   // banknotes
  root.add(drawer);

  const LEDGER: [number, number, number] = [0.4, COUNTER_TOP + 0.045, -0.13];
  kit.box(0.2, 0.045, 0.14, walnut, at(LEDGER[0], COUNTER_TOP + 0.0225, LEDGER[2]));        // the stand
  const ruled = kit.tex.canvas(32, 48, (g, w, h) => {
    g.fillStyle = '#efe6cc'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#7d93b8'; for (let y = 6; y < h; y += 4) g.fillRect(2, y, w - 4, 1);
    g.fillStyle = '#c0504a'; g.fillRect(6, 0, 1, h);
  });
  const pageMat = kit.mat({ map: ruled, color: 0xffffff });
  kit.box(0.205, 0.008, 0.145, M.leather(pal.redDark, false), at(LEDGER[0], LEDGER[1] + 0.004, LEDGER[2]));
  for (const s of [-1, 1]) kit.box(0.094, 0.006, 0.132, pageMat, { pos: [LEDGER[0] + s * 0.049, LEDGER[1] + 0.011, LEDGER[2]], rot: [0, 0, -s * 4], parent: root });
  const imprint = kit.label({ text: { key: 'm.debt_terminal.paid_stamp' }, w: 0.085, h: 0.03, px: [64, 24], color: 0xc81e28, bg: null, font: 'px5' });
  imprint.mesh.rotation.set(-Math.PI / 2, 0, 0.18);
  imprint.mesh.position.set(LEDGER[0] - 0.048, LEDGER[1] + 0.019, LEDGER[2]);
  imprint.mesh.visible = false;
  root.add(imprint.mesh);

  // the stamp rests on its ink pad at the stand's right edge; a deposit lifts it over the left page and thumps it down
  kit.box(0.06, 0.012, 0.05, gunDark, at(0.47, COUNTER_TOP + 0.051, -0.02));               // ink pad
  const STAMP_REST: [number, number, number] = [0.47, COUNTER_TOP + 0.057, -0.02];
  const STAMP_HIT: [number, number, number] = [LEDGER[0] - 0.048, LEDGER[1] + 0.017, LEDGER[2]];
  const stamp = new THREE.Group();
  stamp.position.set(...STAMP_REST);
  kit.box(0.05, 0.012, 0.035, pal.redDark, { pos: [0, 0.006, 0], parent: stamp });          // rubber
  kit.box(0.054, 0.016, 0.039, pal.brass, { pos: [0, 0.02, 0], parent: stamp });
  kit.cyl(0.008, 0.008, 0.05, pal.brass, { pos: [0, 0.053, 0], seg: 5, parent: stamp });
  kit.sphere(0.022, pal.wood, { pos: [0, 0.088, 0], wSeg: 6, hSeg: 4, parent: stamp });
  root.add(stamp);

  const mix = (a: [number, number, number], b: [number, number, number], k: number, lift: number): void => {
    stamp.position.set(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k + lift, a[2] + (b[2] - a[2]) * k);
  };
  const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
  const teller: TellerPart = {
    drawer, stamp, imprint: imprint.mesh,
    pose(phase, k) {
      if (phase === 'out') {
        // the till slides out and the stamp lifts off its pad to hang over the left page
        drawer.position.z = 0.41 + 0.2 * k;
        mix(STAMP_REST, STAMP_HIT, k, 0.12 * Math.sin(k * Math.PI * 0.5));
        return;
      }
      // the thump (first fifth), the ink shows, then the stamp goes back to its pad and the till closes
      const slam = clamp01(k / 0.2), ret = clamp01((k - 0.45) / 0.4), shut = clamp01((k - 0.35) / 0.65);
      if (k < 0.45) mix(STAMP_HIT, STAMP_HIT, 0, 0.12 * (1 - slam * slam));
      else mix(STAMP_HIT, STAMP_REST, ret, 0.08 * Math.sin(ret * Math.PI));
      if (slam >= 1) { imprint.mesh.visible = true; imprint.mesh.scale.setScalar(1 + 0.25 * (1 - clamp01((k - 0.2) / 0.1))); }
      drawer.position.z = 0.61 - 0.2 * shut * shut;
    },
  };

  const mouthLips = new THREE.Object3D();
  mouthLips.position.set(0, 0.7, 0.46);
  for (const sy of [-1, 1]) {
    kit.box(0.26, 0.05, 0.05, pal.rust, { pos: [0, sy * 0.05, 0], parent: mouthLips });
  }
  root.add(mouthLips);

  const receiptPivot = new THREE.Object3D();
  receiptPivot.position.set(-0.38, COUNTER_TOP + 0.1, 0.0);
  const receipt = kit.screen({ w: 0.2, h: 0.26, px: [64, 80], bezel: pal.black });
  receipt.mesh.position.set(0, 0.13, 0.0);
  receiptPivot.add(receipt.mesh);
  root.add(receiptPivot);

  const swipe = kit.lamp({ r: 0.02, color: pal.green, shape: 'flat' });
  swipe.root.position.set(0.36, 0.665, 0.445);   // beside the card reader slot
  root.add(swipe.root);

  const readyLamp = kit.lamp({ r: 0.025, color: pal.neonYellow, shape: 'dome' });
  readyLamp.root.position.set(0.5, 1.82, 0.22);
  root.add(readyLamp.root);

  const emblemLid = new THREE.Object3D();
  emblemLid.position.set(0, 2.14, -0.2);
  const eye = kit.sphere(0.07, pal.gold, { parent: emblemLid, wSeg: 10, hSeg: 8 });
  eye.scale.set(1.6, 0.8, 0.6);
  const lidMesh = kit.torus(0.09, 0.012, pal.brass, { parent: emblemLid, arc: Math.PI });
  lidMesh.rotation.x = Math.PI / 2;
  root.add(emblemLid);

  const settleLever = kit.lever({ length: 0.3, knob: pal.red, side: 'right' });
  settleLever.root.position.set(0.5, 1.02, 0.12);
  const floorLever = kit.lever({ length: 0.3, knob: pal.green, side: 'left' });
  floorLever.root.position.set(-0.5, 1.02, 0.12);
  root.add(settleLever.root, floorLever.root);

  const bellRope = new THREE.Object3D();
  bellRope.position.set(0.52, 2.2, 0.26);
  const rope = kit.tube([[0, 0, 0], [0, -0.45, 0.02], [0, -0.9, 0.05]], 0.012, pal.bone, { seg: 6, radialSeg: 4 });
  const grip = kit.sphere(0.025, pal.red, { pos: [0, -0.9, 0.05], parent: bellRope });
  bellRope.add(rope, grip);
  root.add(bellRope);

  // a lit header on the canopy front: the alcove reads as the bank from across the lobby
  const header = kit.label({ text: { key: 'm.debt_terminal.crt_title' }, w: 0.84, h: 0.16, px: [420, 80], color: 0xffd070, bg: 0x120c08, font: 'px5' });
  header.mesh.position.set(0, H - 0.09, D / 2 + 0.006);
  root.add(header.mesh);

  // ── speaker, prompt and the pooled-light hint ──
  const speaker = new THREE.Object3D(); speaker.position.set(0, 1.4, 0.2); root.add(speaker);
  const prompt = new THREE.Object3D(); prompt.position.set(0, 2.2, 0.1); root.add(prompt);
  const collectorHand = new THREE.Object3D(); collectorHand.position.set(0, COUNTER_TOP, 0.42); root.add(collectorHand);
  const coinIn = new THREE.Object3D(); coinIn.position.set(0, 0.72, 0.55); root.add(coinIn);
  const light = new THREE.Object3D();
  light.position.set(0, 1.6, 0.3);
  light.userData = { color: 0xffb060, intensity: 0.7, range: 2.2, flicker: 'STEADY' };
  root.add(light);

  const parts: DebtParts = {
    crt: crtScreen, leds: { quota, deposit }, keys, keyCursor, receipt, receiptPivot, mouthLips, emblemLid,
    settleLever, floorLever, bellRope, swipe, readyLamp, teller,
  };
  kit.finalize(root, {
    keep: [header.mesh, crtScreen.mesh, quota.root, deposit.root, keys.root, receiptPivot, mouthLips, emblemLid,
      settleLever.root, floorLever.root, bellRope, swipe.root, readyLamp.root, light, drawer, stamp, imprint.mesh, pane],
  });

  return {
    root,
    parts,
    // seat framing: the CRT (y 1.38–1.74), the quota LED (1.9) and the keypad (1.07) all sit inside the view
    playPose: { pos: new THREE.Vector3(0, 1.5, 1.1), look: new THREE.Vector3(0, 1.42, 0.1), fov: 56, mouse: 'pick' },
    colliders: [
      { min: [-W / 2, 0, -D / 2], max: [W / 2, H, -D / 2 + 0.12] },   // alcove back
      { min: [-0.5, 0, -0.2], max: [0.5, COUNTER_TOP, 0.4] },          // counter
    ],
    interact: { min: [-W / 2, 0.3, -D / 2], max: [W / 2, H, D / 2 + 0.1] },
    anchors: { speaker, prompt, light, coinOut: coinIn, collectorHand, insideGlass: crtScreen.mesh },
    dispose: () => { crtScreen.dispose(); receipt.dispose(); },
  };
}
