/**
 * Grand casino dressing (WORLD-ARCH, wave 75): the Lobby atrium stage with its curtain, footlights and the Compere, the
 * jackpot LED wall behind the Big One dais, the prize showcase beside the cashier, the Well balcony rail, and the slow
 * light show. Built from kit primitives only. Animation is frame-driven (`update(dt)`), never a timer, so it follows the
 * sim clock. The game feeds the wall and the case through the props (`world.prop('jackpotWall')`, `world.prop('prizeCase')`).
 */
import * as THREE from 'three';
import type { KitX } from '@/kit';
import type { TexGen } from '@/core/texgen/types';
import type { Hex } from '@/core/types';
import type { BulbChain, MannequinActor, ScreenSurface } from '@/kit/types';
import { t, upper } from '@/core/i18n';
import type { JackpotWallProp, LightShowProp, PrizeCaseProp, StageProp, WorldLights } from '../types';
import type { LightHint } from '../sys/arch';
import { FLOOR_TILE_M } from '../layout';
import { presets } from '@/kit/presets';
import { Sched, easeInOutCubic, easeOutQuad } from './sched';
import { disposeTree } from './decor';
import { OUTFITS, wear } from '@/kit/mannequinOutfits';

// ── layout ──────────────────────────────────────────────────────────────────────────────────────
/** Atrium stage in the Lobby centre (the FLR-05 slot is kept but stays empty). Front faces north (-Z). */
export const STAGE = { x: -3.6, z: 9.0, w: 5.0, d: 3.2, h: 0.2 } as const;
/** Jackpot wall: hangs south of the Big One dais, faces the Well. */
export const JACKPOT_WALL = { x: 0, y: 6.3, z: 1.6, w: 6.4, h: 2.4, tilt: 15 } as const;   // high enough that the headline clears the Big One crown from the spawn (3 m out), tipped down at the Well floor
/** Prize showcase: against the south wall, east of the cashier. */
export const PRIZE_CASE = { x: 9.2, z: 19.5, w: 1.7, d: 0.6, h: 2.0 } as const;

const hex = (c: Hex): string => `#${c.toString(16).padStart(6, '0')}`;
const up = upper;

/** Largest px5 scale (<= start) at which `text` fits in `maxW` pixels. */
function fitScale(kit: KitX, text: string, maxW: number, start: number): number {
  for (let s = start; s > 1; s--) if (kit.tex.measure(text, { font: 'px5', scale: s }) <= maxW) return s;
  return 1;
}

// ── stage ───────────────────────────────────────────────────────────────────────────────────────
export interface StageBuild {
  prop: StageProp & { footlights: BulbChain };
  hints: LightHint[];
  statics: Array<{ box: THREE.Box3; tag: 'solid' | 'walkable' }>;
  anchors: Record<string, THREE.Object3D>;
}

