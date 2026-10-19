// Cutscene camera audit (headless): every camera key of every registered *.cutscene.ts must sit in open air (not inside a wall or
// pillar, above the floor, below its zone's ceiling) and must see its look target through no solid wall. Born from the quota_met
// camera that sat behind the Mouth/Well ceiling step wall at z -18.1 after the map refit. Keys that follow the player's eye
// ({ player }), a machine or a bare actor cannot be resolved headless: they are skipped (counted, not asserted).
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { load, closeVite, ROOT } from './_vite.mjs';

// the level builds without a browser: fake the few DOM bits the texture generator draws into (nothing is rendered)
const ctx2d = (cv) => new Proxy({ canvas: cv }, {
  get(t, k) {
    if (k in t) return t[k];
    if (k === 'getImageData' || k === 'createImageData') return (x, y, w, h) => ({ width: w ?? x, height: h ?? y, data: new Uint8ClampedArray(4 * (w ?? x) * (h ?? y)) });
    if (k === 'measureText') return () => ({ width: 10 });
    if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern') return () => ({ addColorStop() {} });
    return () => {};
  },
  set(t, k, v) { t[k] = v; return true; },
});
const STUBS = {
  ImageData: class { constructor(d, w, h) { this.data = d; this.width = w; this.height = h; } },
  Image: class { set src(_v) {} addEventListener() {} },
  document: {
    fonts: undefined,
    createElement: () => ({ width: 1, height: 1, style: {}, getContext() { return (this._c ??= ctx2d(this)); }, addEventListener() {}, toDataURL: () => '' }),
  },
};
const saved = {};
const noop = () => {};
/** Stubs live only while this file runs: the other suites share the process and must not see a fake document. */
function installStubs() {
  for (const k of Object.keys(STUBS)) { saved[k] = Object.getOwnPropertyDescriptor(globalThis, k); globalThis[k] = STUBS[k]; }
  saved.fetch = globalThis.fetch;
  // the tavern/couch/mannequin models fetch from public/ and are decoration only: let them fail quietly
  globalThis.fetch = (u, ...r) => (String(u).startsWith('/') ? Promise.reject(new Error('headless')) : saved.fetch(u, ...r));
  process.on('unhandledRejection', noop);
}
function restoreStubs() {
  for (const k of Object.keys(STUBS)) { if (saved[k]) Object.defineProperty(globalThis, k, saved[k]); else delete globalThis[k]; }
  globalThis.fetch = saved.fetch;
  process.off('unhandledRejection', noop);
}

