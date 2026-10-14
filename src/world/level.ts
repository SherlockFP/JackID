/**
 * The pit (WORLD-ARCH, GDD §8): shell, zone floors and ceilings, wall runs with the doorway gaps of GDD §8.4,
 * columns, the Well dais, light fixtures and hints (GDD §8.7), signage, the wing gates, the lift, the quota board, the
 * clock, the hero trapdoor and the Sump, plus spawn sets (GDD §8.8) and named anchors for cutscenes.
 *
 * The world (WORLD-SYS) calls `buildLevel(ctx)`. Static colliders are returned in `statics`; the trapdoor plate and the
 * Sump floor register their own colliders because the trapdoor needs the ids to toggle.
 */
import * as THREE from 'three';
import type { KitX } from '@/kit';
import type { TexGen } from '@/core/texgen/types';
import type { V3 } from '@/core/types';
import type { GateDef, LevelBuild, LevelCtx, LightHint, SpawnPoint } from './sys/arch';
import type { WorldProp } from './types';
import { ZONES } from './layout';
import { bareBulb, chandelier, flickerLevel, pendant, sconce, tube } from './lights';
import { buildColumn, buildGrille, buildVelvetCurtain, buildManagementDoor, buildSump, buildFurnace, buildCollectorChair, buildXPlate, disposeTree, type GateProp } from './props/decor';
import { createClock, type WallClock } from './props/clock';
import { createTrapdoor, type Trapdoor } from './props/trapdoor';
import { createElevator, type Elevator } from './props/elevator';
import { createQuotaBoard, type QuotaBoard } from './props/quotaBoard';
import { buildRooms, type RoomsBuild } from './rooms';

// ── constants ───────────────────────────────────────────────────────────────────────────────────
const T = 0.3;            // wall thickness (GDD §8.1)
const WALL_H = 9;         // walls run to the tallest ceiling; ceilings hide the rest
const LINTEL_Y = 3.2;     // doorway header
const HERO_PLATE = { x: 0, z: 12 };   // hero trapdoor (Lobby centre); the Sump lies under it
const SUMP_POS: V3 = [0, -30, 12];
const WELL_DAIS = { x: 0, z: -4 };    // WELL-01 dais 4 × 4 × 0.15
/** Playtest lift (director): the pit read as too dark. Every fixture hint gets this intensity and reach gain. */
const FIXTURE_GAIN = 1.8;
const FIXTURE_RANGE = 1.2;

const CEILING: Record<string, number> = {
  mouth: 6.0, well: 9.0, lobby: 4.5, midway: 4.0, cards: 3.2, laundry: 5.0, boiler: 3.6,
  gallery: 4.0, wheels: 6.0, parlour: 2.6, counting: 2.8, lift: 2.6,
};

/** Floor texture per zone (ART_BIBLE §6.1 / GDD §8.3 floor themes). */
function floorTex(id: string, tex: TexGen, kit: KitX): { map: THREE.Texture; color: number; tile: number } {
  switch (id) {
    case 'mouth': return { map: tex.tiles(0x4a3a2a, 0x6a5238, 2), color: 0xffffff, tile: 2 };
    case 'well': return { map: tex.carpet('swirl', [0x5a0a14, 0x8a6a2a]), color: 0xffffff, tile: 2 };
    case 'lobby': return { map: tex.carpet('diamond', [0x3a0a10, 0x5a1a20]), color: 0xffffff, tile: 2 };
    case 'midway': return { map: tex.carpet('stars', [0x2a0a4a, 0x1a0630]), color: 0xffffff, tile: 2 };
    case 'cards': return { map: tex.felt(0x0a4a2a), color: 0xffffff, tile: 2 };
    case 'laundry': return { map: tex.tiles(0xb8c4c8, 0x8a9499, 3), color: 0xffffff, tile: 1 };
    case 'boiler': return { map: kit.tex.vendor('sbs-tiny3/128x128/Grating/Grating_05-128x128.png', { size: 64 }), color: 0x6a5040, tile: 2 };
    case 'gallery': return { map: tex.carpet('stars', [0x2a0a3a, 0x0a0a2a]), color: 0xffffff, tile: 2 };
    case 'wheels': return { map: tex.carpet('diamond', [0x6a0a14, 0x3a0608]), color: 0xffffff, tile: 2 };
    case 'parlour': return { map: tex.vendor('sbs-tiny2/128x128/Wood/Wood_07-128x128.png', { size: 64 }), color: 0x8a6a48, tile: 2 };
    case 'counting': return { map: tex.concrete(0x3a3430), color: 0xffffff, tile: 2 };
    default: return { map: tex.wood(0x6a4a30), color: 0xffffff, tile: 2 };
  }
}

