/**
 * Seating and felt tables: `stool`, `chair` (extra, same family) and `feltTable` (rect / kidney / oval / round / craps).
 *
 * A table is built from ONE outline: felt (concentric ring fan, so vertex lighting has vertices), brass edge line, a
 * padded rail swept around the outline, a walnut apron + legs or pedestal, a dealer chip tray, an optional printed
 * layout decal, and chairs/stools placed along the outline. Origin = floor centre of the footprint (w × d includes the
 * rail), +Z = the side the first seats face, the dealer stands at −Z. Seats are listed left → right (−X → +X).
 *
 * Seated avatars: the Quaternius `Sitting_*` clips put the pelvis 0.54 m above the root, so chairs are 0.48 m high and
 * `SeatDef.stand` is where the mannequin ROOT goes: 0.30 m in front of the chair centre, at y = 0.
 */
import * as THREE from 'three';
import type { Hex, LocalAABB, SeatDef } from '@/core/types';
import { bakeShade, outwardNormals, planarUV, ringFan, roundedRectPath, ellipsePath, sweepLoop } from './geo';
import { buildMesh } from './prims';
import { keep, type KitCtx } from './ctx';
import { tileOf } from './tiles';
import { mapOf, resolveMat } from './materials';
import type { FeltTableOpts, FeltTablePart, Kit } from './types';

type Path = Array<[number, number]>;
const RAIL_W = 0.09;
const CHAIR_H = 0.48;
const SEAT_DIST = 0.4;          // rail edge → chair centre
const STAND_FWD = 0.3;          // chair centre → mannequin root (towards the table)
const EYE_Y = 1.15;             // seated eye on a casino chair (ART_BIBLE §4.2)

// ── outlines ────────────────────────────────────────────────────────────────────────────────────
/** Table outline shrunk by `inset` metres from the outer edge of the rail (`w × d` is the OUTER bounding box). */
export function tableOutline(shape: FeltTableOpts['shape'], w: number, d: number, inset: number): Path {
  const iw = Math.max(0.1, w - 2 * inset), id = Math.max(0.1, d - 2 * inset);
  switch (shape) {
    case 'round': return ellipsePath(iw / 2, id / 2, 28);
    case 'oval': return roundedRectPath(iw, id, id / 2, 6);
    case 'kidney': {
      const rx = iw / 2, z0 = -d / 2 + inset, rz = id;
      const out: Path = [[-rx, z0], [rx, z0]];
      const seg = 18;
      for (let i = 1; i < seg; i++) { const a = (i / seg) * Math.PI; out.push([rx * Math.cos(a), z0 + rz * Math.sin(a)]); }
      return out;
    }
    case 'craps': return roundedRectPath(iw, id, Math.max(0.03, 0.12 - inset), 3);
    default: return roundedRectPath(iw, id, Math.max(0.03, 0.08 - inset * 0.5), 3);
  }
}

interface SeatSlot { x: number; z: number; nx: number; nz: number }

/** Evenly spaced points along the part of a closed outline selected by `keepPoint`, ordered left → right. */
function seatsAlong(outer: Path, n: number, keepPoint: (x: number, z: number, phi: number) => boolean): SeatSlot[] {
  // densify so arc-length resampling is smooth
  const dense: Path = [];
  for (let i = 0; i < outer.length; i++) {
    const a = outer[i], b = outer[(i + 1) % outer.length];
    const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.05));
    for (let s = 0; s < steps; s++) dense.push([a[0] + (b[0] - a[0]) * (s / steps), a[1] + (b[1] - a[1]) * (s / steps)]);
  }
  const normals = outwardNormals(dense);
  const pts = dense.map((p, i) => ({ x: p[0], z: p[1], nx: normals[i][0], nz: normals[i][1], phi: Math.atan2(p[0], p[1]) }))
    .filter((p) => keepPoint(p.x, p.z, p.phi)).sort((a, b) => a.phi - b.phi);
  if (pts.length < 2 || n <= 0) return [];
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  const total = cum[cum.length - 1];
  const out: SeatSlot[] = [];
  for (let k = 0; k < n; k++) {
    const target = (total * (k + 0.5)) / n;
    let j = 1;
    while (j < pts.length - 1 && cum[j] < target) j++;
    const t = (target - cum[j - 1]) / Math.max(1e-6, cum[j] - cum[j - 1]);
    const a = pts[j - 1], b = pts[j];
    const nx = a.nx + (b.nx - a.nx) * t, nz = a.nz + (b.nz - a.nz) * t, nl = Math.hypot(nx, nz) || 1;
    out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, nx: nx / nl, nz: nz / nl });
  }
  return out;
}