// a suite, so the hooks (and the DOM stubs) stay out of the other test files that share this process
describe('cutscene cameras', () => {
after(async () => { restoreStubs(); await closeVite(); });

const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.cutscene.ts') ? [p] : []; });
const lvlSrc = readFileSync(join(ROOT, 'src/world/level.ts'), 'utf8');
const CEILING = Object.fromEntries([...lvlSrc.match(/const CEILING[^{]*\{([^}]*)\}/)[1].matchAll(/(\w+):\s*([\d.]+)/g)].map((m) => [m[1], +m[2]]));
const STEPS = [...lvlSrc.matchAll(/\{ z: (-?[\d.]+), dir: -?1, y0: CEILING\.(\w+), y1: CEILING\.(\w+)/g)].map((m) => ({ z: +m[1], y0: CEILING[m[2]], y1: CEILING[m[3]] }));
const HOLE = { x: 0, z: 12, r: 2 };   // the hero trapdoor (plus a run-up): the fall shots may drop toward it
const ASCENTS = new Set(['ending_elevator']);   // the lift flies up through the ceilings on purpose

let lv, ZONES, solids, openDoor, defs, HOME;
before(async () => {
  installStubs();
  const { createTexGen } = await load('src/core/texgen/texgen.ts');
  const { createKit } = await load('src/kit/index.ts');
  const { createCollisionWorld } = await load('src/world/collision.ts');
  const { buildLevel } = await load('src/world/level.ts');
  const L = await load('src/world/layout.ts');
  HOME = await load('src/world/home/config.ts');
  ZONES = L.ZONES;
  const tex = createTexGen();
  const collision = createCollisionWorld();
  lv = buildLevel({ mode: 'debt', seed: 1, slots: L.SLOTS, kit: createKit(tex), tex, collision, bench: false });
  solids = [];
  collision.forEach((c) => { if (c.on && c.tag === 'solid') solids.push(c.box.clone()); });
  for (const s of lv.statics ?? []) if (s.tag === 'solid') solids.push(s.box.clone());
  // the ceiling-step walls are drawn only (no collider), and they close the nave above the lower ceiling
  for (const st of STEPS) solids.push(new THREE.Box3(new THREE.Vector3(-11, st.y0, st.z - 0.15), new THREE.Vector3(11, st.y1, st.z + 0.15)));
  // the front door's closed leaf is a collider; mafia_visit swings it open (hook home.doorOpen) before its camera looks through
  const [fx0, fz0, fx1, fz1] = HOME.leafFootprint(0), w0 = HOME.at(fx0, 0, fz0), w1 = HOME.at(fx1, 0, fz1);
  openDoor = solids.filter((b) => !(Math.abs(b.max.y - HOME.DOOR_H) < 0.01 && b.max.x > w0[0] && b.min.x < w1[0] && b.max.z > w0[2] && b.min.z < w1[2]));
  assert.equal(STEPS.length, 2, 'level.ts still declares the two ceiling steps');
  defs = [];
  for (const f of walk(join(ROOT, 'src'))) defs.push((await load(f.slice(ROOT.length + 1).replace(/\\/g, '/'))).default);
});

const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);
/** World point of a target, or null when it cannot be resolved headless. */
function resolve(def, tg, role) {
  if (Array.isArray(tg)) return V(tg);
  const off = tg.offset ?? [0, 0, 0];
  if (tg.anchor) {
    const o = lv.anchors[tg.anchor];
    if (!o) return null;
    o.updateWorldMatrix(true, false);
    return o.getWorldPosition(new THREE.Vector3()).add(V(off));
  }
  if (tg.actor) {
    const a = def.actors?.[tg.actor];
    if (!a) return null;
    return V(a.pos).add(V([0, role === 'look' ? (a.height ?? 1.8) * 0.9 : 0, 0])).add(V(off));
  }
  return null;
}
function zoneAt(x, z) {
  const hit = ZONES.filter((q) => x >= q.rect[0] && x <= q.rect[2] && z >= q.rect[1] && z <= q.rect[3]);
  return hit.find((q) => q.id !== 'lift') ?? hit[0];
}
/** Slab test: does the segment a to b pass through the box? */
function crosses(a, b, box) {
  const d = b.clone().sub(a);
  let t0 = 0, t1 = 1;
  for (const ax of ['x', 'y', 'z']) {
    if (Math.abs(d[ax]) < 1e-9) { if (a[ax] < box.min[ax] || a[ax] > box.max[ax]) return false; continue; }
    let u = (box.min[ax] - a[ax]) / d[ax], w = (box.max[ax] - a[ax]) / d[ax];
    if (u > w) [u, w] = [w, u];
    t0 = Math.max(t0, u); t1 = Math.min(t1, w);
    if (t0 > t1) return false;
  }
  return true;
}
const inBox = (p, b, pad) => p.x > b.min.x - pad && p.x < b.max.x + pad && p.y > b.min.y - pad && p.y < b.max.y + pad && p.z > b.min.z - pad && p.z < b.max.z + pad;
const fmt = (v) => v.toArray().map((n) => +n.toFixed(1)).join(',');

/** Why a camera at `p` looking at `look` is bad, or null. */
function problem(p, look, walls = solids, ascent = false) {
  if (walls.some((b) => inBox(p, b, 0.15))) return 'camera inside a wall or pillar';
  const inHole = Math.hypot(p.x - HOLE.x, p.z - HOLE.z) <= HOLE.r * 1.5;
  if (p.y < 0.05 && !inHole) return 'camera below the floor';
  const z = zoneAt(p.x, p.z);
  const ceil = z ? (z.id === 'home' ? HOME.CEIL : CEILING[z.id] ?? 4.5) : Infinity;
  if (!ascent && z && z.id !== 'lift' && p.y > ceil - 0.1) return `camera above the ${z.id} ceiling (${ceil})`;
  if (look) {
    const d = look.clone().sub(p), len = d.length();
    const stop = p.clone().add(d.multiplyScalar(Math.max(0, len - 0.5) / (len || 1)));   // the subject may stand against its wall
    const w = walls.find((b) => crosses(p, stop, b));
    if (w) return `a wall stands between the camera and its target (${fmt(w.min)} .. ${fmt(w.max)})`;
  }
  return null;
}

test('the audit catches a camera behind the Mouth/Well step wall (the quota_met bug)', () => {
  const board = resolve({}, { anchor: 'quotaBoard' }, 'look');
  assert.ok(board, 'quotaBoard anchor exists');
  assert.match(problem(board.clone().add(V([0, -0.6, -3.2])), board) ?? '', /wall/, 'the old -z camera is behind the step wall');
  assert.equal(problem(board.clone().add(V([0, -0.6, 3.2])), board), null, 'the fixed +z camera is clear');
});

test('every cutscene camera key stands in open air and sees its target', () => {
  const bad = [];
  let checked = 0, skipped = 0;
  for (const def of defs) {
    for (const tr of def.tracks.filter((t) => t.kind === 'camera')) {
      const keys = [...(tr.keys ?? []), ...(tr.paths ?? []).flatMap((p) => p.points.map((pt) => ({ t: p.t0, pos: pt, look: p.look })))];
      let prev = null;
      const doorHooks = def.tracks.filter((t) => t.kind === 'hook').flatMap((t) => t.cues).filter((c) => c.hook === 'home.doorOpen');
      keys.forEach((k, i) => {
        const p = resolve(def, k.pos, 'pos');
        const look = k.look ? resolve(def, k.look, 'look') : null;
        if (!p) { skipped++; prev = null; return; }
        checked++;
        const walls = doorHooks.some((h) => h.t <= k.t) ? openDoor : solids, asc = ASCENTS.has(def.id);
        const why = problem(p, look, walls, asc);
        if (why) bad.push(`${def.id} key ${i} (t ${k.t}): ${why}; camera at ${fmt(p)}`);
        // the dolly between two keys crosses open air too (quarter points; a cut jumps instead)
        if (prev && !k.cut) for (const f of [0.25, 0.5, 0.75]) {
          const q = prev.clone().lerp(p, f), w = problem(q, null, walls, asc);
          if (w) bad.push(`${def.id} key ${i - 1}->${i}: path at ${f}: ${w}; at ${fmt(q)}`);
        }
        prev = p;
      });
    }
  }
  assert.ok(checked > 20, `only ${checked} keys resolved (${skipped} skipped)`);
  assert.deepEqual(bad, []);
});
});