// ── UV helpers: world-unit tiling on kit primitives (their UVs are 0…1 per face) ──────────────────
function boxWorldUV(mesh: THREE.Mesh, tile: number): void {
  const geo = mesh.geometry as THREE.BufferGeometry;
  const pos = geo.attributes.position, nrm = geo.attributes.normal, uv = geo.attributes.uv;
  if (!pos || !nrm || !uv) return;
  for (let i = 0; i < pos.count; i++) {
    const nx = Math.abs(nrm.getX(i)), ny = Math.abs(nrm.getY(i)), nz = Math.abs(nrm.getZ(i));
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    let u: number, v: number;
    if (nx >= ny && nx >= nz) { u = z; v = y; } else if (nz >= ny) { u = x; v = y; } else { u = x; v = z; }
    uv.setXY(i, u / tile, v / tile);
  }
  uv.needsUpdate = true;
}
function planeWorldUV(mesh: THREE.Mesh, w: number, h: number, tile: number): void {
  const geo = mesh.geometry as THREE.BufferGeometry;
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + w / 2) / tile, (pos.getY(i) + h / 2) / tile);
  uv.needsUpdate = true;
}

/** Rect minus a hole, as up to four rects (x0, z0, x1, z1). Holes are assumed to lie inside the rect. */
type R4 = [number, number, number, number];
function rectMinus(r: R4, hole: R4 | null): R4[] {
  if (!hole) return [r];
  const [x0, z0, x1, z1] = r, [a0, b0, a1, b1] = hole;
  if (a1 <= x0 || a0 >= x1 || b1 <= z0 || b0 >= z1) return [r];
  const out: R4[] = [];
  if (b0 > z0) out.push([x0, z0, x1, b0]);
  if (b1 < z1) out.push([x0, b1, x1, z1]);
  if (a0 > x0) out.push([x0, Math.max(z0, b0), a0, Math.min(z1, b1)]);
  if (a1 < x1) out.push([a1, Math.max(z0, b0), x1, Math.min(z1, b1)]);
  return out;
}

/** Plane facing up (floor) or down (ceiling) covering a rect at height y. */
function horizontal(kit: KitX, r: R4, y: number, mat: THREE.Material, up: boolean, tile: number, parent: THREE.Object3D): THREE.Mesh {
  const w = r[2] - r[0], d = r[3] - r[1];
  const m = kit.plane(w, d, mat, { rot: [up ? -90 : 90, 0, 0], pos: [(r[0] + r[2]) / 2, y, (r[1] + r[3]) / 2], parent, segW: Math.max(1, Math.round(w / 4)), segH: Math.max(1, Math.round(d / 4)) });
  planeWorldUV(m, w, d, tile); // the plane's local x/y span w and d before its rotation
  return m;
}

// ── wall runs ───────────────────────────────────────────────────────────────────────────────────
/** Shared state for the wall runs: where to parent, which materials to use, where colliders go. */
interface WallCtx { kit: KitX; root: THREE.Object3D; wall: THREE.Material; wain: THREE.Material; statics: Array<{ box: THREE.Box3; tag?: 'solid' | 'walkable' | 'low' }>; meshes: THREE.Mesh[] }

/**
 * A wall along x (fixed z = c, spanning x ∈ [a0, a1]) or along z (fixed x = c, spanning z ∈ [a0, a1]).
 * Gaps are doorways; each gets a lintel above `LINTEL_Y`. Wainscot is 1.2 m high on both faces.
 */
function wallRun(w: WallCtx, axis: 'x' | 'z', c: number, a0: number, a1: number, gaps: Array<[number, number]> = [], h = WALL_H): void {
  const pieces: Array<{ lo: number; hi: number; y0: number; y1: number }> = [];
  let cur = a0;
  for (const [g0, g1] of [...gaps].sort((p, q) => p[0] - q[0])) {
    if (g0 > cur) pieces.push({ lo: cur, hi: g0, y0: 0, y1: h });
    pieces.push({ lo: g0, hi: g1, y0: LINTEL_Y, y1: h });
    cur = g1;
  }
  if (a1 > cur) pieces.push({ lo: cur, hi: a1, y0: 0, y1: h });
  for (const p of pieces) {
    const len = p.hi - p.lo, mid = (p.lo + p.hi) / 2, ht = p.y1 - p.y0, cy = (p.y0 + p.y1) / 2;
    const size: [number, number, number] = axis === 'z' ? [T, ht, len] : [len, ht, T];
    const pos: V3 = axis === 'z' ? [c, cy, mid] : [mid, cy, c];
    const m = w.kit.box(size[0], size[1], size[2], w.wall, { pos, parent: w.root });
    boxWorldUV(m, 2);
    w.meshes.push(m);
    if (p.y0 === 0) {
      const wm = w.kit.box(axis === 'z' ? T + 0.04 : len, 1.2, axis === 'z' ? len : T + 0.04, w.wain, { pos: axis === 'z' ? [c, 0.6, mid] : [mid, 0.6, c], parent: w.root });
      boxWorldUV(wm, 1);
      w.meshes.push(wm);
      w.statics.push({ box: new THREE.Box3(new THREE.Vector3(pos[0] - size[0] / 2, 0, pos[2] - size[2] / 2), new THREE.Vector3(pos[0] + size[0] / 2, h, pos[2] + size[2] / 2)), tag: 'solid' });
    }
  }
}