export function buildStage(kit: KitX, tex: TexGen, o: { root: THREE.Group; statical: THREE.Group }): StageBuild {
  const { x, z, w, d, h } = STAGE;
  const root = kit.group('stage');
  const sched = new Sched();
  const box3 = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) =>
    new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1));

  // platform, brass nosing, dark front fascia (merged into the static shell)
  const boards = tex.vendor('sbs-tiny2/128x128/Wood/Wood_03-128x128.png', { size: 64 });
  boards.userData.tile = FLOOR_TILE_M;   // same texel density as the zone floors
  const wood = kit.mat({ color: 0x946240, map: boards });
  kit.box(w, h, d, wood, { pos: [x, h / 2, z], parent: o.statical });
  kit.box(w + 0.08, 0.03, 0.08, kit.pal.brass, { pos: [x, h, z - d / 2], parent: o.statical });
  kit.box(w, 0.02, 0.02, kit.pal.brass, { pos: [x, 0.02, z - d / 2 - 0.02], parent: o.statical });
  // wave 87 (ART.md §2 Stage): a panelled walnut fascia, velvet proscenium columns with brass caps, a fringe under the valance
  const M = presets(kit.tex);
  const velvetHi = M.velvet(0x8a1426), velvetLo = M.velvet(0x560c1a), walnut = M.wood('dark'), gilt = M.gold();
  kit.box(w + 0.02, h - 0.03, 0.03, walnut, { pos: [x, (h - 0.03) / 2 + 0.005, z - d / 2 - 0.016], parent: o.statical });
  for (let i = 0; i < 5; i++) kit.box(0.8, h - 0.09, 0.02, M.wood('mahogany'), { pos: [x - w / 2 + 0.5 + i * ((w - 1) / 4), h / 2, z - d / 2 - 0.04], parent: o.statical });
  for (const sx of [-1, 1]) {
    const cx = x + sx * (w / 2 + 0.12), cz = z + d / 2 - 0.12;
    kit.box(0.24, 3.42, 0.3, velvetHi, { pos: [cx, 1.71, cz], parent: o.statical });
    kit.box(0.32, 0.12, 0.38, gilt, { pos: [cx, 3.45, cz], parent: o.statical });
    kit.box(0.32, 0.22, 0.38, walnut, { pos: [cx, 0.11, cz], parent: o.statical });
  }

  // footlights along the front edge
  const foot = kit.bulbChain({ path: [[x - w / 2 + 0.2, h + 0.1, z - d / 2 + 0.12], [x + w / 2 - 0.2, h + 0.1, z - d / 2 + 0.12]], count: 14, colors: [0xffd890], r: 0.05 });
  foot.pattern('all');
  root.add(foot.root);

  // back curtain: two halves of velvet folds that gather towards the sides
  const zc = z + d / 2 - 0.12;
  const backdrop = kit.group('backdrop');
  kit.box(w, 3.1, 0.05, M.velvet(0x301018), { pos: [x, h + 1.55, zc + 0.1], parent: backdrop });
  for (let i = 0; i < 7; i++) {
    kit.box(0.05, 2.3, 0.02, gilt, { pos: [x, h + 1.7, zc + 0.065], rot: [0, 0, -63 + i * 21], parent: backdrop });
  }
  root.add(backdrop);
  const halves: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const half = kit.group(side < 0 ? 'curtainW' : 'curtainE');
    half.position.set(x + side * (w / 2), 0, zc);
    const folds = 10, fw = w / 2 / folds;
    for (let i = 0; i < folds; i++) {
      kit.box(fw + 0.01, 3.0, 0.1, i % 2 ? velvetHi : velvetLo, { pos: [-side * (i + 0.5) * fw, h + 1.5, (i % 2) * 0.06], parent: half });
    }
    root.add(half);
    halves.push(half);
  }
  kit.box(w + 0.3, 0.45, 0.24, velvetHi, { pos: [x, h + 3.2, zc], parent: o.statical });
  for (let i = 0; i < 26; i++) kit.box(0.06, 0.09, 0.02, gilt, { pos: [x - (w + 0.2) / 2 + (i + 0.5) * ((w + 0.2) / 26), h + 2.93, zc - 0.15], parent: o.statical });   // fringe
  kit.box(w + 0.34, 0.05, 0.28, kit.pal.brass, { pos: [x, h + 2.96, zc], parent: o.statical });
  let curtainOpen = 0.4, curtainTarget = 0.4;
  const applyCurtain = (): void => { for (const half of halves) half.scale.x = 1 - 0.78 * curtainOpen; };
  applyCurtain();

  // front corner posts with a small globe each
  for (const sx of [-1, 1]) {
    kit.cyl(0.05, 0.07, 1.2, kit.pal.brass, { pos: [x + sx * (w / 2 - 0.12), h + 0.6, z - d / 2 + 0.12], seg: 6, parent: o.statical });
    const globe = kit.lamp({ r: 0.1, color: 0xffe2a0, shape: 'bulb' });
    globe.root.position.set(x + sx * (w / 2 - 0.12), h + 1.22, z - d / 2 + 0.12);
    globe.setOn(true);
    root.add(globe.root);
  }

  // microphone stand
  const mic = kit.group('mic');
  mic.position.set(x, h, z - 0.55);
  kit.cyl(0.14, 0.16, 0.04, kit.pal.chrome, { pos: [0, 0.02, 0], seg: 8, parent: mic });
  kit.cyl(0.012, 0.012, 1.3, kit.pal.chrome, { pos: [0, 0.69, 0], seg: 5, parent: mic });
  kit.box(0.05, 0.13, 0.05, kit.pal.black, { pos: [0, 1.4, 0.02], rot: [-25, 0, 0], parent: mic });
  root.add(mic);

  // the Compere: dark mannequin with a cold cyan rim, facing the room (north), in his tuxedo, top hat and hand mic (docs/ART.md)
  const compere: MannequinActor = kit.mannequin({ color: 0x4a5a70, jointColor: 0x6a7a90, style: 'plain', height: 1.85, clip: 'Idle_Loop', rim: 0x9ff0f8 });
  wear(compere, OUTFITS.compere, (id, c) => kit.prop(id, { color: c }));
  compere.root.position.set(x, h, z - 0.05);
  compere.root.rotation.y = Math.PI;
  o.root.add(compere.root);

  const statics: StageBuild['statics'] = [
    { box: box3(x - w / 2, -0.5, z - d / 2, x + w / 2, h, z + d / 2), tag: 'walkable' },
    { box: box3(x - w / 2, 0, zc - 0.1, x + w / 2, 3.4, zc + 0.15), tag: 'solid' },
    ...[-1, 1].map((sx) => ({ box: box3(x + sx * (w / 2 + 0.12) - 0.12, 0, z + d / 2 - 0.27, x + sx * (w / 2 + 0.12) + 0.12, 3.5, z + d / 2 + 0.03), tag: 'solid' as const })),
  ];
  const mark = (px: number, py: number, pz: number): THREE.Object3D => { const m = new THREE.Object3D(); m.position.set(px, py, pz); o.root.add(m); return m; };
  // stand-off spots on the floor in front of the stage (the viewer looks north): never inside the Compere's footprint
  const anchors = {
    'stage.center': mark(x, 1.3, z - d / 2 - 2.8),
    'stage.view': mark(x, 1.3, z - d / 2 - 4.4),
    'stage.compere': mark(x, h + 1.6, z - 0.05),
  };

  const hints: LightHint[] = [
    { id: 'stage:foot', pos: [x, 0.9, z - d / 2 + 0.3], color: 0xffd890, intensity: 0.9, range: 5, flicker: 'STEADY', zone: 'lobby' },
    { id: 'stage:spot', pos: [x, 3.1, z - 1.5], color: 0xcfe8ff, intensity: 2.4, range: 5, flicker: 'STEADY', zone: 'lobby' },   // spot on the Compere, set in front of him so his face and chest read
  ];

  const prop: StageProp & { footlights: BulbChain } = {
    id: 'stage',
    root,
    footlights: foot,
    compere,
    get curtainOpen() { return curtainTarget > 0.5; },
    setCurtain(open: boolean, dur = 2): Promise<void> {
      curtainTarget = open ? 1 : 0;
      const from = curtainOpen;
      return sched.run(dur, (k) => { curtainOpen = from + (curtainTarget - from) * k; applyCurtain(); }, easeInOutCubic);
    },
    speak(on: boolean): void { void compere.play(on ? 'Idle_Talking_Loop' : 'Idle_Loop'); },
    update(dt: number): void { sched.update(dt); },
    dispose(): void { sched.clear(); compere.dispose(); disposeTree(root); },
  };
  return { prop, hints, statics, anchors };
}

