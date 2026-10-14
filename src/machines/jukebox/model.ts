/**
 * Jukebox — procedural model (system category, slot M). A tall walnut cabinet in the Lobby (LOB-JUKE): a round
 * porthole with a vinyl that spins while a song plays, neon bubble tubes down both sides, a twelve-key song panel
 * (3 × 4) under a small list screen, and an amber dome lamp on top. Footprint 1.2 × 1.0 × 3.2 m (SLOT_DIMS.M).
 * Origin = floor centre, +Z = the customer side, the cabinet back is at z = WALL_Z.
 */
import * as THREE from 'three';
import type { LampPart, ScreenSurface } from '@/kit/types';
import type { KitX } from '@/kit';
import type { MachineModel } from '@/machines/_base/types';
import type { ModelOpts } from '@/machines/_base/MachineBase';
import { SONG_COLS } from './rules';

export type JukeboxParts = {
  /** Vinyl behind the porthole. Its root spins around the axis that faces the customer. */
  spinner: THREE.Object3D;
  /** Twelve song keys, one root each. A key sinks on press and springs back. */
  keys: THREE.Object3D[];
  /** Neon bubble tubes on both sides. The sim pulses their glow with the beat. */
  tubes: THREE.Object3D[];
  /** 128 × 96 px song list. */
  screen: ScreenSurface;
  lamp: LampPart;
};

export const W = 1.2, D = 0.9, H = 2.9;
const WALL_Z = -0.42;
/** Neon colour of the cabinet (GDD Lobby light: jukebox glow #FF8A3D). */
export const GLOW = 0xff8a3d;
export const KEY_SINK = 0.02;

export function buildModel(kit: KitX, o: ModelOpts): MachineModel<JukeboxParts> {
  const { pal } = kit;
  const root = kit.group('jukebox');
  const at = (x: number, y: number, z: number, extra: { seg?: number } = {}): { pos: [number, number, number]; parent: THREE.Object3D; seg?: number } => ({ pos: [x, y, z], parent: root, ...extra });
  const wood = o.variant % 2 ? pal.woodDark : pal.wood;
  const front = WALL_Z + D - 0.05;

  // ── cabinet shell (static) ──
  kit.box(W, H, 0.06, wood, at(0, H / 2, WALL_Z));                                          // back board
  for (const sx of [-1, 1]) kit.box(0.06, H, D, wood, at(sx * (W / 2 - 0.03), H / 2, WALL_Z + D / 2)); // sides
  kit.box(W, 0.08, D, wood, at(0, H - 0.04, WALL_Z + D / 2));                               // top
  kit.box(W + 0.03, 0.05, D + 0.04, pal.brass, at(0, H - 0.1, WALL_Z + D / 2));             // brass cornice
  kit.box(W, 0.12, D, wood, at(0, 0.06, WALL_Z + D / 2));                                   // plinth
  kit.box(W - 0.16, 0.9, 0.04, wood, at(0, 1.55, front));                                   // lower panel
  kit.box(W + 0.02, 0.05, 0.05, pal.brass, at(0, 2.1, front + 0.02));                       // trim line

  // ── porthole + vinyl (animated) ──
  kit.cyl(0.28, 0.28, 0.04, pal.black, { pos: [0, 2.45, front + 0.01], rot: [90, 0, 0], parent: root, seg: 24 }); // bezel disc, axis to the customer
  const spinner = new THREE.Object3D();
  spinner.position.set(0, 2.45, front + 0.04);
  spinner.rotation.x = Math.PI / 2;                                                        // axis now faces the customer
  kit.cyl(0.25, 0.25, 0.012, 0x141418, { pos: [0, 0, 0], parent: spinner, seg: 28 });        // vinyl
  kit.cyl(0.07, 0.07, 0.014, 0xff8a3d, { pos: [0, 0, 0], parent: spinner, seg: 12 });        // label
  root.add(spinner);

  // ── neon bubble tubes (animated glow) ──
  const tubes: THREE.Object3D[] = [];
  for (const sx of [-1, 1]) {
    const t = new THREE.Object3D();
    t.position.set(sx * (W / 2 - 0.1), 1.55, front + 0.02);
    kit.cyl(0.03, 0.03, 2.4, GLOW, { pos: [0, 0, 0], parent: t, seg: 8 });
    root.add(t);
    tubes.push(t);
  }

  // ── song list screen and the twelve keys ──
  const screen = kit.screen({ w: 0.56, h: 0.42, px: [128, 96], bezel: pal.black });
  screen.mesh.position.set(0, 1.92, front + 0.03);
  root.add(screen.mesh);

  const keys: THREE.Object3D[] = [];
  const KEY_W = 0.2, KEY_GAP = 0.04;
  for (let i = 0; i < 12; i++) {
    const col = i % SONG_COLS, row = Math.floor(i / SONG_COLS);
    const x = (col - (SONG_COLS - 1) / 2) * (KEY_W + KEY_GAP);
    const y = 1.62 - row * 0.11;
    const k = new THREE.Object3D();
    k.position.set(x, y, front + 0.02);
    kit.box(KEY_W, 0.08, 0.05, i % 2 ? pal.steel : pal.brass, { pos: [0, 0, 0], parent: k });
    root.add(k);
    keys.push(k);
  }

  // ── lamp on top ──
  kit.cyl(0.07, 0.08, 0.1, pal.brass, at(0, H + 0.05, WALL_Z + D / 2, { seg: 10 }));
  const lamp = kit.lamp({ r: 0.07, color: GLOW, shape: 'dome' });
  lamp.root.position.set(0, H + 0.1, WALL_Z + D / 2);
  // the glow sprite is r*7 across: shrink it so the lit lamp stays inside the 3.2 m height limit
  lamp.root.traverse((n) => { if ((n as THREE.Sprite).isSprite) n.scale.multiplyScalar(0.6); });
  root.add(lamp.root);

  // ── anchors ──
  const prompt = new THREE.Object3D(); prompt.position.set(0, 1.95, front + 0.3); root.add(prompt);
  const coinOut = new THREE.Object3D(); coinOut.position.set(0, 1.0, front + 0.25); root.add(coinOut);
  const light = new THREE.Object3D();
  light.position.set(0, 2.1, front + 0.6);
  light.userData = { color: GLOW, intensity: 0.6, range: 2.4, flicker: 'STEADY' };
  root.add(light);

  const parts: JukeboxParts = { spinner, keys, tubes, screen, lamp };
  kit.finalize(root, { keep: [spinner, ...keys, ...tubes, screen.mesh, lamp.root, light] });

  return {
    root,
    parts,
    playPose: { pos: new THREE.Vector3(0, 1.6, 1.1), look: new THREE.Vector3(0, 1.9, -0.2), fov: 60, mouse: 'primary' },
    colliders: [
      { min: [-W / 2, 0, WALL_Z], max: [W / 2, H, WALL_Z + D] },
    ],
    interact: { min: [-W / 2, 0.3, WALL_Z], max: [W / 2, H, front + 0.4] },
    anchors: { speaker: prompt, prompt, light, coinOut, insideGlass: screen.mesh },
    dispose: () => { screen.dispose(); },
  };
}