// ── the level ───────────────────────────────────────────────────────────────────────────────────
export function buildLevel(ctx: LevelCtx): LevelBuild {
  const kit = ctx.kit as KitX;
  const tex = ctx.tex;
  const root = new THREE.Group();
  root.name = 'level:pit';
  const statics: Array<{ box: THREE.Box3; tag?: 'solid' | 'walkable' | 'low' }> = [];
  const lights: LightHint[] = [];
  const anchors: Record<string, THREE.Object3D> = {};
  const updates: Array<{ update(dt: number, t: number): void }> = [];
  const disposables: Array<{ dispose(): void }> = [];
  const gates: Record<string, GateDef> = {};

  const shell = kit.group('shell');
  const statical = kit.group('statics');
  root.add(shell, statical);
  const box3 = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) =>
    new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1));

  // ── floors and ceilings (split around the hero trapdoor hole) ────────────────────────────────
  const hole: R4 = [HERO_PLATE.x - 1, HERO_PLATE.z - 1, HERO_PLATE.x + 1, HERO_PLATE.z + 1];
  const wallMatDeco = kit.mat({ color: 0x8a6a48, map: kit.tex.vendor('sbs-horror/128x128/Wall/Horror_Wall_03-128x128.png', { size: 64 }) });
  const wallMatOx = kit.mat({ color: 0x5a2024, map: kit.tex.vendor('sbs-horror/128x128/Wall/Horror_Wall_07-128x128.png', { size: 64 }) });
  const wainMat = kit.mat({ color: 0x4a2a18, map: kit.tex.vendor('sbs-tiny2/128x128/Wood/Wood_05-128x128.png', { size: 64 }) });
  const coffer = tex.canvas(128, 128, (g, w, h) => {
    g.fillStyle = '#c9b48a';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#7a5a30';
    g.fillRect(0, 0, 16, h); g.fillRect(w - 16, 0, 16, h); g.fillRect(0, 0, w, 16); g.fillRect(0, h - 16, w, 16);
    g.fillStyle = '#e8c46a';
    g.beginPath();
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      g.moveTo(w / 2, h / 2);
      g.lineTo(w / 2 + Math.cos(a) * 14, h / 2 + Math.sin(a) * 14);
    }
    g.fill();
  }, { wrap: 'repeat' });
  const ceilMat = kit.mat({ map: coffer, color: 0xd8c8a8 });
  const wf: WallCtx = { kit, root: shell, wall: wallMatDeco, wain: wainMat, statics, meshes: [] };

  // floors: walkable boxes (top y 0) and visuals, split around the hero trapdoor hole in the Lobby;
  // ceilings: one plane per zone at its height, never holed
  for (const z of ZONES) {
    const ft = floorTex(z.id, tex, kit);
    const fmat = kit.mat({ color: ft.color, map: ft.map });
    for (const piece of rectMinus(z.rect as R4, z.id === 'lobby' ? hole : null)) {
      horizontal(kit, piece, 0, fmat, true, ft.tile, statical);
      statics.push({ box: box3(piece[0], -0.5, piece[1], piece[2], 0, piece[3]), tag: 'walkable' });
    }
    horizontal(kit, z.rect as R4, CEILING[z.id] ?? 4.5, ceilMat, false, 2, shell);
  }

  // ── walls ───────────────────────────────────────────────────────────────────────────────────
  const deco = wallMatDeco, ox = wallMatOx;
  // outer shell
  wf.wall = deco;
  wallRun(wf, 'z', -31, -32.2, 20, [], WALL_H);
  wallRun(wf, 'z', 31, -32.2, 20, [], WALL_H);
  wallRun(wf, 'x', -32.2, -31, 31, [], WALL_H);
  wallRun(wf, 'x', 20, -31, 31, [], WALL_H);
  // north line z = -30 (Midway, Mouth with the lift door, Boiler)
  wallRun(wf, 'x', -30, -31, -11, [], WALL_H);
  wallRun(wf, 'x', -30, -11, 11, [[-5, -3]], WALL_H);     // lift door, 2.0 m, ART/GDD §8.4
  wallRun(wf, 'x', -30, 11, 31, [], WALL_H);
  // lift niche walls (z −32.2 … −30)
  wallRun(wf, 'z', -5.1, -32.2, -30, [], 2.6);
  wallRun(wf, 'z', -2.9, -32.2, -30, [], 2.6);
  // Mouth ↔ Midway / Boiler (grilles at z −25…−21)
  wallRun(wf, 'z', -11, -30, -18, [[-25, -21]], WALL_H);
  wallRun(wf, 'z', 11, -30, -18, [[-25, -21]], WALL_H);
  // Well ↔ Card Room / Gallery (grilles at z −11…−7), the Well flanks
  wallRun(wf, 'z', -11, -18, 2, [[-11, -7]], WALL_H);
  wallRun(wf, 'z', 11, -18, 2, [[-11, -7]], WALL_H);
  // Lobby ↔ Laundry / Wheel House (z 3…7) and Lobby ↔ Counting / Parlour (z 15…17)
  wallRun(wf, 'z', -11, 2, 20, [[3, 7], [15, 17]], WALL_H);
  wallRun(wf, 'z', 11, 2, 20, [[3, 7], [15, 17]], WALL_H);
  // wing partitions (solid)
  wf.wall = ox;
  wallRun(wf, 'x', -16, -31, -11, [], WALL_H);   // Midway | Card Room
  wallRun(wf, 'x', -2, -31, -11, [], WALL_H);    // Card Room | Laundry
  wallRun(wf, 'x', 12, -31, -11, [], WALL_H);    // Laundry | Counting
  wallRun(wf, 'x', -16, 11, 31, [], WALL_H);     // Boiler | Gallery
  wallRun(wf, 'x', -2, 11, 31, [], WALL_H);      // Gallery | Wheel House
  wallRun(wf, 'x', 12, 11, 31, [], WALL_H);      // Wheel House | Parlour

  // ── columns: brass pillars at x ±7 every 6 m in the nave (GDD §8.4) ───────────────────────────
  for (const z of [-27, -21, -15, -9, -3, 3, 9, 15]) {
    const h = z < -18 ? CEILING.mouth : z < 2 ? CEILING.well : CEILING.lobby;
    for (const x of [-7, 7]) {
      const col = buildColumn(kit, tex, { h, pos: [x, 0, z] });
      statical.add(col.root);
      statics.push({ box: box3(x - 0.45, 0, z - 0.45, x + 0.45, h, z + 0.45), tag: 'solid' });
    }
  }

  // ── the Well: dais (WELL-01) with brass nosing ─────────────────────────────────────────────
  kit.box(4.0, 0.15, 4.0, kit.mat({ color: 0x5a4a3a, map: tex.tiles(0x5a4a3a, 0x3a3028, 2) }), { pos: [WELL_DAIS.x, 0.075, WELL_DAIS.z], parent: statical });
  kit.box(4.06, 0.03, 0.06, kit.pal.brass, { pos: [WELL_DAIS.x, 0.15, WELL_DAIS.z + 2.0], parent: statical });
  statics.push({ box: box3(WELL_DAIS.x - 2, -0.5, WELL_DAIS.z - 2, WELL_DAIS.x + 2, 0.15, WELL_DAIS.z + 2), tag: 'walkable' });

  // ── the hero trapdoor (2 × 2 plate in the Lobby) and the Sump under it ───────────────────────
  const plateBox = box3(HERO_PLATE.x - 1, -0.5, HERO_PLATE.z - 1, HERO_PLATE.x + 1, 0, HERO_PLATE.z + 1);
  const plateId = ctx.collision.addStatic(plateBox, 'walkable');
  // the Sump floor (y −30) lies under the lobby floor, so its box never overlaps the lobby's walkable boxes
  ctx.collision.addStatic(box3(SUMP_POS[0] - 6, -30.5, SUMP_POS[2] - 6, SUMP_POS[0] + 6, -30, SUMP_POS[2] + 6), 'walkable');
  const trapdoor: Trapdoor = createTrapdoor(kit, tex, { pos: [HERO_PLATE.x, 0, HERO_PLATE.z], collision: ctx.collision, colliderIds: [plateId] });
  root.add(trapdoor.root);
  disposables.push(trapdoor);

  const sump = buildSump(kit, tex, { pos: SUMP_POS, seed: ctx.seed ^ 0x51ab, coinCount: 700 });
  root.add(sump.root);
  disposables.push(sump);
  // the sump walls are solid; the floor is registered above
  statics.push({ box: box3(SUMP_POS[0] - 6.15, -30, SUMP_POS[2] - 6.15, SUMP_POS[0] + 6.15, -26, SUMP_POS[2] - 6), tag: 'solid' });
  statics.push({ box: box3(SUMP_POS[0] - 6.15, -30, SUMP_POS[2] + 6, SUMP_POS[0] + 6.15, -26, SUMP_POS[2] + 6.15), tag: 'solid' });
  statics.push({ box: box3(SUMP_POS[0] - 6.15, -30, SUMP_POS[2] - 6, SUMP_POS[0] - 6, -26, SUMP_POS[2] + 6), tag: 'solid' });
  statics.push({ box: box3(SUMP_POS[0] + 6, -30, SUMP_POS[2] - 6, SUMP_POS[0] + 6.15, -26, SUMP_POS[2] + 6), tag: 'solid' });
  const sumpLamps: Array<[number, number]> = [[-5.4, 5.4], [5.4, 5.4], [-5.4, -5.4], [5.4, -5.4]];
  for (const [i, [lx, lz]] of sumpLamps.entries()) {
    lights.push({ id: `sump:cage${i}`, pos: [SUMP_POS[0] + lx, -27, SUMP_POS[2] + lz], color: 0xffb45a, intensity: 0.9, range: 6, flicker: 'DYING', zone: 'sump' });
  }
  const exit = kit.neon({ text: { key: 'prop.sign.exit' }, h: 0.45, color: 0xff3a2a, flicker: 0.4 });
  exit.root.position.set(SUMP_POS[0], -26.8, SUMP_POS[2] + 5.95);
  exit.root.rotation.y = Math.PI;
  root.add(exit.root);

  // ── the clock (MOUTH-CLOCK) and the lift call panel ────────────────────────────────────────
  const clock: WallClock = createClock(kit, { pos: [0, 4.3, -29.7], ceiling: CEILING.mouth - 4.3 });
  root.add(clock.root);
  disposables.push(clock);

  // ── the quota board (WELL-BOARD) above the Well ─────────────────────────────────────────────
  const board: QuotaBoard = createQuotaBoard(kit, { pos: [0, 6.5, -16.5], ceiling: CEILING.well });
  root.add(board.root);
  disposables.push(board);

  // ── the lift (MOUTH-LIFT doors at (−4, 0, −30)) ─────────────────────────────────────────────
  const elevator: Elevator = createElevator(kit, tex, { pos: [-4, 0, -30] });
  root.add(elevator.root);
  disposables.push(elevator);

  // ── gates: wing grilles, the parlour curtain, the management door ──────────────────────────
  const grilles: Array<[string, number, number, 0 | 90, string, Array<[number, number, number, number]>]> = [
    ['midway', -11, -23, 90, 'gate:midway', [[-11.2, -25, -10.8, -21]]],
    ['boiler', 11, -23, 90, 'gate:boiler', [[10.8, -25, 11.2, -21]]],
    ['cards', -11, -9, 90, 'gate:cards', [[-11.2, -11, -10.8, -7]]],
    ['gallery', 11, -9, 90, 'gate:gallery', [[10.8, -11, 11.2, -7]]],
    ['laundry', -11, 5, 90, 'gate:laundry', [[-11.2, 3, -10.8, 7]]],
    ['wheels', 11, 5, 90, 'gate:wheels', [[10.8, 3, 11.2, 7]]],
  ];
  for (const [zone, x, z, rot, id, cols] of grilles) {
    const g = buildGrille(kit, tex, { id, pos: [x, 0, z], rotY: rot });
    root.add(g.root);
    disposables.push(g);
    updates.push(g);
    gates[zone] = { prop: g as GateProp, colliders: cols.map(([a, b, c, d]) => box3(a, 0, b, c, LINTEL_Y, d)) };
  }
  const curtain = buildVelvetCurtain(kit, tex, { pos: [11, 0, 16], rotY: 90 });
  root.add(curtain.root);
  disposables.push(curtain);
  gates.parlour = { prop: curtain, colliders: [box3(10.8, 0, 15, 11.2, 2.7, 17)] };
  const mgmt = buildManagementDoor(kit, tex, { pos: [-11, 0, 16], rotY: 90 });
  root.add(mgmt.root);
  disposables.push(mgmt);
  gates.counting = { prop: mgmt, colliders: [box3(-11.15, 0, 15, -10.85, 2.6, 17)] };
  gates.lift = {
    prop: { id: 'gate:lift', root: elevator.root, setOpen: (o: boolean, d?: number) => elevator.doors(o, d), dispose: () => undefined } as GateProp,
    colliders: [box3(-5, 0, -30.2, -3, 2.6, -29.8)],
  };

  // ── columns for the Wheel House dome and the Well chandelier are fixtures; signs & fixtures next ──
  const fx = (f: { root: THREE.Object3D; hint: LightHint; update?(dt: number, t: number): void }) => {
    root.add(f.root);
    lights.push(f.hint);
    if (f.update) updates.push({ update: (dt, t) => f.update?.(dt, t) });
  };

  // Mouth: sodium pendants, the terminal's amber CRT spill, the lift call panel
  fx(pendant(kit, { id: 'mouth:pend0', pos: [-6, 5.0, -24], drop: CEILING.mouth - 5.0, color: 0xffb45a, intensity: 1.2, range: 9, flicker: 'BUZZ', zone: 'mouth' }));
  fx(pendant(kit, { id: 'mouth:pend1', pos: [6, 5.0, -24], drop: CEILING.mouth - 5.0, color: 0xffb45a, intensity: 1.2, range: 9, flicker: 'STEADY', zone: 'mouth' }));
  lights.push({ id: 'mouth:terminal', pos: [0, 1.8, -28.4], color: 0xffb000, intensity: 0.9, range: 4, flicker: 'SICK', zone: 'mouth' });
  lights.push({ id: 'mouth:booth', pos: [4, 2.2, -28.4], color: 0xffd34a, intensity: 0.6, range: 3, flicker: 'BUZZ', zone: 'mouth' });
  lights.push({ id: 'mouth:lift', pos: [-4, 2.4, -31.1], color: 0xfff2d0, intensity: 1.0, range: 4, flicker: 'DYING', zone: 'lift' });

  // Well: the chandelier ring (r 3 m, 24 bulbs, y 7.5) and the dais cone
  fx(chandelier(kit, { id: 'well:chandelier', pos: [0, 7.5, -4], r: 3.0, bulbs: 24, ceiling: CEILING.well, color: 0xffb347, intensity: 1.6, range: 12, zone: 'well', tiers: 2 }));
  lights.push({ id: 'well:dais', pos: [0, 4.0, -4], color: 0xffe2a0, intensity: 1.4, range: 10, flicker: 'STEADY', zone: 'well' });
  lights.push({ id: 'well:marquee', pos: [0, 2.0, -6.5], color: 0xffc861, intensity: 0.6, range: 4, flicker: 'CANDLE', zone: 'well' });

  // Lobby: brass sconces, jukebox glow, pawn backlight
  fx(sconce(kit, { id: 'lobby:sconceW', pos: [-10.8, 2.4, 2.6], facing: 90, color: 0xe8c46a, zone: 'lobby' }));
  fx(sconce(kit, { id: 'lobby:sconceE', pos: [10.8, 2.4, 2.6], facing: 270, color: 0xe8c46a, zone: 'lobby' }));
  lights.push({ id: 'lobby:juke', pos: [9.4, 1.6, 9.0], color: 0xff8a3d, intensity: 0.6, range: 3, flicker: 'SICK', zone: 'lobby' });
  lights.push({ id: 'lobby:pawn', pos: [-6, 2.4, 18.6], color: 0xfff2c0, intensity: 0.9, range: 4, flicker: 'STEADY', zone: 'lobby' });

  // Midway: a chasing bulb string under the ceiling, black-light UV
  const string = kit.bulbChain({ path: [[-29, 3.7, -28.5], [-13, 3.7, -28.5]], count: 16, colors: [0xff4d6d, 0xffd23f, 0x3bceac], r: 0.05 });
  string.pattern('chase', 4);
  root.add(string.root);
  lights.push({ id: 'midway:chase', pos: [-21, 3.5, -28.5], color: 0xff4d6d, intensity: 0.7, range: 8, flicker: 'CHASE', zone: 'midway' });
  lights.push({ id: 'midway:uv', pos: [-21, 3.4, -20], color: 0x6a2cff, intensity: 0.6, range: 7, flicker: 'STEADY', zone: 'midway' });

  // Card Room: green banker lamps over the three felt tables
  for (const [i, [x, z]] of ([[-24, -9], [-16, -15], [-16, -3]] as Array<[number, number]>).entries()) {
    fx(pendant(kit, { id: `cards:banker${i}`, pos: [x, 2.4, z], drop: CEILING.cards - 2.4, color: 0x7cff9a, intensity: 1.2, range: 4.5, flicker: 'STEADY', zone: 'cards' }));
  }

  // Laundry: fluorescent tubes (1 in 6 flickers)
  for (const [i, [x, z]] of ([[-26, -1], [-20, 2], [-26, 7], [-18, 9.5], [-24, 12]] as Array<[number, number]>).entries()) {
    fx(tube(kit, { id: `laundry:tube${i}`, pos: [x, 4.8, z], length: 3, color: 0xa8f0ff, intensity: 0.8, range: 6, flicker: i % 6 === 5 ? 'BUZZ' : 'STEADY', zone: 'laundry', axis: 'x' }));
  }

  // Boiler: bare bulbs on cords; the red DICE neon
  fx(bareBulb(kit, { id: 'boiler:bulb0', pos: [14, 3.0, -25], ceiling: CEILING.boiler, color: 0xffe6b0, intensity: 1.0, range: 6, flicker: 'STEADY', zone: 'boiler' }));
  fx(bareBulb(kit, { id: 'boiler:bulb1', pos: [22, 3.0, -21], ceiling: CEILING.boiler, color: 0xffe6b0, intensity: 1.0, range: 6, flicker: 'BUZZ', zone: 'boiler' }));
  fx(bareBulb(kit, { id: 'boiler:bulb2', pos: [28, 3.0, -27.5], ceiling: CEILING.boiler, color: 0xffe6b0, intensity: 1.0, range: 6, flicker: 'DYING', zone: 'boiler' }));
  const dice = kit.neon({ text: { key: 'prop.sign.dice' }, h: 0.5, color: 0xff4a3a, flicker: 0.3 });
  dice.root.position.set(22, 2.6, -29.8);
  root.add(dice.root);
  lights.push({ id: 'boiler:dice', pos: [22, 2.6, -29.4], color: 0xff4a3a, intensity: 0.7, range: 4, flicker: 'BUZZ', zone: 'boiler' });

  // Slot Gallery: magenta and cyan neon strips along the ceiling
  fx(tube(kit, { id: 'gallery:magenta', pos: [20, 3.7, -9], length: 6, color: 0xff3fa4, intensity: 0.8, range: 6, flicker: 'BUZZ', zone: 'gallery', axis: 'x' }));
  fx(tube(kit, { id: 'gallery:cyan', pos: [20, 3.7, -5], length: 6, color: 0x3fe0ff, intensity: 0.7, range: 6, flicker: 'BUZZ', zone: 'gallery', axis: 'x' }));

  // Wheel House: chandelier under the dome, velvet and gold
  fx(chandelier(kit, { id: 'wheels:chandelier', pos: [21, 5.2, 5.5], r: 1.2, bulbs: 12, ceiling: CEILING.wheels, color: 0xfff0c8, intensity: 1.2, range: 8, zone: 'wheels', tiers: 1 }));

  // Parlour: one bare bulb on a swinging cord (±12°, period 3.1 s), the Devil's eyes
  const pivot = kit.group('parlourPivot');
  pivot.position.set(19.5, CEILING.parlour, 16);
  kit.cyl(0.006, 0.006, CEILING.parlour - 2.2, kit.pal.black, { pos: [0, -(CEILING.parlour - 2.2) / 2, 0], parent: pivot, seg: 4 });
  const pBulb = kit.lamp({ r: 0.1, color: 0xffd9a0, shape: 'bulb' });
  pBulb.root.position.set(0, -(CEILING.parlour - 2.2), 0);
  pivot.add(pBulb.root);
  root.add(pivot);
  updates.push({ update: (_dt, t) => { pivot.rotation.z = Math.sin((t / 3.1) * Math.PI * 2) * (12 * Math.PI / 180); pBulb.setOn(flickerLevel('STEADY', t) > 0.5); } });
  lights.push({ id: 'parlour:bulb', pos: [19.5, 2.2, 16], color: 0xffd9a0, intensity: 1.1, range: 5, flicker: 'STEADY', zone: 'parlour' });
  const eyes = kit.group('devilEyes');
  for (const dz of [-0.14, 0.14]) {
    const e = kit.lamp({ r: 0.04, color: 0xff1a1a, shape: 'dome' });
    e.root.position.set(26.2, 1.8, 16 + dz);
    eyes.add(e.root);
  }
  root.add(eyes);
  lights.push({ id: 'parlour:devil', pos: [26.2, 1.8, 16], color: 0xff1a1a, intensity: 0.5, range: 4, flicker: 'SICK', zone: 'parlour' });

  // Counting Room: candle clusters, the furnace glow
  for (const [i, [x, z]] of ([[-26, 16.5], [-18, 15.5], [-23, 18.5]] as Array<[number, number]>).entries()) {
    const c = kit.lamp({ r: 0.05, color: 0xffcf7a, shape: 'dome' });
    c.root.position.set(x, 1.1, z);
    root.add(c.root);
    lights.push({ id: `counting:candle${i}`, pos: [x, 1.2, z], color: 0xffcf7a, intensity: 0.5, range: 2.5, flicker: 'CANDLE', zone: 'counting' });
  }
  const furnace = buildFurnace(kit, tex, { pos: [-30, 0, 18.5], rotY: 90 });
  root.add(furnace.root);
  lights.push({ id: 'counting:furnace', pos: [-29.1, 0.8, 18.5], color: 0xff5a1a, intensity: 1.0, range: 5, flicker: 'CANDLE', zone: 'counting' });
  anchors.furnace = furnace.root;

  // ── the Collector's chair, the brass X plate, JACK·ID ────────────────────────────────────────
  const chair = buildCollectorChair(kit, { pos: [29.5, 0, 19], rotY: 270 });
  root.add(chair);
  anchors.collector = chair;
  const xPlate = buildXPlate(kit, { pos: [0, 0, -27] });
  root.add(xPlate);
  anchors.x = xPlate;
  const jack = kit.neon({ text: 'JACK·ID', h: 0.75, color: 0xff3fa4, flicker: 0.2 });
  jack.root.position.set(0, 7.0, 1.85);
  jack.root.rotation.y = Math.PI;
  root.add(jack.root);
  anchors.jack = jack.root;

  // ── rooms (WAVE 24 §2): grille plates and marquees, Jade / Wash / Boiler / Counting dressing, note anchors ──
  const rooms: RoomsBuild = buildRooms({
    kit, tex, seed: ctx.seed, chair, sumpPos: SUMP_POS,
    isOpen: (z) => ctx.isZoneOpen?.(z) ?? true,
    interact: ctx.interact, lights: ctx.lights,
  });
  root.add(rooms.root);
  lights.push(...rooms.lights);
  Object.assign(anchors, rooms.anchors);
  statics.push(...rooms.statics);
  updates.push({ update: (dt, time) => rooms.update(dt, time) });
  disposables.push(rooms);

  // ── plaques and signage (zones, shops, doors) ────────────────────────────────────────────────
  const plaque = (key: string, w: number, h: number, x: number, y: number, z: number, rot: 0 | 90 | 180 | 270, color: number) => {
    const p = kit.label({ text: { key }, w, h, color, bg: 0x1a120c });
    p.mesh.position.set(x, y, z);
    p.mesh.rotation.y = (rot * Math.PI) / 180;
    root.add(p.mesh);
  };
  plaque('prop.sign.cashier', 1.6, 0.4, 6, 2.6, 19.8, 180, 0xffe0a0);
  plaque('prop.sign.charm', 1.6, 1.0, -9, 1.4, 19.84, 180, 0xffe0a0);
  plaque('prop.sign.lift', 0.5, 0.25, -6.4, 1.6, -29.8, 0, 0xffb000);
  plaque('prop.sign.parlour', 2.6, 0.35, 10.8, 3.7, 16, 270, 0xff8a8a);
  plaque('prop.sign.keno', 3.0, 1.8, -20, 2.8, -1.84, 0, 0xffe0a0);

  // ── spawns (GDD §8.8): SP-0 first, then the burst arc; mouth rows; lift car; trapdoor ghost ──
  const spawns: Partial<Record<'solo' | 'mouth' | 'lift' | 'ghost', SpawnPoint[]>> = {
    // Solo spawns face THE BIG ONE (WELL-01 dais), so a new player sees the marquee first. Forward is (-sin yaw, -cos yaw).
    solo: [[0, -7.8], [0.5, -7.77], [-0.5, -7.77], [1.45, -7.51], [-1.45, -7.51], [2.31, -7.01], [-2.31, -7.01], [3.01, -6.31], [-3.01, -6.31]]
      .map(([x, z]) => ({ pos: [x, 0, z] as V3, yaw: Math.atan2(-(WELL_DAIS.x - x), -(WELL_DAIS.z - z)) })),
    mouth: [-27.5, -26.3].flatMap((z) => [-6.25, -4.75, -3.25, -1.75].map((x) => ({ pos: [x, 0, z] as V3, yaw: Math.PI }))),
    lift: [-31.8, -30.9].flatMap((z) => [-4.75, -4.25, -3.75, -3.25].map((x) => ({ pos: [x, 0, z] as V3, yaw: Math.PI }))),
    ghost: [{ pos: [HERO_PLATE.x, 1.0, HERO_PLATE.z], yaw: 0 }],
  };

  // ── anchors (cutscene targets) ─────────────────────────────────────────────────────────────
  const marker = (x: number, y: number, z: number): THREE.Object3D => { const o = new THREE.Object3D(); o.position.set(x, y, z); root.add(o); return o; };
  anchors.terminal = marker(0, 1.2, -29.0);
  anchors.trapdoor = trapdoor.root;
  anchors['elevator.door'] = marker(-4, 1.3, -30);
  anchors.elevator = elevator.root;
  anchors.clock = clock.root;
  anchors.quotaBoard = board.root;
  anchors.sump = sump.root;
  anchors['parlour.curtain'] = curtain.root;
  anchors['mgmt.door'] = mgmt.root;
  anchors.hotline = marker(4, 1.2, -29.0);
  // Wave 25: where the Tally Bench duel scenes look (story/duels/rivals.ts venue): the three duel tables, and the Wash and Counting Room for phase 2
  anchors['duel.parlour'] = marker(26.3, 1.1, 18.6);
  anchors['duel.cards'] = marker(-16, 1.1, -9);
  anchors['duel.boiler'] = marker(22, 1.1, -17.05);
  anchors['duel.laundry'] = marker(-24.5, 1.1, 5);
  anchors['duel.counting'] = marker(-20, 1.1, 18.95);
  anchors['duel.bench'] = anchors['duel.parlour'];

  // ── props map (PropId lookups) ─────────────────────────────────────────────────────────────
  const props: Record<string, WorldProp> = {
    clock,
    trapdoor,
    elevator,
    quotaBoard: board,
    sump,
    parlourCurtain: curtain,
    managementDoor: mgmt,
  };

  // ── finish: merge the static shell into a few draw calls (fixtures and props stay separate) ──────
  kit.finalize(statical);

  // Fixture light levels are boosted once here, so each fixture keeps its own tuning in the table above.
  const boosted: LightHint[] = lights.map((l) => ({
    ...l,
    intensity: (l.intensity ?? 1.2) * FIXTURE_GAIN,
    range: (l.range ?? 8) * FIXTURE_RANGE,
  }));

  return {
    root,
    statics,
    lights: boosted,
    anchors,
    props,
    gates,
    spawns,
    update(dt: number, t: number) {
      for (const u of updates) u.update(dt, t);
    },
    dispose() {
      for (const d of disposables) d.dispose();
      disposeTree(root);
    },
  };
}