// ── jackpot LED wall ────────────────────────────────────────────────────────────────────────────
const LINE_COLORS = ['#ffe45a', '#ffa860', '#9ff4ff', '#fff6dc'];

export function buildJackpotWall(kit: KitX, o: { ceiling: number }): JackpotWallProp & { border: BulbChain } {
  const { x, y, z, w, h, tilt } = JACKPOT_WALL;
  const root = kit.group('jackpotWall');
  root.position.set(x, y, z);
  root.rotation.y = Math.PI;   // the screen faces -Z, towards the dais and the spawn
  const sched = new Sched();
  // the panel hangs on a pivot tipped a few degrees down, so the face looks at the people on the Well floor
  const panel = kit.group('jackpotPanel');
  panel.rotation.x = THREE.MathUtils.degToRad(tilt);
  root.add(panel);
  const px: [number, number] = [256, 96];   // coarse on purpose: each lit texel stays a few screen pixels at 8 m
  const screen: ScreenSurface = kit.screen({ w, h, px, bezel: 0x3a2a14, glow: 1.25, scanlines: false });
  screen.mesh.position.z = 0.08;
  panel.add(screen.mesh);
  // the back faces the Lobby: boards, not a flat slab (a flat colour read as a hole in the room)
  kit.box(w + 0.5, h + 0.5, 0.14, kit.mat({ color: 0xb09070, map: kit.tex.wood(kit.pal.woodDark) }), { pos: [0, 0, 0], parent: panel });
  kit.box(w + 0.58, 0.06, 0.2, kit.pal.brass, { pos: [0, h / 2 + 0.28, 0], parent: panel });
  kit.box(w + 0.58, 0.06, 0.2, kit.pal.brass, { pos: [0, -h / 2 - 0.28, 0], parent: panel });
  // wave 87: a gilt frame outside the bulb ring, corner rosettes and a walnut pediment with a gilt fan
  const JM = presets(kit.tex), jg = JM.gold(), jw = JM.wood('dark');
  for (const sy of [-1, 1]) kit.box(w + 0.58, 0.08, 0.08, jg, { pos: [0, sy * (h / 2 + 0.25), 0.09], parent: panel });
  for (const sx of [-1, 1]) kit.box(0.08, h + 0.42, 0.08, jg, { pos: [sx * (w / 2 + 0.25), 0, 0.09], parent: panel });
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) kit.cyl(0.07, 0.07, 0.04, jg, { pos: [sx * (w / 2 + 0.25), sy * (h / 2 + 0.25), 0.14], rot: [90, 0, 0], seg: 8, parent: panel });
  kit.box(w * 0.5, 0.36, 0.12, jw, { pos: [0, h / 2 + 0.49, 0], parent: panel });
  for (let i = 0; i <= 6; i++) kit.box(0.04, 0.3, 0.02, jg, { pos: [Math.sin((i / 6 - 0.5) * 2.2) * 0.14, h / 2 + 0.36 + Math.cos((i / 6 - 0.5) * 2.2) * 0.14, 0.07], rot: [0, 0, -((i / 6 - 0.5) * 2.2 * 180) / Math.PI], parent: panel });
  for (const sx of [-1, 1]) kit.tube([[sx * (w / 2 - 0.4), h / 2 + 0.3, 0], [sx * (w / 2 - 0.4), o.ceiling - y, 0]], 0.02, kit.pal.brass, { seg: 6, radialSeg: 3, parent: root });
  const border = kit.bulbChain({ path: { rect: [w + 0.3, h + 0.3] }, count: 44, colors: [0xffd34a, 0xff5a7a], r: 0.05 });
  border.root.position.z = 0.12;
  border.pattern('alt', 1.2);
  panel.add(border.root);

  let lines: string[] = [];
  let flashK = 0;
  const paint = (): void => {
    screen.draw((g, s) => {
      g.fillStyle = '#0a0608';
      g.fillRect(0, 0, s.w, s.h);
      if (flashK > 0) { g.fillStyle = `rgba(255,211,74,${(flashK * 0.55).toFixed(3)})`; g.fillRect(0, 0, s.w, s.h); }
      const dark = flashK > 0.5;
      const head = up(t('prop.jackpot.idle'));
      const drawLine = (str: string, x: number, y: number, sc: number, col: string, align: 'left' | 'right' | 'center'): void => {
        kit.tex.drawText(g, str, x + 1, y + 1, { font: 'px5', color: '#000000', align, scale: sc });
        kit.tex.drawText(g, str, x, y, { font: 'px5', color: col, align, scale: sc });
      };
      // y is the cap top: leave room above for the Turkish accents. The headline is always the Big One; wins sit under a small header,
      // name on the left and the coins on the right, so a small win never reads as part of the name.
      let yy = 8;
      const hs = fitScale(kit, head, s.w - 12, 3);
      drawLine(head, s.w / 2, yy, hs, dark ? '#2a1204' : LINE_COLORS[0], 'center');
      yy += hs * 7 + 6;
      const wins = lines.slice(0, 2);
      if (wins.length === 0) {
        const sub = up(t('prop.jackpot.sub'));
        drawLine(sub, s.w / 2, yy, fitScale(kit, sub, s.w - 12, 2), LINE_COLORS[1], 'center');
      } else {
        const title = up(t('prop.jackpot.wins'));
        drawLine(title, s.w / 2, yy, fitScale(kit, title, s.w - 12, 2), LINE_COLORS[2], 'center');
        yy += 14 + 6;
        wins.forEach((ln) => {
          const m = /^(.*\S)\s{2,}(\S+)$/.exec(ln);
          const name = up(m ? m[1] : ln), amt = m ? m[2] : '';
          const as = 2;
          const room = s.w - 16 - (amt ? kit.tex.measure(amt, { font: 'px5', scale: as }) + 14 : 0);
          drawLine(name, 8, yy, fitScale(kit, name, room, 2), LINE_COLORS[3], 'left');
          if (amt) drawLine(amt, s.w - 8, yy, as, LINE_COLORS[0], 'right');
          yy += 14 + 5;
        });
      }
    });
  };
  paint();

  return {
    id: 'jackpotWall',
    root,
    border,
    setLines(next: string[]): void { lines = next.filter((l) => l.length > 0); paint(); },
    flash(): Promise<void> {
      border.pattern('chase', 6);
      return sched.run(1.8, (k) => { flashK = 1 - k; paint(); }, easeOutQuad).then(() => { flashK = 0; border.pattern('alt', 1.2); paint(); });
    },
    update(dt: number): void { sched.update(dt); },
    dispose(): void { sched.clear(); screen.dispose(); disposeTree(root); },
  };
}