function seatSlots(o: FeltTableOpts, outer: Path): SeatSlot[] {
  const { shape, w, d, seats: n } = o;
  if (shape === 'rect' || shape === 'craps') {
    const cap = (len: number): number => Math.max(1, Math.floor((len - 0.2) / (shape === 'craps' ? 0.55 : 0.62)));
    const front = Math.min(n, cap(w));
    const slots: SeatSlot[] = [];
    for (let i = 0; i < front; i++) slots.push({ x: -w / 2 + (w * (i + 0.5)) / front, z: d / 2, nx: 0, nz: 1 });
    const rest = n - front;
    for (let i = 0; i < rest; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      slots.push({ x: side * w / 2, z: d * 0.12, nx: side, nz: 0 });
    }
    return slots.sort((a, b) => a.x - b.x || b.z - a.z);
  }
  if (shape === 'kidney') return seatsAlong(outer, n, (_x, z) => z > -d / 2 + 0.02);
  const gap = o.dealer ? 0.5 : 0.12;      // radians kept free around the dealer side (−Z)
  return seatsAlong(outer, n, (_x, _z, phi) => Math.abs(phi) <= Math.PI - gap);
}

// ── seating ─────────────────────────────────────────────────────────────────────────────────────
export function makeSeating(ctx: KitCtx): Pick<Kit, 'stool'> & { chair(o?: { h?: number; seat?: Hex; wood?: Hex }): THREE.Group } {
  const { P, M, pal } = ctx;

  const stool: Kit['stool'] = (o = {}) => {
    const h = o.h ?? 0.68;
    const g = P.group('stool');
    const seatMat = M.leather(o.seat ?? pal.red, true);
    const leg = o.leg;
    const metal = leg === undefined ? M.chrome() : { color: leg, vertexColors: true };
    P.lathe([[0, h], [0.16, h], [0.19, h - 0.025], [0.19, h - 0.065], [0.15, h - 0.08], [0, h - 0.08]], 8, seatMat, { parent: g, name: 'seat' });
    P.cyl(0.025, 0.03, h - 0.1, metal, { pos: [0, 0.1 + (h - 0.1) / 2, 0], seg: 6, parent: g, name: 'post' });
    P.cyl(0.05, 0.07, 0.1, metal, { pos: [0, 0.05, 0], seg: 6, parent: g, name: 'hub' });
    for (const r of [0, 90]) P.box(0.52, 0.03, 0.045, metal, { pos: [0, 0.025, 0], rot: [0, r, 0], parent: g, name: 'spoke' });
    P.torus(0.17, 0.011, metal, { pos: [0, 0.3 * (h / 0.68), 0], rot: [90, 0, 0], seg: 8, tubeSeg: 3, parent: g, name: 'footring' });
    for (const r of [45, 135, 225, 315]) {
      const a = (r * Math.PI) / 180;
      P.box(0.15, 0.012, 0.012, metal, { pos: [Math.sin(a) * 0.1, 0.3 * (h / 0.68), Math.cos(a) * 0.1], rot: [0, r + 90, 0], parent: g, name: 'strut' });
    }
    g.userData.seatHeight = h;
    return g;
  };

  /** Casino chair: padded seat + back, walnut legs. Faces +Z (backrest at −Z), seat top at `h` (default 0.48). */
  const chair = (o: { h?: number; seat?: Hex; wood?: Hex } = {}): THREE.Group => {
    const h = o.h ?? CHAIR_H;
    const g = P.group('chair');
    const cushion = M.leather(o.seat ?? pal.red, true);
    const wood = M.woodStain(o.wood ?? 0x3a2414);
    P.box(0.46, 0.07, 0.44, cushion, { bevel: 0.015, pos: [0, h - 0.035, 0], parent: g, name: 'seat' });
    P.box(0.44, 0.46, 0.06, cushion, { bevel: 0.015, pos: [0, h + 0.27, -0.2], rot: [-8, 0, 0], parent: g, name: 'back' });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      P.box(0.035, h - 0.07, 0.035, wood, { pos: [sx * 0.19, (h - 0.07) / 2, sz * 0.18], parent: g, name: 'leg' });
    }
    g.userData.seatHeight = h;
    return g;
  };

  return { stool, chair };
}

