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
import { log } from '@/core/log';
import { app } from '@/core/app';
import type { GateDef, LevelBuild, LevelCtx, LightHint, SpawnPoint } from './sys/arch';
import type { WorldProp } from './types';
import { ZONES, SIGNPOSTS, STAGE_SLOTS, FLOOR_TILE_M, BAR_POS, LIFT_DOOR } from './layout';
import { bareBulb, builtFixtures, chandelier, flickerLevel, pendant, registerLamp, resetFixtures, sconce, tube } from './lights';
import { buildColumn, buildGrille, buildVelvetCurtain, buildManagementDoor, buildSump, buildFurnace, buildCollectorChair, buildXPlate, disposeTree, SUMP_HALF, SUMP_WALL_H, SUMP_WALL_T, type GateProp } from './props/decor';
import { createClock, type WallClock } from './props/clock';
import { createTrapdoor, type Trapdoor } from './props/trapdoor';
import { createElevator, type Elevator } from './props/elevator';
import { createQuotaBoard, type QuotaBoard } from './props/quotaBoard';
import { buildStage, buildJackpotWall, buildPrizeCase, buildBalcony, createLightShow, PRIZE_CASE, STAGE, type ShowTarget } from './props/grand';
import { buildSignposts } from './props/signposts';
import { crispLabel, crispNeon } from './props/signs';
import { buildCeilingDressing, buildBalconyUndersides, buildCeilingRoses, buildCeilingSteps, type CeilingStep } from './props/ceiling';
import { buildLastCallBell } from './props/bell';
import { buildLounge } from './props/lounge';
import { planLounge, slotRect, slotBody, DOORS, type Rect } from './props/loungePlan';
import { damaskTex, wainscotTex, cofferTex, worldUV, WAINSCOT_TILE } from './props/surfaces';
import { buildBar } from './props/bar';
import { buildAmbience, type Beam, type Pool } from './props/ambience';
import { buildRooms, type RoomsBuild } from './rooms';
import { buildHollow } from './hollow';
import { buildHome } from './home';
import { buildStreet } from './street';
import { createNightCycle, nightPhaseOf, LEVELS, type NightPhase, type Spot } from './nightLights';

// ── constants ───────────────────────────────────────────────────────────────────────────────────
const T = 0.3;            // wall thickness (GDD §8.1)
const WALL_H = 9;         // walls run to the tallest ceiling; ceilings hide the rest
const LINTEL_Y = 3.2;     // doorway header
const HERO_PLATE = { x: 0, z: 12 };   // hero trapdoor (Lobby centre); the Sump lies under it
const SUMP_POS: V3 = [0, -30, 12];
const WELL_DAIS = { x: 0, z: -4 };
const STAGE_X = STAGE.x, STAGE_Z = STAGE.z;    // WELL-01 dais 4 × 4 × 0.15
/** Playtest lift (director): the pit read as too dark. Every fixture hint gets this intensity and reach gain. */
const FIXTURE_GAIN = 1.8;
const FIXTURE_RANGE = 1.2;

// parlour and counting rose to 3.2 in wave 81: below the 3.2 m doorway lintel the wing ceiling left a slot into the black attic
const CEILING: Record<string, number> = {
  mouth: 6.0, well: 9.0, lobby: 4.5, midway: 4.0, cards: 3.2, laundry: 5.0, boiler: 3.6,
  gallery: 4.0, wheels: 6.0, parlour: 3.2, counting: 3.2, lift: 2.6,
};

/** Floor texture per zone (ART_BIBLE §6.1 / GDD §8.3 floor themes). Every map is 64 px and repeats every FLOOR_TILE_M, so all floors share one texel density. */
const GOLD = 0xc89c3c, TEAL = 0x2aa898;
function floorTex(id: string, tex: TexGen): { map: THREE.Texture; color: number } {
  const v = (p: string): THREE.Texture => tex.vendor(p, { size: 64 });
  switch (id) {
    case 'mouth': case 'well': case 'lobby': return { map: tex.carpet('diamond', [0x6e1426, 0x45091a, GOLD, TEAL]), color: 0xffffff };   // one burgundy nave carpet, gold and teal motifs
    case 'midway': return { map: tex.carpet('stars', [0x34186a, 0x4c2a90, GOLD, TEAL]), color: 0xffffff };
    case 'cards': return { map: tex.carpet('diamond', [0x0f5a38, 0x083a22, 0xe0c060, 0x60d0b0]), color: 0xffffff };
    case 'laundry': return { map: v('sbs-horror/128x128/Floor/Horror_Floor_12-128x128.png'), color: 0xa8d4dc };   // stone tile, cool tint
    case 'boiler': return { map: v('sbs-synthetic/128x128/Metal/Synth-Metal_05-128x128.png'), color: 0xd8a888 };   // warm steel plate
    case 'gallery': return { map: tex.carpet('stars', [0x201a5a, 0x342c90, GOLD, TEAL]), color: 0xffffff };
    case 'wheels': return { map: tex.carpet('diamond', [0x7a1c14, 0x4a0e0a, GOLD, TEAL]), color: 0xffffff };
    case 'counting': return { map: v('sbs-synthetic/128x128/Wood/Synth-Wood_14-128x128.png'), color: 0xb08858 };   // counting-house boards
    default: return { map: v('sbs-tiny2/128x128/Wood/Wood_03-128x128.png'), color: 0xc89868 };                    // parlour boards (and the lift niche)
  }
}

