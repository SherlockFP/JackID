/**
 * The casino behind the menu cabinet (menu revamp). A dark pit seen past the cabinet's shoulders: rows of
 * glowing slot cabinets (instanced), a checker carpet, neon trim, a string of ceiling bulbs that chases, sweeping
 * spotlight beams, drifting smoke and faceless mannequin silhouettes that sway (a few slowly turn to watch you).
 * Cosmetic only and deterministic: positions come from a fixed generator, motion from the clock. Every material is
 * unlit, so the scene keeps its single cabinet key light.
 */
import * as THREE from 'three';
import { psxMaterial } from '@/core/renderer/psxMaterial';
import { makeCanvasTex, paintGlow, type CanvasTex } from './menuArt';

export interface Backdrop {
  readonly root: THREE.Group;
  update(dt: number, t: number): void;
  dispose(): void;
}

const FLOOR_Y = -2.85;
const NEON = [0xff2f6e, 0x2fe6d4, 0xffc040, 0x9a5bff, 0xff7a2f];

/** mulberry32: a tiny seeded generator (the menu must never touch Math.random). */
function lcg(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Figure { g: THREE.Group; head: THREE.Object3D; phase: number; watcher: boolean; base: number }

export function buildBackdrop(): Backdrop {
  const root = new THREE.Group();
  const rnd = lcg(0x1ac4b0);
  const texes: CanvasTex[] = [];
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];            // only the materials this scene owns (unique:true); cached ones are shared
  const own = <T extends THREE.BufferGeometry>(g: T): T => { geos.push(g); return g; };
  const uniq = (o: Parameters<typeof psxMaterial>[0]): THREE.MeshBasicMaterial => {
    const m = psxMaterial({ ...o, unique: true }) as THREE.MeshBasicMaterial;
    mats.push(m);
    return m;
  };

  // ── carpet ──────────────────────────────────────────────────────────────────────────────────────
  const carpet = makeCanvasTex(128, 128);
  texes.push(carpet);
  carpet.paint((c, w, h) => {
    c.fillStyle = '#16060a'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#240b10'; c.fillRect(0, 0, w / 2, h / 2); c.fillRect(w / 2, h / 2, w / 2, h / 2);
    c.strokeStyle = 'rgba(230,178,58,0.35)'; c.lineWidth = 3;
    c.beginPath(); c.moveTo(w / 2, 0); c.lineTo(w, h / 2); c.lineTo(w / 2, h); c.lineTo(0, h / 2); c.closePath(); c.stroke();
    c.fillStyle = 'rgba(230,178,58,0.5)'; c.fillRect(w / 2 - 3, h / 2 - 3, 6, 6);
  });
  carpet.tex.wrapS = carpet.tex.wrapT = THREE.RepeatWrapping;
  carpet.tex.repeat.set(26, 18);
  const floor = new THREE.Mesh(own(new THREE.PlaneGeometry(80, 50)), uniq({ map: carpet.tex, color: 0xffffff, lit: false }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, FLOOR_Y, -16);
  root.add(floor);

  // ── back wall with neon trim ────────────────────────────────────────────────────────────────────
  const wall = new THREE.Mesh(own(new THREE.PlaneGeometry(100, 34)), psxMaterial({ color: 0x0c0409, lit: false }));
  wall.position.set(0, 9, -26);
  root.add(wall);
  const glowTex = makeCanvasTex(64, 64);
  texes.push(glowTex);
  glowTex.paint((c, w, h) => paintGlow(c, w, h, '255,255,255'));
  const glowMat = (hex: number, op: number): THREE.MeshBasicMaterial =>
    uniq({ map: glowTex.tex, color: hex, transparent: true, opacity: op, additive: true, lit: false, depthWrite: false });
  // big colour washes on the wall: they backlight the silhouettes
  const washes: THREE.MeshBasicMaterial[] = [];
  ([[-16, 0xff2f6e], [-6, 0x2fe6d4], [6, 0x9a5bff], [16, 0xffc040]] as const).forEach(([x, hex], i) => {
    const m = glowMat(hex, 0.5);
    washes.push(m);
    const p = new THREE.Mesh(own(new THREE.PlaneGeometry(22, 18)), m);
    p.position.set(x, 3.5 + (i % 2) * 1.5, -24.5);
    root.add(p);
  });
  const trimGeo = own(new THREE.BoxGeometry(1, 0.12, 0.1));
  const trims: THREE.MeshBasicMaterial[] = [];
  ([[8.5, 0xff2f6e], [6.2, 0x2fe6d4], [-1.2, 0xffc040]] as const).forEach(([y, hex]) => {
    const m = uniq({ color: hex, lit: false });
    trims.push(m);
    const s = new THREE.Mesh(trimGeo, m);
    s.scale.x = 90;
    s.position.set(0, y, -25.4);
    root.add(s);
  });

  // ── slot cabinets: three instanced rows (body / screen / top sign) ───────────────────────────────
  const rows: Array<{ z: number; s: number; step: number; xmin: number }> = [
    { z: -9, s: 1.0, step: 2.7, xmin: 3.9 }, { z: -14, s: 1.25, step: 3.3, xmin: 0 }, { z: -20, s: 1.6, step: 4.2, xmin: 0 },
  ];
  const spots: Array<{ x: number; z: number; s: number }> = [];
  for (const r of rows) for (let x = -34; x <= 34; x += r.step) if (Math.abs(x) >= r.xmin) spots.push({ x: x + (rnd() - 0.5) * 0.5, z: r.z + (rnd() - 0.5) * 0.8, s: r.s });
  const n = spots.length;
  const bodies = new THREE.InstancedMesh(own(new THREE.BoxGeometry(1.5, 3.1, 1.2)), psxMaterial({ color: 0x1c0d12, lit: false }), n);
  const screens = new THREE.InstancedMesh(own(new THREE.PlaneGeometry(1.1, 0.95)), uniq({ color: 0xffffff, lit: false }), n);
  const signs = new THREE.InstancedMesh(own(new THREE.PlaneGeometry(1.3, 0.34)), uniq({ color: 0xffffff, lit: false }), n);
  const tmp = new THREE.Object3D();
  const col = new THREE.Color();
  const screenHue: number[] = [];
  spots.forEach((sp, i) => {
    const y0 = FLOOR_Y + 1.55 * sp.s;
    tmp.rotation.set(0, 0, 0);
    tmp.scale.setScalar(sp.s);
    tmp.position.set(sp.x, y0, sp.z);
    tmp.updateMatrix(); bodies.setMatrixAt(i, tmp.matrix);
    tmp.position.set(sp.x, y0 + 0.35 * sp.s, sp.z + 0.62 * sp.s);
    tmp.updateMatrix(); screens.setMatrixAt(i, tmp.matrix);
    tmp.position.set(sp.x, y0 + 1.25 * sp.s, sp.z + 0.62 * sp.s);
    tmp.updateMatrix(); signs.setMatrixAt(i, tmp.matrix);
    screenHue.push(Math.floor(rnd() * NEON.length));
    signs.setColorAt(i, col.setHex(NEON[Math.floor(rnd() * NEON.length)]));
    screens.setColorAt(i, col.setHex(NEON[screenHue[i]]));
  });
  [bodies, screens, signs].forEach((m) => { m.instanceMatrix.needsUpdate = true; m.frustumCulled = false; root.add(m); });

  // ── ceiling bulb strings (Points, chase animation) ───────────────────────────────────────────────
  const perString = 44;
  const bulbN = 3 * perString;
  const bulbPos = new Float32Array(bulbN * 3);
  const bulbCol = new Float32Array(bulbN * 3);
  let bi = 0;
  for (const z of [-5, -10, -16]) {
    for (let k = 0; k < perString; k++) {
      const x = -30 + (k / (perString - 1)) * 60;
      const sag = Math.pow((k - (perString - 1) / 2) / ((perString - 1) / 2), 2);
      bulbPos.set([x, 8.6 - (1 - sag) * 1.1, z], bi * 3);
      bi++;
    }
  }
  const bulbGeo = own(new THREE.BufferGeometry());
  bulbGeo.setAttribute('position', new THREE.BufferAttribute(bulbPos, 3));
  bulbGeo.setAttribute('color', new THREE.BufferAttribute(bulbCol, 3));
  const bulbMat = new THREE.PointsMaterial({ size: 0.28, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  mats.push(bulbMat);
  const bulbs = new THREE.Points(bulbGeo, bulbMat);
  bulbs.frustumCulled = false;
  root.add(bulbs);

  // ── spotlight beams ─────────────────────────────────────────────────────────────────────────────
  const beams: Array<{ pivot: THREE.Group; phase: number; amp: number; speed: number }> = [];
  const beamGeo = own(new THREE.CylinderGeometry(0.08, 1.7, 16, 12, 1, true));
  beamGeo.translate(0, -8, 0);
  ([[-13, 0xff2f6e], [-6.5, 0x2fe6d4], [6.5, 0xffc040], [13, 0x9a5bff], [0, 0xffffff]] as const).forEach(([x, hex], i) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, 9.2, -7 - (i % 3) * 2.5);
    const m = uniq({ color: hex, transparent: true, opacity: i === 4 ? 0.03 : 0.07, additive: true, lit: false, side: 'double', depthWrite: false });
    pivot.add(new THREE.Mesh(beamGeo, m));
    root.add(pivot);
    beams.push({ pivot, phase: i * 1.7, amp: 0.3 + (i % 2) * 0.12, speed: 0.35 + i * 0.07 });
  });

  // ── smoke ───────────────────────────────────────────────────────────────────────────────────────
  const smokeTex = makeCanvasTex(64, 64);
  texes.push(smokeTex);
  smokeTex.paint((c, w, h) => paintGlow(c, w, h, '210,180,190'));
  const smoke: Array<{ m: THREE.Mesh; x0: number; y0: number; sp: number; ph: number }> = [];
  for (let i = 0; i < 20; i++) {
    const mat = uniq({ map: smokeTex.tex, color: 0xffffff, transparent: true, opacity: 0.05 + rnd() * 0.07, additive: true, lit: false, depthWrite: false });
    const sz = 5 + rnd() * 6;
    const m = new THREE.Mesh(own(new THREE.PlaneGeometry(sz, sz * 0.55)), mat);
    const x0 = (rnd() - 0.5) * 34, y0 = FLOOR_Y + 0.3 + rnd() * 3.2;
    m.position.set(x0, y0, -2.5 - rnd() * 9);
    root.add(m);
    smoke.push({ m, x0, y0, sp: 0.12 + rnd() * 0.18, ph: rnd() * 6.28 });
  }

  // ── mannequin silhouettes ───────────────────────────────────────────────────────────────────────
  const figMat = psxMaterial({ color: 0x0a0509, lit: false });
  const limb = own(new THREE.CylinderGeometry(0.06, 0.05, 0.8, 6));
  const torsoG = own(new THREE.BoxGeometry(0.46, 0.62, 0.22));
  const hipG = own(new THREE.BoxGeometry(0.4, 0.2, 0.2));
  const headG = own(new THREE.SphereGeometry(0.14, 8, 6));
  const armG = own(new THREE.CylinderGeometry(0.045, 0.035, 0.62, 6));
  const eyeGeo = own(new THREE.PlaneGeometry(0.05, 0.025));
  const eyeMat = uniq({ color: 0xff2f2f, lit: false, additive: true, transparent: true, opacity: 0.9, depthWrite: false });
  const figures: Figure[] = [];
  const place: Array<[number, number, number, number]> = [   // x, z, scale, glow colour index (-1 none)
    [-4.6, 3.2, 1.25, -1], [4.7, 3.0, 1.25, -1], [-6.5, -3, 1.05, 0], [-9.2, -5, 1.0, 1], [-12, -8, 1.0, 3], [-15, -6, 1.0, 0],
    [6.6, -3.4, 1.05, 3], [9.4, -5.5, 1.0, 1], [12.5, -7.5, 1.0, 2], [15.5, -5, 1.0, 0], [-2.8, -12, 1.0, 1], [3.4, -13, 1.0, 2],
  ];
  place.forEach(([x, z, s, gi], i) => {
    const g = new THREE.Group();
    const add = (geo: THREE.BufferGeometry, px: number, py: number, pz: number, rz = 0): THREE.Mesh => {
      const m = new THREE.Mesh(geo, figMat);
      m.position.set(px, py, pz); m.rotation.z = rz;
      g.add(m); return m;
    };
    add(limb, -0.1, 0.4, 0); add(limb, 0.1, 0.4, 0);
    add(hipG, 0, 0.88, 0);
    add(torsoG, 0, 1.28, 0);
    const pose = i % 4;
    add(armG, -0.29, 1.22, 0, pose === 1 ? 0.05 : 0.12);
    add(armG, 0.29, pose === 2 ? 1.45 : 1.22, 0, pose === 2 ? -2.3 : -0.12);
    const head = new THREE.Group();
    head.position.set(0, 1.78, 0);
    const hm = new THREE.Mesh(headG, figMat);
    hm.scale.set(1, 1.25, 1);
    head.add(hm);
    const watcher = i === 0 || i === 1 || i === 6;
    if (watcher) {   // two cold red pinpricks
      const e1 = new THREE.Mesh(eyeGeo, eyeMat), e2 = new THREE.Mesh(eyeGeo, eyeMat);
      e1.position.set(-0.05, 0.02, 0.14); e2.position.set(0.05, 0.02, 0.14);
      head.add(e1, e2);
    }
    g.add(head);
    g.scale.setScalar(s);
    g.position.set(x, FLOOR_Y, z);
    g.rotation.y = x < 0 ? 0.35 : -0.35;
    if (gi >= 0) {   // backlight: a tall coloured glow just behind the figure
      const gl = new THREE.Mesh(own(new THREE.PlaneGeometry(2.6 * s, 3.8 * s)), glowMat(NEON[gi], 0.38));
      gl.position.set(x, FLOOR_Y + 1.5 * s, z - 0.5);
      root.add(gl);
    }
    root.add(g);
    figures.push({ g, head, phase: i * 0.9, watcher, base: g.rotation.y });
  });

  // ── far silhouette: pillars and arches of the casino hall, so the wide side views have depth ──────────
  const pillarMat = psxMaterial({ color: 0x07030a, lit: false });
  const pillarGeo = own(new THREE.BoxGeometry(1.6, 16, 1.6));
  const archGeo = own(new THREE.BoxGeometry(1, 1.1, 1.2));
  for (let x = -34; x <= 34; x += 8.5) {
    if (Math.abs(x) < 7) continue;
    const pl = new THREE.Mesh(pillarGeo, pillarMat);
    pl.position.set(x, FLOOR_Y + 8, -23);
    root.add(pl);
    const cap = new THREE.Mesh(archGeo, pillarMat);
    cap.scale.x = 8.5;
    cap.position.set(x + 4.25, FLOOR_Y + 12.8, -23);
    root.add(cap);
  }
  // a soft warm pool of light on the floor under the cabinet
  const pool = new THREE.Mesh(own(new THREE.PlaneGeometry(12, 6)), glowMat(0xffb040, 0.22));
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(0, FLOOR_Y + 0.02, 1.5);
  root.add(pool);

  const c = new THREE.Color();
  return {
    root,
    update(_dt: number, t: number): void {
      // screens: each cabinet cycles a neon colour at its own pace (deterministic)
      for (let i = 0; i < n; i++) {
        const k = Math.floor(t * (0.6 + (i % 5) * 0.25) + i * 0.7);
        const v = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * (2 + (i % 7) * 0.8) + i));
        c.setHex(NEON[(screenHue[i] + k) % NEON.length]).multiplyScalar(v);
        screens.setColorAt(i, c);
      }
      if (screens.instanceColor) screens.instanceColor.needsUpdate = true;
      for (let k = 0; k < bulbN; k++) {
        const v = 0.25 + 0.75 * Math.max(0, Math.sin(t * 5 - k * 0.45));
        bulbCol[k * 3] = v; bulbCol[k * 3 + 1] = 0.72 * v; bulbCol[k * 3 + 2] = 0.25 * v;
      }
      (bulbGeo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
      beams.forEach((b) => { b.pivot.rotation.z = Math.sin(t * b.speed + b.phase) * b.amp; b.pivot.rotation.x = Math.cos(t * b.speed * 0.8 + b.phase) * 0.12; });
      smoke.forEach((s) => {
        s.m.position.x = s.x0 + Math.sin(t * s.sp + s.ph) * 3.2;
        s.m.position.y = s.y0 + Math.sin(t * s.sp * 1.7 + s.ph) * 0.25;
      });
      figures.forEach((f) => {
        f.g.rotation.z = Math.sin(t * 0.7 + f.phase) * 0.018;
        f.g.rotation.y = f.base + Math.sin(t * 0.3 + f.phase) * 0.08;
        // watchers swing their head round to face the camera, hold, and look away again
        const w = f.watcher ? Math.max(0, Math.sin(t * 0.22 + f.phase)) : 0;
        f.head.rotation.y = f.watcher ? -f.g.rotation.y * Math.min(1, w * 2.2) : Math.sin(t * 0.5 + f.phase) * 0.25;
        f.head.rotation.z = Math.sin(t * 0.4 + f.phase) * 0.06 + (f.watcher ? 0.12 * w : 0);
      });
      washes.forEach((m, i) => { m.opacity = 0.42 + 0.14 * Math.sin(t * 0.6 + i * 1.3); });
      trims.forEach((m, i) => { m.color.setHex(NEON[i]).multiplyScalar(0.65 + 0.35 * Math.sin(t * 1.4 + i)); });
    },
    dispose(): void {
      geos.forEach((g) => g.dispose());
      mats.forEach((m) => m.dispose());
      texes.forEach((x) => x.tex.dispose());
      bodies.dispose(); screens.dispose(); signs.dispose();
    },
  };
}
