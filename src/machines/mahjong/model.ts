/**
 * Mahjong: Little Wall — procedural model (WAVE24_PLAN §1). Pattern as in `hilo/model.ts`: `buildModel(kit, o)` returns
 * the whole `MachineModel`; the exported `MahjongParts` is the contract with `index.ts`. Metres, origin = floor centre,
 * +Z = front (player side).
 *
 * An M slot (1.2 × 1.0): a low lacquered table, black lacquer with a jade felt, brass trim.
 *  - the rack of 8 tiles leans on a rail in the lower third (the 8th, the tile just taken or drawn, sits a little apart);
 *  - the House's UPCARD stands in the centre on a small brass easel under the pendant lamp, the DRAW tile (face-down, or
 *    face-up with a wall-peek) beside it, the discards lie flat on the left, the waits on the right;
 *  - the wall (two rows of jade backs, one instanced draw) runs along the back and shrinks as tiles are drawn;
 *  - the turn beads (9 lamps) sit on the brass rail above the wall.
 * Draw plan: static shell merged ~4 · felt 1 · wall 1 · beads 9 · tiles ≤ 26 (one each) · hint ring 1.
 */
import * as THREE from 'three';
import { psxMaterial } from '@/core/renderer/psxMaterial';
import type { ScreenSurface } from '@/kit/types';
import type { KitX } from '@/kit';
import type { MachineModel } from '@/machines/_base/types';
import type { ModelOpts } from '@/machines/_base/MachineBase';
import { BASE_TURNS } from './rules';
import { TilePool, type TileObj } from './tiles';

export const TOP = 0.72;                       // table top height
export const TABLE_W = 1.1, TABLE_D = 0.8;
export const FELT_W = 1.0, FELT_D = 0.7;
export const TILE_W = 0.09, TILE_H = 0.12, TILE_D = 0.045;
export const RACK_SLOTS = 8;
export const RACK_Z = 0.25, RACK_TILT = -0.5;
export const BEADS = 9;
export const WALL_COLS = 30, WALL_ROWS = 2;
export const UP_POS = new THREE.Vector3(0, TOP + 0.045, 0.0);
export const DRAW_POS = new THREE.Vector3(0.23, TOP + 0.045, 0.0);
export const UP_SCALE = 1.3, DRAW_SCALE = 1.05, FLAT_SCALE = 0.8;
export const DISCARD_SLOTS = 9, WAIT_SLOTS = 6;

/** Rack slot `i` (0..7) base position; the 8th tile stands a little apart. */
export const rackPos = (i: number): THREE.Vector3 => new THREE.Vector3((i - 3.5) * 0.102 + (i === 7 ? 0.035 : 0), TOP + 0.02, RACK_Z);
/** Root height of a tile lying flat at `scale` (its thickness rests on the felt). */
export const flatY = (scale: number): number => TOP + (TILE_D * scale) / 2 + 0.05;
/** Flat discard slot: three columns, newest nearest the player. */
export const discardPos = (i: number): THREE.Vector3 => new THREE.Vector3(-0.44 + (i % 3) * 0.08, flatY(FLAT_SCALE), -0.04 + Math.floor(i / 3) * 0.105);
/** Flat wait slot: a row across the middle of the felt (the upcard and draw spot are empty then), `n` waits in all. */
export const waitPos = (i: number, n: number): THREE.Vector3 => new THREE.Vector3((i - (n - 1) / 2) * 0.1, flatY(1), 0.06);
export const beadPos = (i: number): THREE.Vector3 => new THREE.Vector3((i - (BEADS - 1) / 2) * 0.085, TOP + 0.045, -0.405);
export const wallBox = (i: number): THREE.Vector3 => {
  const row = Math.floor(i / WALL_COLS), col = i % WALL_COLS;
  return new THREE.Vector3((col - (WALL_COLS - 1) / 2) * 0.032, TOP + 0.026, -0.27 - row * 0.056);
};