// ── UV helpers: world-unit tiling on kit primitives (their UVs are 0…1 per face); boxes use `worldUV` (props/surfaces.ts) ──
function planeWorldUV(mesh: THREE.Mesh, w: number, h: number, tile: number, u0 = 0, v0 = 0): void {
  const geo = mesh.geometry as THREE.BufferGeometry;
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + w / 2 + u0) / tile, (pos.getY(i) + h / 2 + v0) / tile);
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
function horizontal(kit: KitX, r: R4, y: number, mat: THREE.Material, up: boolean, tile: number, parent: THREE.Object3D, worldAligned = false): THREE.Mesh {
  const w = r[2] - r[0], d = r[3] - r[1];
  const m = kit.plane(w, d, mat, { rot: [up ? -90 : 90, 0, 0], pos: [(r[0] + r[2]) / 2, y, (r[1] + r[3]) / 2], parent, segW: Math.max(1, Math.round(w / 4)), segH: Math.max(1, Math.round(d / 4)) });
  // the plane's local x/y span w and d before its rotation; a floor is aligned to the world (u = x, v = -z) so split pieces and neighbours keep one phase
  if (worldAligned) planeWorldUV(m, w, d, tile, r[0], -r[3]); else planeWorldUV(m, w, d, tile);
  return m;
}

// ── ambience (props/ambience.ts): floor pools under the fixed lamps, haze cones under the main pendants and the stage spot ──
const WARM = 0x4a3010, SOFT = 0x3a2a12;
const FIXTURE_POOLS: readonly Pool[] = [
  { x: -6, z: -24, r: 2.4, color: WARM }, { x: 6, z: -24, r: 2.4, color: WARM },                       // Mouth pendants
  { x: 0, z: -4, r: 4.2, color: SOFT },                                                                 // Well chandelier
  { x: STAGE.x, z: STAGE.z - 2.3, r: 2.0, color: SOFT },                                                // Lobby chandelier, on the apron
  { x: STAGE.x, z: STAGE.z - 0.3, r: 1.3, color: 0x1c2a34, y: STAGE.h + 0.012 },                        // the Compere's spot, on the boards
  { x: -6, z: 13.3, r: 1.7, color: WARM },                                                              // the bar
  { x: -10.2, z: 2.6, r: 1.0, color: SOFT }, { x: 10.2, z: 2.6, r: 1.0, color: SOFT },                  // Lobby sconces
  ...([[-24, -9], [-16, -15], [-16, -3]] as const).map(([x, z]) => ({ x, z, r: 1.6, color: 0x14361c })),   // Card Room bankers
  ...([[14, -25], [22, -21], [28, -27.5]] as const).map(([x, z]) => ({ x, z, r: 1.7, color: 0x40240c })),  // Boiler bulbs
  ...([[-26, -1], [-20, 2], [-26, 7], [-18, 9.5], [-24, 12]] as const).map(([x, z]) => ({ x, z, r: 2.0, color: 0x10303a })),   // Laundry tubes
  { x: 20, z: -9, r: 2.3, color: 0x3a1030 }, { x: 20, z: -5, r: 2.3, color: 0x10363c },                 // Gallery neon
  { x: 21, z: 5.5, r: 2.8, color: SOFT }, { x: 19.5, z: 16, r: 1.6, color: WARM }, { x: -20, z: 15.5, r: 1.5, color: WARM },
];
const HAZE: readonly Beam[] = [
  { x: -6, z: -24, y0: 4.8, y1: 0.05, r0: 0.25, r1: 1.9, color: 0x160e06 }, { x: 6, z: -24, y0: 4.8, y1: 0.05, r0: 0.25, r1: 1.9, color: 0x160e06 },
  { x: STAGE.x, z: STAGE.z - 0.4, y0: 3.9, y1: STAGE.h + 0.01, r0: 0.15, r1: 1.0, color: 0x0e161a },
];

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
    worldUV(m, 2);
    w.meshes.push(m);
    if (p.y0 === 0) {
      // 2 cm longer than its wall piece at each end: at a doorway jamb the wall's end face and the wainscot's were one plane
      const wl = len + 0.04;
      const wm = w.kit.box(axis === 'z' ? T + 0.04 : wl, 1.2, axis === 'z' ? wl : T + 0.04, w.wain, { pos: axis === 'z' ? [c, 0.6, mid] : [mid, 0.6, c], parent: w.root });
      worldUV(wm, WAINSCOT_TILE);
      w.meshes.push(wm);
      w.statics.push({ box: new THREE.Box3(new THREE.Vector3(pos[0] - size[0] / 2, 0, pos[2] - size[2] / 2), new THREE.Vector3(pos[0] + size[0] / 2, h, pos[2] + size[2] / 2)), tag: 'solid' });
    }
  }
}

/** How strong the Dawn spill from the lift shaft gets (a faint wash, not a light). */
const MORNING_OPACITY = 0.3;