// ── prize showcase ──────────────────────────────────────────────────────────────────────────────
const SLOT_COUNT = 5;
const GEM_COLORS: Hex[] = [0xffd34a, 0x6fd8e0, 0xff6aa8, 0xff5a4a, 0x9affb0];

export function buildPrizeCase(kit: KitX, o: { statical: THREE.Group }): { prop: PrizeCaseProp; solid: { w: number; d: number; h: number } } {
  const { x, z, w, d, h } = PRIZE_CASE;
  const root = kit.group('prizeCase');
  root.position.set(x, 0, z);
  root.rotation.y = Math.PI;   // the glass front faces north (-Z)
  // the cabinet body and frame are static; the glass, lit items and placards are live
  const sp = kit.group('prizeCaseStatic');
  sp.position.copy(root.position);
  sp.rotation.y = Math.PI;
  o.statical.add(sp);
  const wood = presets(kit.tex).wood('dark');
  kit.box(w, 0.55, d, wood, { pos: [0, 0.275, 0], parent: sp });
  kit.box(w + 0.06, 0.04, d + 0.06, kit.pal.brass, { pos: [0, 0.57, 0], parent: sp });
  kit.box(w + 0.06, 0.1, d + 0.06, kit.pal.brass, { pos: [0, h, 0], parent: sp });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) kit.box(0.05, h - 0.55, 0.05, kit.pal.brass, { pos: [sx * (w / 2), 0.55 + (h - 0.55) / 2, sz * (d / 2)], parent: sp });
  kit.box(w, h - 0.6, 0.03, presets(kit.tex).velvet(0x3a0c16), { pos: [0, 0.6 + (h - 0.6) / 2, -d / 2 + 0.02], parent: sp });   // velvet back panel
  kit.box(w - 0.06, 0.04, d - 0.1, kit.pal.brass, { pos: [0, 1.15, 0.0], parent: sp });                    // shelf

  const glass = kit.glass({ w: w - 0.08, h: h - 0.65, d: 0.02, tint: 0xa8d8e0, opacity: 0.18 });
  glass.position.set(0, 0.6 + (h - 0.65) / 2, d / 2 - 0.02);
  root.add(glass);

  const strip = kit.lightStrip({ length: w - 0.2, color: 0xffe9b0, thickness: 0.05, segments: 8, axis: 'x' });
  strip.root.position.set(0, h - 0.12, d / 2 - 0.14);
  strip.pattern('all');
  root.add(strip.root);

  const slotX = (i: number): number => (i - (SLOT_COUNT - 1) / 2) * ((w - 0.2) / SLOT_COUNT);
  const items: THREE.Group[] = [];
  const spots: Array<{ setOn(on: boolean): void }> = [];
  for (let i = 0; i < SLOT_COUNT; i++) {
    const item = kit.group(`prize${i}`);
    item.position.set(slotX(i), 1.2, 0);
    kit.cyl(0.035, 0.08, 0.16, GEM_COLORS[i], { pos: [0, 0.1, 0], seg: 6, parent: item });
    kit.cyl(0.07, 0.035, 0.05, GEM_COLORS[i], { pos: [0, 0.2, 0], seg: 6, parent: item });
    item.visible = false;
    root.add(item);
    items.push(item);
    const spot = kit.lamp({ r: 0.05, color: 0xfff0c0, shape: 'flat' });
    spot.root.position.set(slotX(i), 1.18, 0.0);
    root.add(spot.root);
    spots.push(spot);
  }

  const placard: ScreenSurface = kit.screen({ w: w - 0.1, h: 0.4, px: [320, 70], bezel: 0x3a2a14, glow: 0.8, scanlines: false });
  placard.mesh.position.set(0, 0.3, d / 2 + 0.012);   // top edge 0.50, clear of the brass trim at 0.55
  root.add(placard.mesh);

  let labels: string[] = [];
  const paint = (): void => {
    placard.draw((g, s) => {
      g.fillStyle = '#0d0906';
      g.fillRect(0, 0, s.w, s.h);
      const cw = s.w / SLOT_COUNT;
      kit.tex.drawText(g, up(t('prop.prizes.title')), s.w / 2, 3, { font: 'px5', color: '#ffd34a', align: 'center' });
      for (let i = 0; i < SLOT_COUNT; i++) {
        const lab = labels[i];
        if (!lab) continue;
        // up to two lines of about 9 characters each, split on the last space that fits
        const text = up(lab);
        const words = text.split(' ');
        const rows: string[] = [''];
        for (const wd of words) {
          const cur = rows[rows.length - 1];
          if ((cur + ' ' + wd).trim().length <= 9 || rows.length >= 2) rows[rows.length - 1] = (cur + ' ' + wd).trim();
          else rows.push(wd);
        }
        rows.slice(0, 2).forEach((r, ri) => kit.tex.drawText(g, r.slice(0, 10), cw * (i + 0.5), 24 + ri * 16, { font: 'px5', color: hex(GEM_COLORS[i]), align: 'center', scale: 2 }));
      }
    });
  };
  const setPrizes = (next: string[]): void => {
    labels = next.slice(0, SLOT_COUNT).map((l) => l.trim());
    for (let i = 0; i < SLOT_COUNT; i++) {
      const on = !!labels[i];
      items[i].visible = on;
      spots[i].setOn(on);
    }
    paint();
  };
  setPrizes([]);

  let spin = 0;
  return {
    solid: { w, d, h },
    prop: {
      id: 'prizeCase',
      root,
      get count() { return labels.filter((l) => l.length > 0).length; },
      setPrizes,
      update(dt: number): void {
        spin += dt;
        for (let i = 0; i < SLOT_COUNT; i++) if (items[i].visible) items[i].rotation.y = spin * 0.7 + i;
      },
      dispose(): void { placard.dispose(); disposeTree(root); disposeTree(sp); },
    },
  };
}

