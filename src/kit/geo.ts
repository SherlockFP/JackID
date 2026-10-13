/**
 * Geometry helpers of the kit: chamfered boxes, metric UVs, baked vertex lighting ("vertex-lit" PSX look,
 * ART_BIBLE §4.7), swept profiles (rails, aprons) and small buffer utilities.
 *
 * Metric UVs: textures that carry `userData.tile` (metres per repeat, set by `tiles.ts`) are mapped in WORLD
 * METRES, so every wood/felt/metal surface of the game has the same texel density (~64 px per metre).
 */
import * as THREE from 'three';

// ── baked vertex lighting ───────────────────────────────────────────────────────────────────────
/** Fake key-light shading per face normal: top 1.00, front .88, right .81, left .71, back .64, bottom .52. */
export const faceShade = (nx: number, ny: number, nz: number): number => 0.76 + 0.12 * nz + 0.05 * nx + 0.24 * ny;

function hash4(a: number, b: number, c: number, d: number): number {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647 + d * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export interface BakeOpts {
  /** Vertical gradient multipliers over the geometry's bounding box (default 1 → 0.92). */
  top?: number; bottom?: number;
  /** Per-face "hand-tinted" jitter amplitude (flat-faced geometry only; default 0.04). */
  jitter?: number;
  /** 0..1 blend of the directional face shading (default 1). */
  strength?: number;
  /** Flat-faced geometry (boxes, extrusions): enables per-face jitter. */
  flat?: boolean;
}

/** Bake the `color` attribute (grey vertex colours) from face normals + a vertical gradient. */
export function bakeShade(geo: THREE.BufferGeometry, o: BakeOpts = {}): void {
  if (!geo.getAttribute('normal')) geo.computeVertexNormals();
  const pos = geo.getAttribute('position'), nor = geo.getAttribute('normal');
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const h = Math.max(1e-6, bb.max.y - bb.min.y);
  const top = o.top ?? 1, bottom = o.bottom ?? 0.92, str = o.strength ?? 1;
  const jit = o.flat ? (o.jitter ?? 0.04) : 0;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const nx = nor.getX(i), ny = nor.getY(i), nz = nor.getZ(i);
    let s = 1 + (faceShade(nx, ny, nz) - 1) * str;
    s *= bottom + (top - bottom) * ((pos.getY(i) - bb.min.y) / h);
    if (jit > 0) {
      const d = pos.getX(i) * nx + pos.getY(i) * ny + pos.getZ(i) * nz;
      s *= 1 + (hash4(Math.round(nx * 4), Math.round(ny * 4), Math.round(nz * 4), Math.round(d * 40)) - 0.5) * 2 * jit;
    }
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = s;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
}

/** Fill a white `color` attribute when a vertex-coloured material is used with unshaded geometry. */
export function ensureColor(geo: THREE.BufferGeometry): void {
  if (geo.getAttribute('color')) return;
  const n = geo.getAttribute('position').count;
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
}

// ── chamfered box ───────────────────────────────────────────────────────────────────────────────
/** Box with a single-segment chamfer on every edge (44 tris), flat per-face normals, non-indexed. */
export function bevelBox(w: number, h: number, d: number, b: number): THREE.BufferGeometry {
  const hx = w / 2, hy = h / 2, hz = d / 2;
  const ix = hx - b, iy = hy - b, iz = hz - b;
  const P: number[] = [], N: number[] = [];
  const a = new THREE.Vector3(), bb = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  const tri = (p: number[], q: number[], r: number[]): void => {
    a.set(p[0], p[1], p[2]); bb.set(q[0], q[1], q[2]); c.set(r[0], r[1], r[2]);
    n.crossVectors(e1.subVectors(bb, a), e2.subVectors(c, a));
    if (n.lengthSq() < 1e-14) return;
    n.normalize();
    // orient outward (shape is convex around the origin)
    const cx = (a.x + bb.x + c.x) / 3, cy = (a.y + bb.y + c.y) / 3, cz = (a.z + bb.z + c.z) / 3;
    if (n.x * cx + n.y * cy + n.z * cz < 0) { n.negate(); P.push(...p, ...r, ...q); } else P.push(...p, ...q, ...r);
    for (let i = 0; i < 3; i++) N.push(n.x, n.y, n.z);
  };
  const quad = (p: number[], q: number[], r: number[], s: number[]): void => { tri(p, q, r); tri(p, r, s); };
  const S = [-1, 1];
  for (const s of S) {
    // 6 main faces
    quad([s * hx, iy, iz], [s * hx, iy, -iz], [s * hx, -iy, -iz], [s * hx, -iy, iz]);
    quad([ix, s * hy, iz], [ix, s * hy, -iz], [-ix, s * hy, -iz], [-ix, s * hy, iz]);
    quad([ix, iy, s * hz], [ix, -iy, s * hz], [-ix, -iy, s * hz], [-ix, iy, s * hz]);
    for (const t of S) {
      // 12 edge strips
      quad([s * hx, t * iy, iz], [s * hx, t * iy, -iz], [s * ix, t * hy, -iz], [s * ix, t * hy, iz]);   // X/Y edges (along Z)
      quad([s * hx, iy, t * iz], [s * hx, -iy, t * iz], [s * ix, -iy, t * hz], [s * ix, iy, t * hz]);   // X/Z edges (along Y)
      quad([ix, s * hy, t * iz], [-ix, s * hy, t * iz], [-ix, s * iy, t * hz], [ix, s * iy, t * hz]);   // Y/Z edges (along X)
      // 8 corner triangles
      for (const u of S) tri([s * hx, t * iy, u * iz], [s * ix, t * hy, u * iz], [s * ix, t * iy, u * hz]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  return g;
}

// ── UV mapping ──────────────────────────────────────────────────────────────────────────────────
/** Per-vertex planar projection by dominant normal axis, in metres / `tile`. Flat-faced geometry only. */
export function planarUV(geo: THREE.BufferGeometry, tile: number): void {
  if (!geo.getAttribute('normal')) geo.computeVertexNormals();
  const pos = geo.getAttribute('position'), nor = geo.getAttribute('normal');
  const uv = new Float32Array(pos.count * 2);
  const k = 1 / tile;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const nx = nor.getX(i), ny = nor.getY(i), nz = nor.getZ(i);
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    let u: number, v: number;
    if (ax >= ay && ax >= az) { u = nx > 0 ? -z : z; v = y; }
    else if (ay >= az) { u = x; v = ny > 0 ? -z : z; }
    else { u = nz > 0 ? x : -x; v = y; }
    uv[i * 2] = u * k; uv[i * 2 + 1] = v * k;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/** Multiply the existing UVs (optionally only a vertex range). */
export function scaleUV(geo: THREE.BufferGeometry, su: number, sv: number, from = 0, count = -1): void {
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute | undefined;
  if (!uv) return;
  const end = count < 0 ? uv.count : Math.min(uv.count, from + count);
  for (let i = from; i < end; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  uv.needsUpdate = true;
}

// ── swept profiles (padded rails, aprons, trim loops) ───────────────────────────────────────────
/**
 * Sweep a closed cross-section `profile` (points of [outward offset, y], forming a closed loop) around a
 * closed XZ `path`. Faceted normals. Path must be convex-ish (table outlines are).
 */
export function sweepLoop(path: ReadonlyArray<readonly [number, number]>, profile: ReadonlyArray<readonly [number, number]>): THREE.BufferGeometry {
  const n = path.length, m = profile.length;
  let cx = 0, cz = 0;
  for (const [x, z] of path) { cx += x; cz += z; }
  cx /= n; cz /= n;
  // outward normals per path vertex (average of adjacent edge normals)
  const nx = new Float32Array(n), nz = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p0 = path[(i + n - 1) % n], p1 = path[i], p2 = path[(i + 1) % n];
    const ex = p2[0] - p0[0], ez = p2[1] - p0[1];
    let ox = ez, oz = -ex;
    const l = Math.hypot(ox, oz) || 1;
    ox /= l; oz /= l;
    if (ox * (p1[0] - cx) + oz * (p1[1] - cz) < 0) { ox = -ox; oz = -oz; }
    nx[i] = ox; nz[i] = oz;
  }
  let pc = 0;
  for (const [, y] of profile) pc += y;
  pc /= m;
  const P: number[] = [];
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), Nn = new THREE.Vector3();
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  const vert = (i: number, j: number): number[] => [path[i][0] + nx[i] * profile[j][0], profile[j][1], path[i][1] + nz[i] * profile[j][0]];
  const push = (p: number[], q: number[], r: number[], core: number[]): void => {
    A.set(p[0], p[1], p[2]); B.set(q[0], q[1], q[2]); C.set(r[0], r[1], r[2]);
    Nn.crossVectors(e1.subVectors(B, A), e2.subVectors(C, A));
    const mx = (A.x + B.x + C.x) / 3 - core[0], my = (A.y + B.y + C.y) / 3 - core[1], mz = (A.z + B.z + C.z) / 3 - core[2];
    if (Nn.x * mx + Nn.y * my + Nn.z * mz < 0) P.push(...p, ...r, ...q); else P.push(...p, ...q, ...r);
  };
  for (let i = 0; i < n; i++) {
    const i2 = (i + 1) % n;
    const core = [(path[i][0] + path[i2][0]) / 2, pc, (path[i][1] + path[i2][1]) / 2];
    for (let j = 0; j < m; j++) {
      const j2 = (j + 1) % m;
      const a = vert(i, j), b = vert(i2, j), c = vert(i2, j2), d = vert(i, j2);
      push(a, b, c, core); push(a, c, d, core);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.computeVertexNormals();
  return g;
}

/** Closed XZ outline helpers (CCW seen from +Y is irrelevant: consumers re-orient). */
export function ellipsePath(rx: number, rz: number, seg: number, cx = 0, cz = 0): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < seg; i++) { const a = (i / seg) * Math.PI * 2; out.push([cx + Math.cos(a) * rx, cz + Math.sin(a) * rz]); }
  return out;
}
export function roundedRectPath(w: number, d: number, r: number, segPerCorner = 3): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const hx = w / 2 - r, hz = d / 2 - r;
  const corners: Array<[number, number, number]> = [[hx, hz, 0], [-hx, hz, 0.5], [-hx, -hz, 1], [hx, -hz, 1.5]];
  for (const [cx, cz, q] of corners) {
    for (let i = 0; i <= segPerCorner; i++) {
      const a = (q + i / segPerCorner * 0.5) * Math.PI;
      out.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
    }
  }
  return out;
}

/** Triangulated flat polygon (XZ, facing +Y at height `y`) with UV = xz / tile. Convex or simple outlines. */
export function flatPolygon(path: ReadonlyArray<readonly [number, number]>, y: number, tile: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(path.map(([x, z]) => new THREE.Vector2(x, -z)));
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2);       // shape (x, -z) → world (x, y=0, z)
  g.translate(0, y, 0);
  const pos = g.getAttribute('position');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) { uv[i * 2] = pos.getX(i) / tile; uv[i * 2 + 1] = pos.getZ(i) / tile; }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const nrm = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) nrm[i * 3 + 1] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  return g;
}