// ── tables ──────────────────────────────────────────────────────────────────────────────────────
export function makeTables(ctx: KitCtx, seating: ReturnType<typeof makeSeating>): Pick<Kit, 'feltTable'> {
  const { P, M, pal, tex } = ctx;

  /** Dark foam pyramids that line the inside of a craps rail. */
  const pyramidTex = (): THREE.Texture => tex.canvas(16, 16, (g) => {
    g.fillStyle = '#292131'; g.fillRect(0, 0, 16, 16);
    for (let y = 0; y < 16; y += 4) for (let x = 0; x < 16; x += 4) {
      g.fillStyle = '#3a3a42'; g.fillRect(x, y, 2, 2);
      g.fillStyle = '#191921'; g.fillRect(x + 2, y + 2, 2, 2);
    }
  }, { key: 'kit:foam' });

  const feltTable: Kit['feltTable'] = (o): FeltTablePart => {
    const h = o.h ?? 0.76;
    const { shape, w, d } = o;
    const root = P.group('felt_table');
    const craps = shape === 'craps';
    const railH = craps ? 0.14 : 0.045;
    const feltPath = tableOutline(shape, w, d, RAIL_W);
    const outer = tableOutline(shape, w, d, 0);

    // ── felt ──
    const feltMat = M.felt(o.felt);
    const tile = tileOf(mapOf(feltMat)) ?? 0.5;
    const feltGeo = ringFan(feltPath, h, Math.max(2, Math.ceil(Math.max(w, d) / 2 / 0.5)), (x, z) => [x / tile, z / tile]);
    bakeShade(feltGeo, { top: 1, bottom: 1 });
    const top = new THREE.Mesh(feltGeo, resolveMat(feltMat, true));
    top.name = 'felt_top';
    keep(top);
    root.add(top);

    // printed layout (betting spots, lines): maps over the felt's bounding box, drawn just above the felt
    if (o.print) {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const [x, z] of feltPath) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
      const geo = ringFan(feltPath, h + 0.002, 3, (x, z) => [(x - x0) / (x1 - x0), 1 - (z - z0) / (z1 - z0)]);
      bakeShade(geo, { top: 1, bottom: 1 });
      const printMat = resolveMat({ map: o.print, color: 0xffffff, vertexColors: true, alphaTest: 0.5, unique: true }, true);
      printMat.polygonOffset = true;
      printMat.polygonOffsetFactor = -2;
      printMat.polygonOffsetUnits = -2;
      const print = new THREE.Mesh(geo, printMat);
      print.name = 'felt_print';
      top.add(print);
    }

    // brass line where felt meets rail
    const edge = sweepLoop(feltPath, [[-0.004, h - 0.004], [-0.004, h + 0.004], [0.006, h + 0.006], [0.006, h - 0.004]]);
    bakeShade(edge, { flat: true });
    planarUV(edge, 0.5);
    root.add(buildFromGeo(edge, M.brass(), 'felt_edge'));

    // ── padded rail ──
    const railProfile: Array<[number, number]> = [
      [0.006, h - 0.06], [0.006, h + railH * 0.55], [0.02, h + railH], [0.06, h + railH + 0.005],
      [RAIL_W - 0.012, h + railH * 0.8], [RAIL_W, h + railH * 0.3], [RAIL_W, h - 0.06],
    ];
    const railGeo = sweepLoop(feltPath, railProfile);
    bakeShade(railGeo, { flat: true });
    planarUV(railGeo, 0.5);
    root.add(buildFromGeo(railGeo, M.leather(o.rail, false), 'rail'));
    if (craps) {   // foam-pyramid wall on the inside of the high rail
      const foam = sweepLoop(feltPath, [[0.0, h], [0.0, h + railH + 0.005], [0.01, h + railH + 0.005], [0.01, h]]);
      bakeShade(foam, { flat: true });
      planarUV(foam, 0.2);
      root.add(buildFromGeo(foam, { color: 0xffffff, map: pyramidTex(), vertexColors: true }, 'foam'));
    }

    // ── apron, legs / pedestal ──
    const woodMat = M.wood('dark');
    const apronTop = h - 0.06, apronBot = craps ? 0.04 : h - 0.2;
    const apron = sweepLoop(feltPath, [
      [RAIL_W - 0.075, apronTop], [RAIL_W - 0.01, apronTop], [RAIL_W - 0.01, apronBot], [RAIL_W - 0.075, apronBot],
    ]);
    bakeShade(apron, { flat: true });
    planarUV(apron, 0.5);
    root.add(buildFromGeo(apron, woodMat, 'apron'));
    if (craps) {
      P.box(w - 0.1, 0.03, d - 0.1, M.brass(), { pos: [0, 0.015, 0], parent: root, name: 'plinth' });
    } else if (shape === 'round' || shape === 'kidney') {
      const cz = shape === 'kidney' ? -d * 0.05 : 0;
      P.cyl(0.1, 0.12, h - 0.2, M.wood('dark'), { pos: [0, (h - 0.2) / 2 + 0.05, cz], seg: 8, parent: root, name: 'pedestal' });
      P.cyl(0.36, 0.4, 0.05, M.brass(), { pos: [0, 0.025, cz], seg: 12, parent: root, name: 'foot' });
    } else {
      const lx = w / 2 - 0.22, lz = d / 2 - 0.18;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        P.box(0.07, h - 0.06, 0.07, woodMat, { bevel: 0.006, pos: [sx * lx, (h - 0.06) / 2, sz * lz], parent: root, name: 'leg' });
        P.cyl(0.04, 0.045, 0.03, M.brass(), { pos: [sx * lx, 0.015, sz * lz], seg: 6, parent: root, name: 'foot' });
      }
    }

    // ── dealer chip tray (on the felt, at the dealer edge) ──
    const dealerZ = -d / 2 + RAIL_W + 0.14;
    const tray = new THREE.Object3D();
    tray.name = 'chip_tray';
    tray.position.set(0, h + 0.03, dealerZ);
    tray.userData.anchor = true;
    root.add(tray);
    if (shape !== 'round' || o.dealer) {
      const tw = Math.min(0.64, w * 0.3);
      P.box(tw, 0.03, 0.15, M.brass(), { bevel: 0.004, pos: [0, h + 0.015, dealerZ], parent: root, name: 'tray' });
      P.box(tw - 0.03, 0.012, 0.11, 0x08080c, { pos: [0, h + 0.03, dealerZ], parent: root });
      const cols = Math.max(3, Math.floor((tw - 0.05) / 0.06));
      const chipCols: Hex[] = [0xe6dec5, 0xc52129, 0x3163c5, 0x297b4a, 0x2a2a33, 0x7b295a, 0xc59c42];
      for (let i = 0; i < cols; i++) {
        const x = -((cols - 1) * 0.06) / 2 + i * 0.06;
        P.cyl(0.024, 0.024, 0.02 + (i % 3) * 0.008, chipCols[i % chipCols.length], { pos: [x, h + 0.036 + (i % 3) * 0.004, dealerZ], seg: 8, parent: root });
      }
    }

    // ── seats ──
    const slots = seatSlots(o, outer);
    const seatDefs: SeatDef[] = [];
    const seatAnchors: THREE.Object3D[] = [];
    const colliders: LocalAABB[] = [{ min: [-w / 2, 0, -d / 2], max: [w / 2, h + railH + 0.05, d / 2], tag: 'solid' }];
    slots.forEach((s, i) => {
      const cx = s.x + s.nx * SEAT_DIST, cz = s.z + s.nz * SEAT_DIST;
      const inwardX = -s.nx, inwardZ = -s.nz;
      const yaw = Math.atan2(inwardX, inwardZ);                       // chair front faces the table
      const anchor = new THREE.Object3D();
      anchor.name = `seat_${i}`;
      anchor.position.set(cx, 0, cz);
      anchor.rotation.y = yaw;
      anchor.userData.anchor = true;
      root.add(anchor);
      seatAnchors.push(anchor);
      let height = CHAIR_H;
      if (!craps) {
        const piece = o.stools ? seating.stool({ h: 0.68, seat: pal.red }) : seating.chair({ seat: i % 2 ? pal.redDark : pal.red });
        height = (piece.userData.seatHeight as number) ?? CHAIR_H;
        piece.position.set(cx, 0, cz);
        piece.rotation.y = yaw;
        root.add(piece);
        colliders.push({ min: [cx - 0.24, 0, cz - 0.24], max: [cx + 0.24, height + 0.5, cz + 0.24], tag: 'solid' });
      }
      const eye = o.stools && !craps ? 1.3 : EYE_Y;
      const lookIn = SEAT_DIST + RAIL_W + 0.35;
      seatDefs.push({
        pose: {
          pos: new THREE.Vector3(cx + inwardX * 0.12, craps ? 1.55 : eye, cz + inwardZ * 0.12),
          look: new THREE.Vector3(cx + inwardX * lookIn, h + 0.04, cz + inwardZ * lookIn),
          fov: 58, mouse: 'pick',
        },
        stand: new THREE.Vector3(cx + inwardX * (craps ? 0 : STAND_FWD), 0, cz + inwardZ * (craps ? 0 : STAND_FWD)),
        avatar: craps ? 'stand' : 'sit',
      });
    });

    // dealer spot
    const dealerAnchor = new THREE.Object3D();
    dealerAnchor.name = 'dealer';
    dealerAnchor.position.set(0, 0, -d / 2 - 0.4);
    dealerAnchor.userData.anchor = true;
    root.add(dealerAnchor);
    if (o.dealer) colliders.push({ min: [-0.3, 0, -d / 2 - 0.7], max: [0.3, 1.8, -d / 2 - 0.1], tag: 'solid' });

    root.userData.feltY = h;
    return { root, top, seats: seatDefs, seatAnchors, dealerAnchor, chipTray: tray, colliders };
  };

  /** Mesh from a prepared geometry + material (UV already set, colours already baked). */
  function buildFromGeo(geo: THREE.BufferGeometry, m: Parameters<Kit['mat']>[0], name: string): THREE.Mesh {
    const mesh = buildMesh(geo, m, { name, shade: false }, true, () => { /* UVs already mapped */ });
    return mesh;
  }

  return { feltTable };
}