// ── Well balcony ────────────────────────────────────────────────────────────────────────────────
/** A projecting ledge with a balustrade high on both Well side walls, and dark box-seat windows above it. All static. */
export function buildBalcony(kit: KitX, statical: THREE.Group): void {
  const Y = 6.4, z0 = -17.4, z1 = 1.4, len = z1 - z0, zc = (z0 + z1) / 2;
  const velvet = presets(kit.tex).velvet(0x5a0c1a), ledge = presets(kit.tex).wood('dark');
  for (const side of [-1, 1]) {
    const wallX = side * 10.85;
    const inX = wallX - side * 0.28;
    kit.box(0.56, 0.14, len, ledge, { pos: [inX, Y, zc], parent: statical });
    kit.box(0.62, 0.04, len, kit.pal.brass, { pos: [inX - side * 0.01, Y + 0.09, zc], parent: statical });
    const railX = wallX - side * 0.5;
    kit.box(0.09, 0.07, len, kit.pal.brass, { pos: [railX, Y + 1.0, zc], parent: statical });
    for (let zz = z0 + 0.3; zz <= z1; zz += 0.9) kit.cyl(0.025, 0.025, 0.92, kit.pal.brass, { pos: [railX, Y + 0.55, zz], seg: 5, parent: statical });
    // box seats: a framed dark window and a velvet swag above the rail
    for (const zz of [-15.6, -12.6, -9.6, -6.6, -3.6, -0.6]) {
      // each piece starts 1, 2 and 3 cm off the wall face (their backs used to share the wall plane)
      kit.box(0.08, 1.5, 1.9, kit.pal.brass, { pos: [wallX - side * 0.05, Y + 2.0, zz], parent: statical });
      kit.box(0.1, 1.36, 1.76, 0x0c0608, { pos: [wallX - side * 0.07, Y + 2.0, zz], parent: statical });
      kit.box(0.14, 0.3, 2.1, velvet, { pos: [wallX - side * 0.1, Y + 2.8, zz], parent: statical });
    }
  }
}

