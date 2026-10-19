/**
 * SON OYUN, the House's own machine (wave 106): a tall one-armed bandit of dark wood and brass in the Lobby's north end, its front turned
 * to the central aisle (layout.ts LAST_GAME_POS). A gilt crown with a crescent, the neon "SON OYUN", a three-reel window, a side lever,
 * corner pillars and a velvet rope. CLOSED until the run opens it (`lastGameOpen()`): the neon is dead, the window shaded, the rope up
 * with a KAPALI plate. When it opens the neon lights, the bulbs chase, the reels spin up to 7 7 7 and a light pulses.
 *
 * `E` opens the panel (game/lastGame.ui.ts) when open, and says why not when closed. The panel drives the pull through the prop:
 * `spin()` (lever, reels run) then `land(win)` (the reels stop one by one on 7 7 7, or on a near miss). Frame-driven (`update(dt)`).
 * Registered as prop `lastGame` and anchor `lastGame` (the waymark's spot).
 */
import * as THREE from 'three';
import type { KitX } from '@/kit';
import type { LeverPart, ReelPart } from '@/kit/types';
import type { InteractionSystem, WorldProp } from '../types';
import type { LightHint } from '../sys/arch';
import type { LastGameApi } from '@/game/lastGame';
import type { SfxName } from '@/core/audio/types';
import { openLastGamePanel } from '@/game/lastGame.ui';
import { app } from '@/core/app';
import { t } from '@/core/i18n';
import { presets } from '@/kit/presets';
import { LAST_GAME_POS } from '../layout';
import { crispLabel, crispNeon } from './signs';

/** The drum faces; index 0 is the 7 the win lands on. */
const SYMS = ['seven', 'crown', 'diamond', 'bell', 'star', 'cherry', 'horseshoe', 'moon'];
const REEL_X = [-0.31, 0, 0.31];
const REEL_Y = 1.55;
/** Seconds the cabinet stays lit around a pull (`lastGameOpen()` is false while a result waits to be shown). */
const PULL_HOLD_S = 8;
const GOLD = 0xffd070;

export interface LastGameProp extends WorldProp {
  /** Lit and playable (the run says so, or a pull is being shown). */
  readonly open: boolean;
  /** The pull: the lever drops and the three drums run. */
  spin(): void;
  /** The drums stop one by one: 7 7 7 on a win, a near miss on a loss. */
  land(win: boolean): void;
}

export interface LastGameBuild {
  prop: LastGameProp;
  anchor: THREE.Object3D;
  hints: LightHint[];
  statics: Array<{ box: THREE.Box3; tag: 'solid' }>;
}

const runApi = (): Partial<LastGameApi> | null => app.run as unknown as Partial<LastGameApi> | null;
const isOpen = (): boolean => { try { return !!runApi()?.lastGameOpen?.(); } catch { return false; } };