/**
 * Flat horizontal polygon (facing +Y at height `y`) as concentric rings around the path centroid, so vertex lighting
 * has vertices to interpolate on big felt tops. Works for any outline that is star-shaped around its centroid
 * (every table outline). `uvOf` maps (x, z) → texture coordinates.
 */
export function ringFan(path: ReadonlyArray<readonly [number, number]>, y: number, rings: number, uvOf: (x: number, z: number) => [number, number]): THREE.BufferGeometry {
  const n = path.length;
  let cx = 0, cz = 0, area = 0;
  for (const [x, z] of path) { cx += x; cz += z; }
  cx /= n; cz /= n;
  for (let i = 0; i < n; i++) { const a = path[i], b = path[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
  const R = Math.max(1, rings);
  const P: number[] = [], UV: number[] = [], NR: number[] = [], I: number[] = [];
  const vert = (x: number, z: number): void => { P.push(x, y, z); const [u, v] = uvOf(x, z); UV.push(u, v); NR.push(0, 1, 0); };
  vert(cx, cz);
  for (let k = 1; k <= R; k++) for (let i = 0; i < n; i++) vert(cx + (path[i][0] - cx) * (k / R), cz + (path[i][1] - cz) * (k / R));
  const at = (k: number, i: number): number => 1 + (k - 1) * n + (i % n);
  // x→z is clockwise seen from +Y when area > 0 in this (x, z) frame; choose the winding that faces up
  const flip = area > 0;
  const tri = (a: number, b: number, c: number): void => { if (flip) I.push(a, c, b); else I.push(a, b, c); };
  for (let i = 0; i < n; i++) tri(0, at(1, i), at(1, i + 1));
  for (let k = 1; k < R; k++) {
    for (let i = 0; i < n; i++) {
      tri(at(k, i), at(k + 1, i), at(k + 1, i + 1));
      tri(at(k, i), at(k + 1, i + 1), at(k, i + 1));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(NR, 3));
  g.setIndex(I);
  return g;
}

/** Closed polyline (XZ) → outward-facing unit normal at every vertex (centroid-based orientation). */
export function outwardNormals(path: ReadonlyArray<readonly [number, number]>): Array<[number, number]> {
  const n = path.length;
  let cx = 0, cz = 0;
  for (const [x, z] of path) { cx += x; cz += z; }
  cx /= n; cz /= n;
  const out: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) {
    const p0 = path[(i + n - 1) % n], p1 = path[i], p2 = path[(i + 1) % n];
    const ex = p2[0] - p0[0], ez = p2[1] - p0[1];
    let ox = ez, oz = -ex;
    const l = Math.hypot(ox, oz) || 1;
    ox /= l; oz /= l;
    if (ox * (p1[0] - cx) + oz * (p1[1] - cz) < 0) { ox = -ox; oz = -oz; }
    out.push([ox, oz]);
  }
  return out;
}

// ── small buffer utilities ──────────────────────────────────────────────────────────────────────
/** Transform a geometry's positions/normals by `m` and return it (in place). */
export function xform(geo: THREE.BufferGeometry, m: THREE.Matrix4): THREE.BufferGeometry { return geo.applyMatrix4(m); }