// ── light show ──────────────────────────────────────────────────────────────────────────────────
type Pat = 'chase' | 'alt' | 'blink' | 'rainbow' | 'all' | 'off';
export interface ShowTarget { pattern(p: Pat, hz?: number): void }
const SHOW_COLORS: Hex[] = [0xffb347, 0xff6aa8, 0x6fd8e0, 0xffd34a];
const SHOW_STEPS: Array<[Pat, number]> = [['chase', 3], ['rainbow', 2], ['alt', 1.5], ['chase', 5]];

export function createLightShow(o: { targets: ShowTarget[]; lights?: WorldLights; wall?: { flash(): Promise<void> } }): LightShowProp {
  let left = 0, elapsed = 0, step = -1;
  const rest = (): void => { for (const tg of o.targets) tg.pattern('all'); };
  const stepLen = 3;
  return {
    id: 'lightShow',
    root: new THREE.Group(),
    get active() { return left > 0; },
    lightShow(dur = 13): void {
      if (dur <= 0) return;
      left = dur; elapsed = 0; step = -1;
      void o.wall?.flash();
    },
    update(dt: number): void {
      if (left <= 0) return;
      left -= dt; elapsed += dt;
      if (left <= 0) { left = 0; rest(); return; }
      const s = Math.floor(elapsed / stepLen);
      if (s === step) return;
      step = s;
      const [pat, hz] = SHOW_STEPS[s % SHOW_STEPS.length];
      for (const tg of o.targets) tg.pattern(pat, hz);
      const color = SHOW_COLORS[s % SHOW_COLORS.length];
      o.lights?.pulse('well', { color, mul: 1.25, dur: 2.4 });
      o.lights?.pulse('lobby', { color, mul: 1.25, dur: 2.4 });
    },
    dispose(): void { left = 0; },
  };
}