/** The turn beads: one instanced mesh; `set(shown, lit)` shows the first `shown` beads, the first `lit` of them gold. */
export interface BeadRail { mesh: THREE.InstancedMesh; set(shown: number, lit: number): void }

export type MahjongParts = {
  /** Felt canvas: captions TAKE / DRAW / DISCARDS / WAITS, painted by `index.ts`. */
  felt: ScreenSurface;
  pool: TilePool;
  rack: TileObj[];
  up: TileObj;
  draw: TileObj;
  discards: TileObj[];
  waits: TileObj[];
  /** Instanced jade backs, `count` = tiles-pairs left. */
  wall: THREE.InstancedMesh;
  beads: BeadRail;
  /** Additive ring marking the suggested tile (hint). */
  hint: THREE.Mesh;
  pendant: THREE.Object3D;
  /** Anchors for fx: where coins pour from and the centre of the felt. */
  centre: THREE.Object3D;
};

const LACQUER = 0x14111a, TRIM = 0xc59c42, JADE = 0x1f7a56;

export function buildModel(kit: KitX, _o: ModelOpts): MachineModel<MahjongParts> {
  const { pal } = kit;
  const root = kit.group('mahjong');

  // ── static shell: lacquered table, brass trim, rack rail, wall tray, bead rail (merged by finalize) ──
  kit.box(TABLE_W, TOP - 0.1, TABLE_D, LACQUER, { pos: [0, (TOP - 0.1) / 2, 0], parent: root, bevel: 0.01 });
  kit.box(TABLE_W + 0.04, 0.05, TABLE_D + 0.04, 0x241a2a, { pos: [0, TOP - 0.075, 0], parent: root, bevel: 0.01 });
  kit.box(TABLE_W + 0.02, 0.012, TABLE_D + 0.02, TRIM, { pos: [0, TOP - 0.045, 0], parent: root });
  const railY = TOP + 0.012;                                                    // raised lacquer rim around the felt
  kit.box(TABLE_W, 0.03, 0.05, LACQUER, { pos: [0, railY, -TABLE_D / 2 + 0.025], parent: root, bevel: 0.008 });
  kit.box(TABLE_W, 0.03, 0.05, LACQUER, { pos: [0, railY, TABLE_D / 2 - 0.025], parent: root, bevel: 0.008 });
  kit.box(0.05, 0.03, TABLE_D, LACQUER, { pos: [-TABLE_W / 2 + 0.025, railY, 0], parent: root, bevel: 0.008 });
  kit.box(0.05, 0.03, TABLE_D, LACQUER, { pos: [TABLE_W / 2 - 0.025, railY, 0], parent: root, bevel: 0.008 });
  kit.box(TABLE_W + 0.01, 0.008, 0.008, TRIM, { pos: [0, railY + 0.016, TABLE_D / 2 - 0.004], parent: root });
  kit.box(0.84, 0.02, 0.03, 0x4a2f1a, { pos: [0, TOP + 0.012, RACK_Z + 0.05], parent: root, bevel: 0.006 });   // the rack rail
  kit.box(0.84, 0.012, 0.04, TRIM, { pos: [0, TOP + 0.026, RACK_Z + 0.062], parent: root });
  kit.box(0.98, 0.01, 0.16, 0x241a2a, { pos: [0, TOP + 0.005, -0.3], parent: root });                          // wall tray
  kit.box(0.9, 0.014, 0.05, 0x4a2f1a, { pos: [0, TOP + 0.014, -0.405], parent: root, bevel: 0.005 });          // the bead rail: a low brass-capped bar on the far rim
  kit.cyl(0.006, 0.006, 0.88, pal.brass, { pos: [0, TOP + 0.03, -0.405], rot: [0, 0, 90], seg: 6, parent: root });
  for (const s of [-1, 1]) kit.sphere(0.018, TRIM, { pos: [s * 0.45, TOP + 0.03, -0.405], wSeg: 6, hSeg: 4, parent: root });
  // the easel under the upcard
  kit.box(0.17, 0.016, 0.1, TRIM, { pos: [UP_POS.x, TOP + 0.014, UP_POS.z + 0.0], parent: root });
  kit.box(0.12, 0.012, 0.075, TRIM, { pos: [DRAW_POS.x, TOP + 0.012, DRAW_POS.z], parent: root });
  // the coin tray on the player side
  kit.box(0.3, 0.02, 0.1, pal.brass, { pos: [0.0, TOP - 0.01, TABLE_D / 2 + 0.05], parent: root });

  // ── felt (canvas; captions painted by index.ts) ──
  const felt = kit.screen({ w: FELT_W, h: FELT_D, px: [250, 175], bezel: 0x0c3a2a, glow: 0 });
  felt.mesh.position.set(0, TOP + 0.003, 0);
  felt.mesh.rotation.x = -Math.PI / 2;
  root.add(felt.mesh);

  // ── tiles: one atlas, one mesh each ──
  const pool = new TilePool({ w: TILE_W, h: TILE_H, d: TILE_D });
  const tilesRoot = new THREE.Group();
  tilesRoot.name = 'tiles';
  root.add(tilesRoot);

  const rack: TileObj[] = [];
  for (let i = 0; i < RACK_SLOTS; i++) {
    const t = pool.create(tilesRoot);
    t.root.position.copy(rackPos(i));
    t.root.rotation.x = RACK_TILT;
    t.root.visible = false;
    rack.push(t);
  }
  const up = pool.create(tilesRoot);
  up.root.position.copy(UP_POS); up.root.scale.setScalar(UP_SCALE); up.root.rotation.x = -0.32; up.root.visible = false;
  const draw = pool.create(tilesRoot);
  draw.root.position.copy(DRAW_POS); draw.root.scale.setScalar(DRAW_SCALE); draw.root.rotation.x = -0.32; draw.root.visible = false;
  const flat = (p: THREE.Vector3): TileObj => {
    const t = pool.create(tilesRoot);
    t.root.position.copy(p); t.root.rotation.x = -Math.PI / 2; t.root.scale.setScalar(FLAT_SCALE); t.root.visible = false;
    return t;
  };
  const discards: TileObj[] = [];
  for (let i = 0; i < DISCARD_SLOTS; i++) discards.push(flat(discardPos(i)));
  const waits: TileObj[] = [];
  for (let i = 0; i < WAIT_SLOTS; i++) waits.push(flat(waitPos(i, WAIT_SLOTS)));

  // ── the wall: 60 instanced jade boxes (each stands for two tiles) ──
  const wallGeo = new THREE.BoxGeometry(0.03, 0.05, 0.052);
  const wall = new THREE.InstancedMesh(wallGeo, psxMaterial({ color: JADE, lit: true, unique: true }), WALL_COLS * WALL_ROWS);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < WALL_COLS * WALL_ROWS; i++) { m4.setPosition(wallBox(i)); wall.setMatrixAt(i, m4); }
  wall.instanceMatrix.needsUpdate = true;
  wall.frustumCulled = false;
  wall.name = 'wall';
  root.add(wall);

  // ── turn beads on the rail: lit gold = a turn left (one instanced draw) ──
  const beadGeo = new THREE.SphereGeometry(0.024, 8, 6);
  const beadMesh = new THREE.InstancedMesh(beadGeo, psxMaterial({ color: 0xffffff, lit: false, unique: true }), BEADS);
  beadMesh.name = 'beads';
  beadMesh.frustumCulled = false;
  const lampOn = new THREE.Color(0xffd040), lampOff = new THREE.Color(0x3a2c10);
  const bm = new THREE.Matrix4();
  const beads: BeadRail = {
    mesh: beadMesh,
    set(shown, lit) {
      for (let i = 0; i < BEADS; i++) {
        const v = beadPos(i);
        bm.makeScale(i < shown ? 1 : 0, i < shown ? 1 : 0, i < shown ? 1 : 0).setPosition(v);
        beadMesh.setMatrixAt(i, bm);
        beadMesh.setColorAt(i, i < lit ? lampOn : lampOff);
      }
      beadMesh.instanceMatrix.needsUpdate = true;
      if (beadMesh.instanceColor) beadMesh.instanceColor.needsUpdate = true;
    },
  };
  beads.set(BASE_TURNS, BASE_TURNS);
  root.add(beadMesh);

  // ── hint ring (suggested discard) ──
  const hint = new THREE.Mesh(
    new THREE.RingGeometry(0.074, 0.09, 20),
    psxMaterial({ color: 0xffb800, lit: false, fog: false, side: 'double', unique: true }),
  );
  hint.visible = false;
  hint.renderOrder = 5;
  hint.material.depthTest = false;                                              // the ring is never hidden by the tile it marks
  root.add(hint);

  // ── pendant lamp over the table (its light is the pooled hint) ──
  const pendant = new THREE.Group();
  pendant.name = 'pendant';
  pendant.position.set(0, TOP + 1.0, -0.02);
  root.add(pendant);
  kit.cyl(0.005, 0.005, 0.6, pal.chrome, { pos: [0, 0.3, 0], seg: 5, parent: pendant });
  kit.cyl(0.04, 0.17, 0.11, 0x8a1a22, { pos: [0, -0.02, 0], seg: 10, parent: pendant });
  kit.cyl(0.17, 0.17, 0.012, TRIM, { pos: [0, -0.078, 0], seg: 10, parent: pendant });

  const light = new THREE.Object3D();
  light.position.set(0, TOP + 0.85, 0.05);
  light.userData = { color: 0xffe2a0, intensity: 1.2, range: 2.4, flicker: 'STEADY' };
  root.add(light);
  const light2 = new THREE.Object3D();
  light2.position.set(0, TOP + 0.3, 0.7);
  light2.userData = { color: 0xbfe8d0, intensity: 0.6, range: 1.8, flicker: 'STEADY' };
  root.add(light2);

  const prompt = new THREE.Object3D(); prompt.position.set(0, TOP + 0.5, 0.25); root.add(prompt);
  const speaker = new THREE.Object3D(); speaker.position.set(0, TOP + 0.1, 0); root.add(speaker);
  const coinOut = new THREE.Object3D(); coinOut.position.set(0, TOP + 0.02, TABLE_D / 2 + 0.05); root.add(coinOut);
  const centre = new THREE.Object3D(); centre.position.set(0, TOP + 0.1, 0); root.add(centre);
  const label = new THREE.Object3D(); label.position.set(0, TOP + 0.5, -0.4); root.add(label);
  const marqueeTop = new THREE.Object3D(); marqueeTop.position.set(0, TOP + 1.0, -0.4); root.add(marqueeTop);
  const servicePlate = new THREE.Object3D(); servicePlate.position.set(0.5, TOP - 0.2, 0.42); root.add(servicePlate);

  const parts: MahjongParts = { felt, pool, rack, up, draw, discards, waits, wall, beads, hint, pendant, centre };
  kit.finalize(root, {
    keep: [
      felt.mesh, tilesRoot, wall, hint, pendant, light, light2, beadMesh,
    ],
  });

  return {
    root, parts,
    // the camera sits 0.66 m in front of the centre and 0.8 m over the felt: rack, easel, both sides, wall and beads all in frame
    playPose: { pos: new THREE.Vector3(0, TOP + 0.82, 0.66), look: new THREE.Vector3(0, TOP, 0.06), fov: 52, mouse: 'pick' },
    colliders: [{ min: [-TABLE_W / 2 - 0.02, 0, -TABLE_D / 2 - 0.02], max: [TABLE_W / 2 + 0.02, TOP + 0.05, TABLE_D / 2 + 0.02] }],
    interact: { min: [-0.6, 0.2, -0.5], max: [0.6, TOP + 0.9, 0.6] },
    anchors: { speaker, prompt, label, marqueeTop, servicePlate, coinOut, light, light2 },
    dispose: () => {
      felt.dispose();
      pool.dispose();
      wallGeo.dispose();
      beadGeo.dispose();
      hint.geometry.dispose();
    },
  };
}