export function buildLastGame(kit: KitX, o: { interact?: InteractionSystem }): LastGameBuild {
  const { x: X, z: Z, rotY } = LAST_GAME_POS;
  const root = kit.group('lastGame');
  root.position.set(X, 0, Z);
  root.rotation.y = (rotY * Math.PI) / 180;
  const M = presets(kit.tex);
  const wood = M.wood('dark'), mahogany = M.wood('mahogany'), brass = M.brass(), gold = M.gold(), velvet = M.velvet(0x6a0f1e);
  const ink = kit.pal.black;
  const shell = kit.group('lastGameShell');   // everything that never moves: merged into a few draws at the end
  root.add(shell);

  // ── plinth and body: walnut with a brass kick, a gold medallion on the belly, a payout tray ──
  kit.box(1.2, 0.12, 0.9, wood, { pos: [0, 0.06, 0], parent: shell, bevel: 0.01 });
  kit.box(1.22, 0.03, 0.92, brass, { pos: [0, 0.015, 0], parent: shell });
  kit.box(1.0, 0.91, 0.74, mahogany, { pos: [0, 0.575, 0], parent: shell, bevel: 0.015 });
  for (const sx of [-1, 1]) kit.box(0.04, 0.7, 0.02, brass, { pos: [sx * 0.34, 0.58, 0.375], parent: shell });
  kit.cyl(0.15, 0.15, 0.02, gold, { pos: [0, 0.68, 0.38], rot: [90, 0, 0], seg: 12, parent: shell });
  kit.cyl(0.06, 0.06, 0.03, kit.pal.red, { pos: [0, 0.68, 0.39], rot: [90, 0, 0], seg: 8, parent: shell });
  kit.box(0.5, 0.2, 0.06, ink, { pos: [0, 0.3, 0.38], parent: shell });          // the payout mouth
  kit.box(0.54, 0.03, 0.2, brass, { pos: [0, 0.2, 0.44], parent: shell });       // its tray
  // the deck: a brass ledge with three lit buttons
  kit.box(1.1, 0.07, 0.86, brass, { pos: [0, 1.065, 0.04], parent: shell, bevel: 0.01 });
  const buttons = [0xd02030, 0xffc030, 0x30c060].map((c, i) => {
    const l = kit.lamp({ r: 0.04, color: c, shape: 'dome' });
    l.root.position.set((i - 1) * 0.16, 1.1, 0.33);
    root.add(l.root);
    return l;
  });

  // ── the head: a cavity open at the front for the drums, walls and back around it ──
  kit.box(1.04, 0.9, 0.26, wood, { pos: [0, 1.55, -0.23], parent: shell, bevel: 0.01 });      // back wall
  kit.box(1.04, 0.2, 0.46, wood, { pos: [0, 1.2, 0.13], parent: shell });                    // under the window
  kit.box(1.04, 0.2, 0.46, wood, { pos: [0, 1.9, 0.13], parent: shell });                    // over the window
  for (const sx of [-1, 1]) kit.box(0.06, 0.9, 0.46, wood, { pos: [sx * 0.49, 1.55, 0.13], parent: shell });
  kit.box(0.96, 0.02, 0.02, brass, { pos: [0, 1.3, 0.37], parent: shell });                  // window frame
  kit.box(0.96, 0.02, 0.02, brass, { pos: [0, 1.8, 0.37], parent: shell });
  for (const sx of [-1, 1]) kit.box(0.02, 0.5, 0.02, brass, { pos: [sx * 0.47, 1.55, 0.37], parent: shell });
  kit.box(0.9, 0.012, 0.01, kit.pal.red, { pos: [0, REEL_Y, 0.35], parent: shell });          // the payline
  const reels: ReelPart[] = REEL_X.map((x) => {
    const r = kit.reel({ radius: 0.22, width: 0.27, symbols: SYMS, cell: 32 });
    r.root.position.set(x, REEL_Y, 0.12);
    r.setIndex(0);
    root.add(r.root);
    return r;
  });
  const footLamps = [-0.3, 0, 0.3].map((x) => {
    const l = kit.lamp({ r: 0.045, color: 0xfff0c0, shape: 'flat' });
    l.root.position.set(x, 1.3, 0.3);
    root.add(l.root);
    return l;
  });
  // the dust cover over the window while closed
  const shadeMat = kit.mat({ color: 0x000000, lit: false, transparent: true, opacity: 0.72, affine: false, snap: false, unique: true }) as THREE.MeshBasicMaterial;
  const shade = new THREE.Mesh(new THREE.PlaneGeometry(0.94, 0.52), shadeMat);
  shade.position.set(0, REEL_Y, 0.375);
  shade.renderOrder = 1;
  shade.userData.noMerge = true;
  root.add(shade);

  // ── corner pillars, cornice and the crown ──
  for (const sx of [-1, 1]) {
    kit.cyl(0.045, 0.05, 1.9, brass, { pos: [sx * 0.53, 1.07, 0.36], seg: 8, parent: shell });
    kit.sphere(0.06, gold, { pos: [sx * 0.53, 2.04, 0.36], wSeg: 8, hSeg: 5, parent: shell });
    kit.box(0.1, 1.9, 0.1, wood, { pos: [sx * 0.52, 1.07, -0.34], parent: shell });
  }
  kit.box(1.18, 0.1, 0.84, gold, { pos: [0, 2.05, 0.02], parent: shell, bevel: 0.01 });      // the cornice
  kit.box(1.0, 0.44, 0.5, velvet, { pos: [0, 2.32, 0], parent: shell });                      // the sign board
  kit.box(1.04, 0.04, 0.54, brass, { pos: [0, 2.56, 0], parent: shell });
  kit.sphere(0.5, gold, { pos: [0, 2.58, 0], hemi: true, wSeg: 12, hSeg: 5, scale: [1, 0.5, 0.75], parent: shell });
  kit.torus(0.09, 0.025, gold, { pos: [0, 2.96, 0], rot: [0, 0, 45], seg: 8, tubeSeg: 5, arc: Math.PI * 1.6, parent: shell });   // the crescent
  kit.sphere(0.04, gold, { pos: [0.05, 2.96, 0], wSeg: 6, hSeg: 4, parent: shell });                                              // and its star
  const neon = crispNeon(kit, { text: { key: 'lastGame.sign' }, h: 0.2, color: GOLD, flicker: 0.1, font: 'chetyre' });
  neon.root.position.set(0, 2.32, 0.27);
  root.add(neon.root);
  neon.setOn(false);
  const bulbs = kit.bulbChain({ path: { rect: [1.0, 0.46] }, count: 22, colors: [0xffe090, 0xff8a4a], r: 0.02 });
  bulbs.root.position.set(0, 2.32, 0.27);
  root.add(bulbs.root);
  const glow = kit.glow({ color: GOLD, size: 2.2, intensity: 0.7 });
  glow.position.set(0, 2.2, 0.7);
  glow.visible = false;
  root.add(glow);

  // ── the lever on the right flank ──
  const lever: LeverPart = kit.lever({ length: 0.5, knob: kit.pal.red, side: 'right' });
  lever.root.position.set(0.5, 1.35, 0.05);
  root.add(lever.root);

  // ── the rope and the CLOSED plate (up until it opens) ──
  const rope = kit.group('lastGameRope');
  const RZ = 0.98;
  for (const sx of [-1, 1]) {
    kit.cyl(0.14, 0.16, 0.04, brass, { pos: [sx * 0.62, 0.02, RZ], seg: 8, parent: rope });
    kit.cyl(0.025, 0.025, 0.9, brass, { pos: [sx * 0.62, 0.47, RZ], seg: 6, parent: rope });
    kit.sphere(0.045, gold, { pos: [sx * 0.62, 0.94, RZ], wSeg: 6, hSeg: 4, parent: rope });
  }
  kit.tube([[-0.62, 0.9, RZ], [-0.3, 0.8, RZ], [0, 0.76, RZ], [0.3, 0.8, RZ], [0.62, 0.9, RZ]], 0.022, velvet, { seg: 10, radialSeg: 5, parent: rope });
  const closedPlate = crispLabel(kit, { text: { key: 'lastGame.closed' }, w: 0.5, h: 0.16, color: 0xffe0a0, bg: 0x2a0a10, frame: 0x8c6b29, font: 'public' });
  closedPlate.mesh.position.set(0, 0.66, RZ + 0.02);
  rope.add(closedPlate.mesh);
  root.add(rope);
  kit.finalize(shell);
  kit.finalize(rope, { keep: [closedPlate.mesh] });

  // The anchor is the waymark's spot: over the crown, so the diamond hangs above the cabinet.
  const anchor = new THREE.Object3D();
  anchor.name = 'lastGame';
  anchor.position.set(X, 0.6, Z);

  const hints: LightHint[] = [
    { id: 'lobby:lastGame', pos: [X - 0.9, 2.0, Z], color: 0xffc060, intensity: 0.5, range: 4, flicker: 'STEADY', zone: 'lobby' },
  ];
  // the footprint turned by rotY 270: the cabinet's depth runs along x, its width (and the lever) along z
  const statics = [{ box: new THREE.Box3(new THREE.Vector3(X - 0.47, 0, Z - 0.62), new THREE.Vector3(X + 0.47, 3.0, Z + 0.7)), tag: 'solid' as const }];

  // ── behaviour ──
  let lit = false;
  let hold = 0;           // seconds a pull keeps it lit
  let litOnce = false;    // the first frame sets the state without the flourish
  let flourish = -1;      // seconds since the opening flourish began, -1 off
  let landAt = -1;        // seconds until the flourish lands the drums
  let party = -1;         // seconds until a win's bulbs go wild
  const sfx = (name: SfxName, vol: number): void => {
    try { app.audio.play(name, { pos: anchor, vol, priority: 8 }); } catch { /* no audio in benches */ }
  };
  const apply = (on: boolean): void => {
    lit = on;
    neon.setOn(on);
    shade.visible = !on;
    rope.visible = !on;
    glow.visible = on;
    for (const l of footLamps) l.setOn(on);
    buttons.forEach((l, i) => { l.setOn(on); if (on) l.blink(1 + i * 0.5); });
    bulbs.pattern(on ? 'chase' : 'off', 5);
  };
  apply(false);
  const spin = (): void => {
    hold = PULL_HOLD_S;
    void lever.pull(0.55);
    for (const r of reels) r.startSpin(3);
  };
  const stopOn = (stops: readonly number[]): void => { reels.forEach((r, i) => { void r.stopAt(stops[i], 0.6 + i * 0.7); }); };
  const land = (win: boolean): void => {
    hold = PULL_HOLD_S;
    stopOn(win ? [0, 0, 0] : [0, 0, 1]);
    if (win) party = 2.2;
  };

  const off = o.interact?.add({
    id: 'world:lastGame',
    box: new THREE.Box3(new THREE.Vector3(X - 0.5, 0, Z - 0.7), new THREE.Vector3(X + 0.5, 2.4, Z + 0.7)),
    maxDist: 3,
    priority: 2,
    enabled: () => true,
    label: () => t(lit ? 'lastGame.label' : 'lastGame.closedLabel'),
    sub: () => t(lit ? 'lastGame.sub' : 'lastGame.closedSub'),
    onInteract: () => {
      if (isOpen()) { openLastGamePanel(); return; }
      try { app.audio.play('buzzer', { vol: 0.4 }); app.ui.toast(t('lastGame.closedToast'), 'warn'); } catch { /* headless */ }
    },
  });

  const prop: LastGameProp = {
    id: 'lastGame',
    root,
    get open() { return lit; },
    spin,
    land,
    update(dt: number): void {
      if (hold > 0) hold = Math.max(0, hold - dt);
      const want = isOpen() || hold > 0;
      if (want !== lit) {
        apply(want);
        if (want && litOnce) {   // it just opened: the drums spin up and land on 7 7 7
          flourish = 0; landAt = 1.4;
          void lever.pull(0.55);
          for (const r of reels) r.startSpin(3);
          sfx('powerUp', 0.9);
          sfx('jackpotBells', 0.6);
          try { app.world?.lights.pulse(root, { color: GOLD, mul: 2.2, dur: 1.2 }); } catch { /* no light pool */ }
        }
      }
      litOnce = true;
      if (flourish >= 0) {
        flourish += dt;
        if (landAt >= 0 && flourish >= landAt) { landAt = -1; stopOn([0, 0, 0]); }
        if (flourish > 6) flourish = -1;
      }
      if (party >= 0) {
        party -= dt;
        if (party < 0) {
          bulbs.pattern('rainbow', 8);
          sfx('jackpotShow', 0.7);
          try { app.fx.confetti(anchor, 36); } catch { /* no fx */ }
        }
      }
    },
    dispose(): void {
      off?.();
      root.removeFromParent();
      shadeMat.dispose();
      root.traverse((c) => { const m = c as THREE.Mesh; if (m.geometry) m.geometry.dispose(); });
    },
  };
  return { prop, anchor, hints, statics };
}