// ── the level ───────────────────────────────────────────────────────────────────────────────
export function buildLevel(ctx: LevelCtx): LevelBuild {
  const kit = ctx.kit as KitX;
  resetFixtures();   // the night cycle switches every fixture this build makes
  const tex = kit.tex;   // the tile-tagged TexGen: the raw one left every prop texture stretched once over its whole face (grilles, curtain, shaft, sump)
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
  // ART.md §3: damask wallpaper above a walnut wainscot (world-mapped, 32 texels per metre); the wing partitions take the dark colourway
  const wallMatDeco = kit.mat({ color: 0xd4c4b4, map: damaskTex(tex, 'nave') });   // a step under the props, so the paper sits back
  const wallMatOx = kit.mat({ color: 0xe8dccc, map: damaskTex(tex, 'wing') });
  const wainMat = kit.mat({ color: 0xf0e4d8, map: wainscotTex(tex) });
  const coffer = cofferTex(tex);
  // the ceiling carries its own glow (the point lights stand below it and never reached it): emissive from its own pattern
  const ceilMat = kit.mat({ map: coffer, color: 0xd8c8a8, emissive: 0xffffff, emissiveMap: coffer, emissiveIntensity: 0.5 });
  const ceilFar = kit.mat({ map: coffer, color: 0xd8c8a8, emissive: 0xffffff, emissiveMap: coffer, emissiveIntensity: 0.32 });   // the Underneath and the apartment keep their dark ceilings
  // the tall rooms (Mouth, Well, Wheel House) sit far above the light pool, so their ceilings glow a little more on their own
  const ceilTall = kit.mat({ map: coffer, color: 0xe0d0a8, emissive: 0xffffff, emissiveMap: coffer, emissiveIntensity: 0.7 });
  const wf: WallCtx = { kit, root: shell, wall: wallMatDeco, wain: wainMat, statics, meshes: [] };

  // floors: walkable boxes (top y 0) and visuals, split around the hero trapdoor hole in the Lobby;
  // ceilings: one plane per zone at its height, never holed
  for (const z of ZONES) {
    const own = z.id === 'home' || z.id === 'hollow' || z.id === 'street';   // the apartment, the Underneath and the street build their own floor and ceiling (a second floor at y 0 z-fought in the flat)
    const ft = floorTex(z.id, tex);
    const fmat = kit.mat({ color: ft.color, map: ft.map });
    for (const piece of rectMinus(z.rect as R4, z.id === 'lobby' ? hole : null)) {
      if (!own) horizontal(kit, piece, 0, fmat, true, FLOOR_TILE_M, statical, true);
      statics.push({ box: box3(piece[0], -0.5, piece[1], piece[2], 0, piece[3]), tag: 'walkable' });
    }
    const ch = CEILING[z.id];
    if (!own) horizontal(kit, z.rect as R4, ch ?? 4.5, ch === undefined ? ceilFar : ch >= 6 ? ceilTall : ceilMat, false, 2, shell);
  }

  // coffered beams, lit bay panels, hanging lamps, vents and cables under every zone ceiling (wave 77: no more dark void)
  buildCeilingDressing(kit, tex, {
    parent: statical,
    zones: ZONES.filter((z) => z.id in CEILING && z.id !== 'lift').map((z) => ({ id: z.id, rect: z.rect as R4, h: CEILING[z.id] })),
    avoid: [
      [0, -4, 3.8], [-5, -11, 2.2], [5, -11, 2.2], [STAGE_X, STAGE_Z - 0.9, 2.4], [21, 5.5, 2.2], [0, 1.6, 3.6],
      [-6, -24, 1.4], [6, -24, 1.4], [14, -25, 1.3], [22, -21, 1.3], [28, -27.5, 1.3],
      ...SIGNPOSTS.map((s) => [s.pos[0], s.pos[2], 1.8] as const),
    ],
  });
  buildBalconyUndersides(kit, statical, { y: 6.4, z0: -17.4, z1: 1.4 });
  // the nave ceilings step (Mouth 6 -> Well 9 -> Lobby 4.5): without a wall at each step the black attic showed through above the
  // lower ceiling, with the JACK·ID neon and the signs hanging in front of it. Close both steps and dress their faces.
  const STEPS: readonly CeilingStep[] = [
    { z: -18.1, dir: 1, y0: CEILING.mouth, y1: CEILING.well },
    { z: 2.1, dir: -1, y0: CEILING.lobby, y1: CEILING.well, sunY: 7.0 },
  ];
  for (const st of STEPS) {
    const body = kit.box(22, st.y1 - st.y0 + 0.02, T, wallMatDeco, { pos: [0, (st.y0 - 0.02 + st.y1) / 2, st.z], parent: shell });
    worldUV(body, 2);
  }
  // the finishing pieces are decoration: a failure here must never drop the whole pit to the fallback hall
  try {
    buildCeilingSteps(kit, statical, { x0: -10.85, x1: 10.85, steps: STEPS });
    buildCeilingRoses(kit, statical, [
      { x: 0, z: -4, H: CEILING.well, r: 1.85 }, { x: 0, z: 13.25, H: CEILING.lobby, r: 1.5 }, { x: 0, z: -24, H: CEILING.mouth, r: 1.6 },
    ]);
  } catch (e) { log.error('world', 'ceiling finish failed', e); }

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

  const sump = buildSump(kit, tex, { pos: SUMP_POS, seed: ctx.seed ^ 0x51ab, coinCount: 350 });
  root.add(sump.root);
  disposables.push(sump);
  // the sump walls are solid; the floor is registered above
  // (the same SUMP_* constants size the drawn walls in props/decor.ts, so the colliders sit exactly on them)
  {
    const o = SUMP_HALF + SUMP_WALL_T, y1 = SUMP_POS[1] + SUMP_WALL_H, [cx, y0, cz] = SUMP_POS;
    statics.push({ box: box3(cx - o, y0, cz - o, cx + o, y1, cz - SUMP_HALF), tag: 'solid' });
    statics.push({ box: box3(cx - o, y0, cz + SUMP_HALF, cx + o, y1, cz + o), tag: 'solid' });
    statics.push({ box: box3(cx - o, y0, cz - SUMP_HALF, cx - SUMP_HALF, y1, cz + SUMP_HALF), tag: 'solid' });
    statics.push({ box: box3(cx + SUMP_HALF, y0, cz - SUMP_HALF, cx + o, y1, cz + SUMP_HALF), tag: 'solid' });
  }
  const sumpLamps: Array<[number, number]> = [[-5.4, 5.4], [5.4, 5.4], [-5.4, -5.4], [5.4, -5.4]];
  for (const [i, [lx, lz]] of sumpLamps.entries()) {
    lights.push({ id: `sump:cage${i}`, pos: [SUMP_POS[0] + lx, -27, SUMP_POS[2] + lz], color: 0xffb45a, intensity: 1.3, range: 8, flicker: 'DYING' });   // no zone: it resolves to the lobby above (the Sump is not a zone)
  }
  const exit = crispNeon(kit, { text: { key: 'prop.sign.exit' }, h: 0.45, color: 0xff3a2a, flicker: 0.4, font: 'chetyre' });
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
  { const sp = buildSignposts(kit, { ceilingAt: (_x: number, z: number) => (z < -18 ? CEILING.mouth : z < 2 ? CEILING.well : CEILING.lobby) }); root.add(sp.root); disposables.push(sp); }
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
  lights.push({ id: 'mouth:lift', pos: [-4, 2.4, -31.1], color: 0xfff2d0, intensity: 1.0, range: 4, flicker: 'RARE', zone: 'lift' });   // the car's lamp: steady, one stutter a minute or so

  // Well: the chandelier ring (r 3 m, 24 bulbs, y 7.5) and the dais cone
  const wellChandelier = chandelier(kit, { id: 'well:chandelier', pos: [0, 7.5, -4], r: 3.0, bulbs: 24, ceiling: CEILING.well, color: 0xffb347, intensity: 1.6, range: 12, zone: 'well', tiers: 2 });
  wellChandelier.root.position.set(0, 0, -4);   // the fixture builds around its own origin; (x, z) place it, y is baked in
  fx(wellChandelier);
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
  registerLamp([-21, 3.7, -28.5], (on) => string.pattern(on ? 'chase' : 'off', 4), 'midway');
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
  const dice = crispNeon(kit, { text: { key: 'prop.sign.dice' }, h: 0.5, color: 0xff4a3a, flicker: 0.3, font: 'chetyre' });
  dice.root.position.set(22, 2.6, -29.8);
  root.add(dice.root);
  registerLamp([22, 2.6, -29.8], dice.setOn, 'boiler');
  lights.push({ id: 'boiler:dice', pos: [22, 2.6, -29.4], color: 0xff4a3a, intensity: 0.7, range: 4, flicker: 'BUZZ', zone: 'boiler' });

  // Slot Gallery: magenta and cyan neon strips along the ceiling
  fx(tube(kit, { id: 'gallery:magenta', pos: [20, 3.7, -9], length: 6, color: 0xff3fa4, intensity: 0.8, range: 6, flicker: 'BUZZ', zone: 'gallery', axis: 'x' }));
  fx(tube(kit, { id: 'gallery:cyan', pos: [20, 3.7, -5], length: 6, color: 0x3fe0ff, intensity: 0.7, range: 6, flicker: 'BUZZ', zone: 'gallery', axis: 'x' }));

  // Wheel House: chandelier under the dome, velvet and gold
  { const wc = chandelier(kit, { id: 'wheels:chandelier', pos: [21, 5.2, 5.5], r: 1.2, bulbs: 12, ceiling: CEILING.wheels, color: 0xfff0c8, intensity: 1.2, range: 8, zone: 'wheels', tiers: 1 }); wc.root.position.set(21, 0, 5.5); fx(wc); }

  // Parlour: one bare bulb on a swinging cord (±12°, period 3.1 s), the Devil's eyes
  const pivot = kit.group('parlourPivot');
  pivot.position.set(19.5, CEILING.parlour, 16);
  kit.cyl(0.006, 0.006, CEILING.parlour - 2.2, kit.pal.black, { pos: [0, -(CEILING.parlour - 2.2) / 2, 0], parent: pivot, seg: 4 });
  const pBulb = kit.lamp({ r: 0.1, color: 0xffd9a0, shape: 'bulb' });
  pBulb.root.position.set(0, -(CEILING.parlour - 2.2), 0);
  pivot.add(pBulb.root);
  root.add(pivot);
  let parlourLit = true;   // the night cycle (registerLamp): the flicker below must not relight it at Dawn
  registerLamp([19.5, 2.2, 16], (on) => { parlourLit = on; if (!on) pBulb.setOn(false); }, 'parlour');
  updates.push({ update: (_dt, t) => { pivot.rotation.z = Math.sin((t / 3.1) * Math.PI * 2) * (12 * Math.PI / 180); if (parlourLit) pBulb.setOn(flickerLevel('STEADY', t) > 0.5); } });
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
    registerLamp([x, 1.1, z], c.setOn, 'counting');
    lights.push({ id: `counting:candle${i}`, pos: [x, 1.2, z], color: 0xffcf7a, intensity: 0.5, range: 2.5, flicker: 'CANDLE', zone: 'counting' });
  }
  const furnace = buildFurnace(kit, tex, { pos: [-30, 0, 18.5], rotY: 90 });
  root.add(furnace.root);
  statics.push({ box: box3(-30.6, 0, 17.7, -29.4, 2.4, 19.3), tag: 'solid' });   // rotY 90: the 1.6 m face lies along z
  lights.push({ id: 'counting:furnace', pos: [-29.1, 0.8, 18.5], color: 0xff5a1a, intensity: 1.0, range: 5, flicker: 'CANDLE', zone: 'counting' });
  anchors.furnace = furnace.root;

  // ── the Collector's chair, the brass X plate, JACK·ID ────────────────────────────────────────
  const chair = buildCollectorChair(kit, { pos: [29.5, 0, 19], rotY: 270 });
  root.add(chair);
  statics.push({ box: box3(29.2, 0, 18.7, 29.8, 1.0, 19.3), tag: 'solid' });
  anchors.collector = chair;
  const xPlate = buildXPlate(kit, { pos: [0, 0, -27] });
  root.add(xPlate);
  anchors.x = xPlate;
  const jack = crispNeon(kit, { text: 'JACK·ID', h: 0.75, color: 0xff3fa4, flicker: 0.2 });
  jack.root.position.set(0, 7.0, 1.85);
  jack.root.rotation.y = Math.PI;
  root.add(jack.root);
  anchors.jack = jack.root;

  // ── the LAST CALL BELL on its counter beside the Debt Terminal (anchor 'bell', prop 'lastCallBell'; wave 77) ──
  const bell = buildLastCallBell(kit, { interact: ctx.interact });
  root.add(bell.prop.root, bell.anchor);
  anchors.bell = bell.anchor;
  lights.push(...bell.hints);
  statics.push(...bell.statics);
  updates.push({ update: (dt) => bell.prop.update?.(dt) });
  disposables.push(bell.prop);

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

  // ── THE HOLLOW DOOR (world/hollow): the cracked plate in the Sump, THE UNDERNEATH far below, the Lords' table ──
  const hollow = buildHollow({ kit, tex, seed: ctx.seed, interact: ctx.interact, collision: ctx.collision });
  root.add(hollow.root);
  lights.push(...hollow.lights);
  statics.push(...hollow.statics);
  Object.assign(anchors, hollow.anchors);
  updates.push({ update: (dt, time) => hollow.update(dt, time) });
  disposables.push(hollow);

  // ── THE APARTMENT (world/home): far offset at HOME_ORIGIN, reached by the lift after a Night (wave 69 Home layer) ──
  const home = buildHome({ kit, tex, seed: ctx.seed, interact: ctx.interact, collision: ctx.collision, lights: ctx.lights });
  root.add(home.root);
  lights.push(...home.lights);
  statics.push(...home.statics);
  Object.assign(anchors, home.anchors);
  updates.push({ update: (dt, time) => home.update(dt, time) });
  disposables.push(home);
  // ── THE WALK HOME (world/street): the block's corridor, the night street and the casino's street door, beside the flat ──
  const street = buildStreet({ kit, tex, seed: ctx.seed, interact: ctx.interact, collision: ctx.collision });
  root.add(street.root);
  lights.push(...street.lights);
  statics.push(...street.statics);
  Object.assign(anchors, street.anchors);
  updates.push({ update: (dt, time) => street.update(dt, time) });
  disposables.push(street);

  // ── plaques and signage (zones, shops, doors) ────────────────────────────────────────────────
  const plaque = (key: string, w: number, h: number, x: number, y: number, z: number, rot: 0 | 90 | 180 | 270, color: number) => {
    const p = crispLabel(kit, { text: { key }, w, h, color, bg: 0x1a120c, frame: 0x8c6b29, font: 'public' });
    p.mesh.position.set(x, y, z);
    p.mesh.rotation.y = (rot * Math.PI) / 180;
    root.add(p.mesh);
  };
  plaque('prop.sign.cashier', 1.6, 0.4, 6, 3.55, 19.84, 180, 0xffe0a0);   // over the booth (3.2 m), not behind its header
  plaque('prop.sign.charm', 1.6, 1.0, -9, 1.4, 19.84, 180, 0xffe0a0);
  plaque('prop.sign.lift', 0.5, 0.25, -6.4, 1.6, -29.8, 0, 0xffb000);
  plaque('prop.sign.parlour', 2.6, 0.35, 10.62, 4.06, 16, 270, 0xff8a8a);   // above the door casing's cornice (3.77)
  plaque('prop.sign.keno', 2.0, 1.2, -20, 3.3, -1.84, 0, 0xffe0a0);   // smaller and higher: it used to fill the view at LAU-02 and cover the buy prompt

  // ── the casino bar (Lobby, behind the stage): a walnut and marble counter, a mirrored back bar of lit bottles, three stools (props/bar.ts) ──
  // The customers' side faces the stage (north); the counter is 4.4 m long, the back bar stands behind it, a service cabinet ends the bar.
  {
    const BAR_X = BAR_POS.x, BAR_Z = BAR_POS.z;
    buildBar(kit, { parent: statical, root, x: BAR_X, z: BAR_Z });
    statics.push({ box: box3(BAR_X - 2.25, 0, BAR_Z - 0.55, BAR_X + 2.25, 1.0, BAR_Z + 0.55), tag: 'solid' });
    statics.push({ box: box3(BAR_X - 2.0, 0, BAR_Z + 0.7, BAR_X + 2.0, 2.3, BAR_Z + 1.7), tag: 'solid' });
    statics.push({ box: box3(BAR_X + 2.5, 0, BAR_Z - 0.35, BAR_X + 3.2, 1.1, BAR_Z + 0.35), tag: 'solid' });
    lights.push({ id: 'lobby:bar', pos: [BAR_X, 2.3, BAR_Z - 0.6], color: 0xffb870, intensity: 0.9, range: 5, flicker: 'STEADY', zone: 'lobby' });
  }

  // ── Wave 72: the lit route from the lift past the terminal to the Big One, a key light per area, a neon sign per area ──
  lights.push({ id: 'route:lift', pos: [-4, 2.8, -27.2], color: 0xffe0a0, intensity: 1.3, range: 6, flicker: 'STEADY' });
  lights.push({ id: 'route:term', pos: [-1.5, 3.0, -25], color: 0xffc861, intensity: 1.2, range: 6, flicker: 'STEADY' });
  lights.push({ id: 'route:mouth', pos: [0, 3.4, -20.5], color: 0xffc861, intensity: 1.2, range: 7, flicker: 'STEADY' });
  lights.push({ id: 'route:well', pos: [0, 3.6, -14], color: 0xffd98a, intensity: 1.2, range: 7, flicker: 'STEADY' });
  lights.push({ id: 'well:flankW', pos: [-8, 3.2, -8], color: 0xff9a5a, intensity: 0.9, range: 6, flicker: 'STEADY' });
  lights.push({ id: 'well:flankE', pos: [8, 3.2, -8], color: 0xff9a5a, intensity: 0.9, range: 6, flicker: 'STEADY' });
  lights.push({ id: 'lobby:stage', pos: [0, 3.4, 11], color: 0xffe2a0, intensity: 1.3, range: 9, flicker: 'STEADY' });
  lights.push({ id: 'lobby:vendorW', pos: [-6, 2.8, 17], color: 0xfff2c0, intensity: 0.9, range: 5, flicker: 'STEADY' });
  lights.push({ id: 'lobby:vendorE', pos: [6, 2.8, 17], color: 0xfff2c0, intensity: 0.9, range: 5, flicker: 'STEADY' });
  lights.push({ id: 'midway:key', pos: [-21, 2.8, -23], color: 0xff6aa8, intensity: 0.9, range: 7, flicker: 'STEADY', zone: 'midway' });
  lights.push({ id: 'cards:key', pos: [-21, 2.6, -9], color: 0x9affb0, intensity: 0.9, range: 7, flicker: 'STEADY', zone: 'cards' });
  lights.push({ id: 'boiler:key', pos: [20, 2.6, -22], color: 0xff8a50, intensity: 0.9, range: 7, flicker: 'STEADY', zone: 'boiler' });
  lights.push({ id: 'wheels:key', pos: [21, 3.0, 3], color: 0xffa060, intensity: 0.9, range: 7, flicker: 'STEADY', zone: 'wheels' });
  lights.push({ id: 'parlour:sconce', pos: [14.5, 1.9, 16], color: 0xffb070, intensity: 0.9, range: 5, flicker: 'CANDLE', zone: 'parlour' });
  lights.push({ id: 'parlour:lamp', pos: [24, 2.0, 16.5], color: 0xffb070, intensity: 0.8, range: 5, flicker: 'CANDLE', zone: 'parlour' });
  lights.push({ id: 'counting:lamp', pos: [-20, 2.0, 15.5], color: 0xffcf7a, intensity: 0.8, range: 5, flicker: 'CANDLE', zone: 'counting' });
  {
    // one neon per area: ARRIVALS over the Mouth starters, THE WELL on both Well walls, THE LOBBY on both Lobby walls, BACK OF HOUSE above the Mouth wings
    const area = (id: string, key: string, h: number, color: number, pos: V3, yaw: number): void => {
      const n = crispNeon(kit, { text: { key }, h, color, flicker: 0.1, font: 'chetyre' });
      n.root.position.set(pos[0], pos[1], pos[2]);
      n.root.rotation.y = yaw;
      n.setOn(true);
      root.add(n.root);
      registerLamp(pos, n.setOn);   // its zone is the one the sign hangs in
      const nx = Math.sin(yaw) * 0.8, nz = Math.cos(yaw) * 0.8;   // the light stands a little in front of the sign
      lights.push({ id: `sign:${id}`, pos: [pos[0] + nx, pos[1] - 0.3, pos[2] + nz], color, intensity: 0.8, range: 6, flicker: 'STEADY' });
    };
    const E = Math.PI / 2;   // faces +x (a sign on a west wall); -E faces -x (an east wall)
    area('arrivals', 'prop.sign.arrivals', 0.5, 0xffb347, [-8.5, 3.5, -29.75], 0);
    area('wellW', 'prop.sign.well', 0.7, 0xffd070, [-10.75, 5.4, -9], E);
    area('wellE', 'prop.sign.well', 0.7, 0xffd070, [10.75, 5.4, -9], -E);
    area('lobbyW', 'prop.sign.lobby', 0.5, 0xff9a5a, [-10.75, 3.5, 11], E);
    area('lobbyE', 'prop.sign.lobby', 0.5, 0xff9a5a, [10.75, 3.5, 9.4], -E);   // clear of the Wheel House door casing (z 2.6 … 7.4)
    area('bohW', 'prop.sign.backOfHouse', 0.45, 0xff5a7a, [-10.75, 4.4, -23], E);
    area('bohE', 'prop.sign.backOfHouse', 0.45, 0xff5a7a, [10.75, 4.4, -23], -E);
  }

  // ── spawns (GDD §8.8): SP-0 first, then the burst arc; mouth rows; lift car; trapdoor ghost ──
  const spawns: Partial<Record<'solo' | 'mouth' | 'lift' | 'ghost', SpawnPoint[]>> = {
    // Solo spawns face THE BIG ONE (WELL-01 dais), so a new player sees the marquee first. Forward is (-sin yaw, -cos yaw).
    solo: [[0, -7.8], [0.65, -7.77], [-0.65, -7.77], [1.45, -7.51], [-1.45, -7.51], [2.31, -7.01], [-2.31, -7.01], [3.01, -6.31], [-3.01, -6.31]]
      .map(([x, z]) => ({ pos: [x, 0, z] as V3, yaw: Math.atan2(-(WELL_DAIS.x - x), -(WELL_DAIS.z - z)) })),
    mouth: [-27.5, -26.3].flatMap((z) => [-6.25, -4.75, -3.25, -1.75].map((x) => ({ pos: [x, 0, z] as V3, yaw: Math.PI }))),
    lift: [-31.8, -30.9].flatMap((z) => [-4.75, -4.25, -3.75, -3.25].map((x) => ({ pos: [x, 0, z] as V3, yaw: Math.PI }))),   // 8 car spots (8-player rides); 0.1 m neighbour overlap resolves on the first step
    ghost: [{ pos: [HERO_PLATE.x, 1.0, HERO_PLATE.z], yaw: 0 }],
  };

  // ── Wave 75 GRAND CASINO: balcony rail, atrium stage, jackpot wall, prize case, chandeliers, light show ──
  buildBalcony(kit, statical);
  const stage = buildStage(kit, tex, { root, statical });
  root.add(stage.prop.root);
  disposables.push(stage.prop);
  updates.push({ update: (dt) => stage.prop.update?.(dt) });
  lights.push(...stage.hints);
  statics.push(...stage.statics);
  Object.assign(anchors, stage.anchors);
  const wall = buildJackpotWall(kit, { ceiling: CEILING.well });
  root.add(wall.root);
  disposables.push(wall);
  updates.push({ update: (dt) => wall.update?.(dt) });
  lights.push({ id: 'well:jackpotWall', pos: [0, 3.4, 0.2], color: 0xffb347, intensity: 1.1, range: 7, flicker: 'STEADY', zone: 'well' });
  const prizes = buildPrizeCase(kit, { statical });
  root.add(prizes.prop.root);
  disposables.push(prizes.prop);
  updates.push({ update: (dt) => prizes.prop.update?.(dt) });
  statics.push({ box: box3(PRIZE_CASE.x - PRIZE_CASE.w / 2, 0, PRIZE_CASE.z - PRIZE_CASE.d / 2, PRIZE_CASE.x + PRIZE_CASE.w / 2, PRIZE_CASE.h, PRIZE_CASE.z + PRIZE_CASE.d / 2), tag: 'solid' });
  lights.push({ id: 'lobby:prizeCase', pos: [PRIZE_CASE.x, 1.7, PRIZE_CASE.z - 0.7], color: 0xffe9b0, intensity: 0.7, range: 3.5, flicker: 'STEADY', zone: 'lobby' });
  // the marquee bulbs (footlights, jackpot wall border) follow the night cycle too: the light show's 'all' rest must not relight them at Dawn
  const dimmable = (tg: ShowTarget, at: V3): ShowTarget => {
    let dark = false;
    registerLamp(at, (on) => { dark = !on; tg.pattern(on ? 'all' : 'off'); });
    return { pattern: (p, hz) => tg.pattern(dark ? 'off' : p, hz) };
  };
  const shows: ShowTarget[] = [dimmable(stage.prop.footlights, [0, 1.2, 11]), dimmable(wall.border, [0, 3.4, 0.2])];
  {
    // chandeliers: one over the stage (lit), two small ones over the Well side aisles (visual only, the pool is full enough)
    const lobbyCh = chandelier(kit, { id: 'lobby:chandelier', pos: [STAGE_X, 3.75, STAGE_Z - 0.9], r: 1.5, bulbs: 16, ceiling: CEILING.lobby, color: 0xffd890, intensity: 1.0, range: 8, zone: 'lobby', tiers: 1 });
    lobbyCh.root.position.set(STAGE_X, 0, STAGE_Z - 0.9);   // hung in front of the curtain, over the apron
    fx(lobbyCh);
    if (lobbyCh.pattern) shows.push({ pattern: lobbyCh.pattern });
    for (const [i, sx] of [-5, 5].entries()) {
      const c = chandelier(kit, { id: `well:sideChandelier${i}`, pos: [sx, 6.9, -11], r: 1.2, bulbs: 12, ceiling: CEILING.well, color: 0xffb347, zone: 'well', tiers: 1 });
      c.root.position.set(sx, 0, -11);
      root.add(c.root);
      updates.push({ update: (dt, tt) => c.update?.(dt, tt) });
      if (c.pattern) shows.push({ pattern: c.pattern });
    }
    const wellCh = wellChandelier;
    if (wellCh?.pattern) shows.push({ pattern: wellCh.pattern });
  }
  const lightShow = createLightShow({ targets: shows, lights: ctx.lights, wall });
  updates.push({ update: (dt) => lightShow.update?.(dt) });
  disposables.push(lightShow);

  // ── Wave 81 interior pass: rugs, planters, supper tables, banquettes, lamps, art and a chair rail in the nave, a few props per wing.
  // The plan drops any walking piece that would touch a machine, its standing zone, a column, a doorway lane or the central aisle.
  {
    const blockers: Rect[] = [
      ...ctx.slots.filter((s) => !STAGE_SLOTS.includes(s.id)).map((s) => slotRect(s)),   // the stage stands on FLR-05: it is a lane in the plan
      ...statics.filter((s) => s.tag === 'solid' && s.box.max.y > 0.5 && Math.min(s.box.max.x - s.box.min.x, s.box.max.z - s.box.min.z) > 0.35)
        .map((s): Rect => [s.box.min.x, s.box.min.z, s.box.max.x, s.box.max.z]),
    ];
    try {
      const plan = planLounge(blockers);
      const lounge = buildLounge(kit, { parent: statical, plan, clock: { x: 0, y: 4.3, z: -29.7 } });
      statics.push(...lounge.statics);
      lights.push(...plan.lights);
      // ART.md §5/§6: door casings, a light pool under every lamp, haze under the main pendants, posters by the wing doors
      const lampPools = plan.items.flatMap((it): Pool[] =>
        it.k === 'torch' ? [{ x: it.x, z: it.z, r: 1.3, color: 0x4a3418 }]
          : it.k === 'table' && it.lamp ? [{ x: it.x, z: it.z, r: 1.1, color: 0x3a2812 }]
            : it.k === 'pendant' ? [{ x: it.x, z: it.z, r: 1.2, color: 0x3a2812 }] : []);
      buildAmbience(kit, {
        parent: statical,
        doors: DOORS.flatMap(([z0, z1]) => [{ x: -11, z0, z1 }, { x: 11, z0, z1 }]),
        pools: [...FIXTURE_POOLS, ...lampPools],
        beams: HAZE,
        blockers: ctx.slots.map((s) => slotBody(s)),
      });
    } catch (e) { log.error('world', 'lounge dressing failed', e); }
  }

  // ── anchors (cutscene targets) ─────────────────────────────────────────────────────────────
  const marker = (x: number, y: number, z: number): THREE.Object3D => { const o = new THREE.Object3D(); o.position.set(x, y, z); root.add(o); return o; };
  anchors.terminal = marker(0, 1.2, -29.0);
  anchors.trapdoor = trapdoor.root;
  anchors['elevator.door'] = marker(LIFT_DOOR.x, 1.3, LIFT_DOOR.z);
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
  anchors['duel.laundry'] = marker(-18, 1.1, 4.5);   // Mimosa's table LAU-10 (not the bingo cage LAU-01)
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
    stage: stage.prop,
    jackpotWall: wall,
    prizeCase: prizes.prop,
    lightShow,
    lastCallBell: bell.prop,
  };

  // ── THE NIGHT CYCLE (nightLights.ts): the lights, lamps, ceilings, music and crowd follow the run's phase ──
  if (ctx.lights && !ctx.bench) {
    const lights0 = ctx.lights;
    const pt = (id: string, kind: 'keep' | 'core', x: number, y: number, z: number): [Spot, THREE.Object3D] => [{ id, kind, x, z }, marker(x, y, z)];
    const marks = new Map<string, THREE.Object3D>();
    const zoneAt = (x: number, z: number): string | undefined => ZONES.find((q) => x >= q.rect[0] && x <= q.rect[2] && z >= q.rect[1] && z <= q.rect[3])?.id;
    const spots: Spot[] = ZONES.filter((z) => z.id !== 'home' && z.id !== 'hollow' && z.id !== 'street')
      .map((z) => ({ id: z.id as string, kind: 'floor' as const, x: (z.rect[0] + z.rect[2]) / 2, z: (z.rect[1] + z.rect[3]) / 2 }));
    for (const [spot, obj] of [
      pt('keep:bar', 'keep', BAR_POS.x, 1.8, BAR_POS.z), pt('keep:pawn', 'keep', -6, 1.8, 18.6),
      pt('core:terminal', 'core', 0, 1.8, -28.4), pt('core:lift', 'core', LIFT_DOOR.x, 2.4, LIFT_DOOR.z - 0.6),
    ]) { spots.push(spot); marks.set(spot.id, obj); }
    const settings = (): { calm?: boolean; reduceFlashing?: boolean } | undefined => app.save?.data?.settings;
    const run = (): { shift?: { phase?: string }; nightPaid?: boolean; rules?: { quota?: boolean } } | null => app.run as never;
    const audio = (): typeof app.audio | null => { try { return app.audio ?? null; } catch { return null; } };
    const curPhase = (): NightPhase | null => {
      const r = run();
      return r?.rules?.quota ? nightPhaseOf(r.shift?.phase, !!r.nightPaid) : null;
    };
    const cycle = createNightCycle({
      lights: lights0,
      spots,
      target: (id) => marks.get(id) ?? id,
      phase: curPhase,
      reduced: () => !!(settings()?.calm || settings()?.reduceFlashing),
      busy: () => !!app.cutscene?.playing,
      fixtures: (zone, on) => { for (const f of builtFixtures()) if ((f.zone ?? zoneAt(f.pos[0], f.pos[2])) === zone) f.setOn(on); },
      ringBell: () => bell.prop.ring(),
      audio: {
        sfx: (name) => { try { audio()?.play(name, { vol: 0.7 }); } catch { /* no audio */ } },
        duck: (bus, amount, dur) => { try { audio()?.duck(bus, amount, dur); } catch { /* no audio */ } },
        musicState: () => audio()?.music.state ?? 'silent',
        setMusicState: (s, fade) => { try { audio()?.music.setState(s, { fade }); } catch { /* no audio */ } },
      },
    });
    // the casino's own ceilings glow with the ambient; the flat and the Underneath keep theirs (ceilFar)
    const ceils: Array<[THREE.MeshStandardMaterial, number]> = [[ceilMat as unknown as THREE.MeshStandardMaterial, 0.5], [ceilTall as unknown as THREE.MeshStandardMaterial, 0.7]];
    let ceilK = 1;
    // Dawn: a faint warm morning spill out of the lift shaft, on the floor and in the doorway. The pool lights follow zone levels, so this is
    // two additive planes (no pool light), faded in with the cycle's Dawn and out at the opening.
    const spillMat = kit.mat({
      map: kit.tex.canvas(32, 32, (g, gw, gh) => {
        const grad = g.createRadialGradient(gw / 2, gh / 2, 1, gw / 2, gh / 2, gw / 2);
        grad.addColorStop(0, 'rgba(255,255,255,0.9)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grad; g.fillRect(0, 0, gw, gh);
      }, { wrap: 'clamp' }),
      color: 0xffd9a0, lit: false, additive: true, transparent: true, opacity: 0, affine: false, snap: false, unique: true,
    }) as THREE.MeshBasicMaterial;
    const spill = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 4.6), spillMat);
    spill.rotation.x = -Math.PI / 2;
    spill.position.set(LIFT_DOOR.x, 0.03, LIFT_DOOR.z + 2.2);
    const doorGlow = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 3.2), spillMat);
    doorGlow.position.set(LIFT_DOOR.x, 1.5, LIFT_DOOR.z + 0.3);
    for (const m of [spill, doorGlow]) { m.renderOrder = 1; m.userData.noMerge = true; root.add(m); }
    spill.visible = doorGlow.visible = false;
    let morningK = 0;
    updates.push({
      update: (dt) => {
        cycle.update(dt);
        const ph = curPhase();
        morningK += ((ph === 'dawn' ? 1 : 0) - morningK) * Math.min(1, dt * 0.8);
        spillMat.opacity = MORNING_OPACITY * morningK;
        spill.visible = doorGlow.visible = morningK > 0.01;
        const want = ph ? LEVELS[ph].ambient : 1;
        ceilK += (want - ceilK) * Math.min(1, dt * 1.2);
        for (const [m, base] of ceils) m.emissiveIntensity = base * ceilK;
      },
    });
    disposables.push(cycle);
  }

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

