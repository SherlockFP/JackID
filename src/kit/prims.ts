/**
 * Kit primitives: box (optionally chamfered), cylinder, sphere, torus, plane, lathe, extrude, tube.
 * Every primitive is PSX-low by default, gets metric UVs when its texture is tile-tagged (see tiles.ts) and
 * baked vertex lighting (geo.ts) unless `shade:false`. Meshes are returned NOT added to any scene.
 */
import * as THREE from 'three';
import type { Kit, MatLike, PrimOpts } from './types';
import { bakeShade, bevelBox, ensureColor, planarUV, scaleUV } from './geo';
import { mapOf, resolveMat, usesVertexColors, withVertexColors } from './materials';
import { tileOf } from './tiles';

const D2R = Math.PI / 180;
/** Tessellation for big flat faces so vertex lighting (point-light pools) has something to interpolate. */
const tess = (dim: number): number => Math.max(1, Math.min(8, Math.ceil(dim / 0.9)));

type MapUV = (geo: THREE.BufferGeometry, tile: number) => void;

function applyOpts(me: THREE.Mesh, o?: PrimOpts): void {
  if (o?.pos) me.position.set(o.pos[0], o.pos[1], o.pos[2]);
  if (o?.rot) me.rotation.set(o.rot[0] * D2R, o.rot[1] * D2R, o.rot[2] * D2R);
  if (o?.scale !== undefined) { if (typeof o.scale === 'number') me.scale.setScalar(o.scale); else me.scale.set(o.scale[0], o.scale[1], o.scale[2]); }
  if (o?.name) me.name = o.name;
  o?.parent?.add(me);
}

/** Build a mesh: material resolution, metric UVs, baked shading. */
export function buildMesh(geo: THREE.BufferGeometry, m: MatLike, o: PrimOpts | undefined, flat: boolean, mapUV: MapUV): THREE.Mesh {
  const shade = o?.shade ?? true;
  const material = resolveMat(m, shade);
  const tile = tileOf(mapOf(material));
  if (tile) mapUV(geo, tile);
  if (shade) bakeShade(geo, { flat });
  else if (usesVertexColors(material)) ensureColor(geo);
  const me = new THREE.Mesh(geo, material);
  applyOpts(me, o);
  return me;
}

type PrimKit = Pick<Kit, 'group' | 'box' | 'cyl' | 'sphere' | 'torus' | 'plane' | 'lathe' | 'extrude' | 'tube' | 'shade' | 'mat'>;

export function createPrims(): PrimKit {
  return {
    mat: (m) => resolveMat(m, false),

    group(name, ...children) {
      const g = new THREE.Group();
      g.name = name;
      if (children.length) g.add(...children);
      return g;
    },

    box(w, h, d, m, o) {
      const b = Math.min(o?.bevel ?? 0, w / 2.05, h / 2.05, d / 2.05);
      const geo = b > 0.002 ? bevelBox(w, h, d, b) : new THREE.BoxGeometry(w, h, d, tess(w), tess(h), tess(d));
      return buildMesh(geo, m, o, true, (g, tile) => planarUV(g, tile));
    },

    cyl(rTop, rBot, h, m, o) {
      const seg = o?.seg ?? 10, hs = tess(h);
      const geo = new THREE.CylinderGeometry(rTop, rBot, h, seg, hs, o?.open ?? false, 0, o?.thetaLen ?? Math.PI * 2);
      const r = Math.max(rTop, rBot);
      return buildMesh(geo, m, o, false, (g, tile) => {
        const sv = sideVertexCount(seg, hs);                       // torso vertices come first, caps after
        const arc = (o?.thetaLen ?? Math.PI * 2) / (Math.PI * 2);
        scaleUV(g, (2 * Math.PI * r * arc) / tile, h / tile, 0, sv);
        scaleUV(g, (2 * r) / tile, (2 * r) / tile, sv);            // caps: unit disc → diameter / tile
      });
    },

    sphere(r, m, o) {
      const hemi = o?.hemi ?? false;
      const geo = new THREE.SphereGeometry(r, o?.wSeg ?? 8, o?.hSeg ?? 6, 0, Math.PI * 2, 0, hemi ? Math.PI / 2 : Math.PI);
      return buildMesh(geo, m, o, false, (g, tile) => scaleUV(g, (2 * Math.PI * r) / tile, ((hemi ? 0.5 : 1) * Math.PI * r) / tile));
    },

    torus(r, tube, m, o) {
      const arc = o?.arc ?? Math.PI * 2;
      const geo = new THREE.TorusGeometry(r, tube, o?.tubeSeg ?? 6, o?.seg ?? 12, arc);
      return buildMesh(geo, m, o, false, (g, tile) => scaleUV(g, (arc * r) / tile, (2 * Math.PI * tube) / tile));
    },

    plane(w, h, m, o) {
      const geo = new THREE.PlaneGeometry(w, h, o?.segW ?? tess(w), o?.segH ?? tess(h));
      return buildMesh(geo, m, o, true, (g, tile) => scaleUV(g, w / tile, h / tile));
    },

    lathe(profile, seg, m, o) {
      const pts = profile.map(([r, y]) => new THREE.Vector2(r, y));
      const geo = new THREE.LatheGeometry(pts, seg);
      let len = 0, rmax = 0;
      for (let i = 0; i < pts.length; i++) { rmax = Math.max(rmax, pts[i].x); if (i) len += pts[i].distanceTo(pts[i - 1]); }
      return buildMesh(geo, m, o, false, (g, tile) => scaleUV(g, (2 * Math.PI * rmax) / tile, len / tile));
    },

    extrude(shape, depth, m, o) {
      const b = o?.bevel ?? 0;
      const s = new THREE.Shape(shape.map(([x, y]) => new THREE.Vector2(x, y)));
      const geo = new THREE.ExtrudeGeometry(s, b > 0
        ? { depth: Math.max(0.001, depth - 2 * b), bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: 1, steps: 1 }
        : { depth, bevelEnabled: false, steps: 1 });
      if (b > 0) geo.translate(0, 0, b);
      return buildMesh(geo, m, o, true, (g, tile) => scaleUV(g, 1 / tile, 1 / tile));
    },

    tube(points, r, m, o) {
      const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
      const rs = o?.radialSeg ?? 6;
      const geo = new THREE.TubeGeometry(curve, o?.seg ?? 16, r, rs, false);
      const len = curve.getLength();
      return buildMesh(geo, m, o, false, (g, tile) => scaleUV(g, len / tile, (2 * Math.PI * r) / tile));
    },

    shade(mesh, o) {
      bakeShade(mesh.geometry, { top: o?.top, bottom: o?.bottom });
      if (!Array.isArray(mesh.material)) mesh.material = withVertexColors(mesh.material);
    },
  };
}

/** Vertex count of a CylinderGeometry side (torso) with `seg` radial and `hs` height segments. */
const sideVertexCount = (seg: number, hs: number): number => (seg + 1) * (hs + 1);
