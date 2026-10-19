// Unit tests for src/core/renderer/shaderWarm.ts: the variant rows map to the right material options, and the table has
// no duplicate or unknown letters (a wrong row would warm a program the floor never asks for, and miss the one it does).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let w;
before(async () => { w = await load('src/core/renderer/shaderWarm.ts'); });

const MAP = { isTexture: true };

test('rows are unique and use only known letters', () => {
  assert.equal(new Set(w.ZOO_ROWS).size, w.ZOO_ROWS.length);
  for (const r of w.ZOO_ROWS) assert.match(r, /^[LmevdtaAFSNCicbkng]*$/, r);
});

test('letters map to material options', () => {
  const o = w.zooOpts('LNmvdA', MAP);
  assert.equal(o.lit, true);
  assert.equal(o.map, MAP);
  assert.equal(o.vertexColors, true);
  assert.equal(o.side, 'double');
  assert.equal(o.additive, true);
  assert.equal(o.affine, false);
  assert.equal(o.snap, true);
  assert.equal(o.fog, true);
  const p = w.zooOpts('', MAP);
  assert.deepEqual([p.lit, p.map, p.vertexColors, p.side, p.opacity, p.alphaTest, p.unique], [false, null, false, 'front', 1, 0, false]);
});

test('translucent, alpha test, no fog, no snap, scroll, and patched rows', () => {
  assert.equal(w.zooOpts('t', MAP).opacity, 0.5);
  assert.equal(w.zooOpts('a', MAP).alphaTest, 0.5);
  assert.equal(w.zooOpts('F', MAP).fog, false);
  assert.equal(w.zooOpts('S', MAP).snap, false);
  assert.deepEqual(w.zooOpts('C', MAP).scroll, [0.1, 0]);
  assert.equal(w.zooOpts('Ln', MAP).unique, true);
  assert.equal(w.zooOpts('Lk', MAP).unique, true);
  assert.equal(w.zooOpts('Li', MAP).unique, false);
});

test('the mirrored light-pool size matches the world pool', async () => {
  const { POOL_SIZE } = await load('src/world/sys/lightPool.ts');
  assert.equal(w.POOL_LIGHTS, POOL_SIZE);
});

test('the ghost rows: Loki\'s body, outfit and marks are warmed, and a ghost row is a patched (unique) material', () => {
  for (const r of ['Lvbkng', 'Ldng', 'Lvdng', 'Lvng', 'Lmvng', 'g']) assert.ok(w.ZOO_ROWS.includes(r), r);
  assert.equal(w.zooOpts('g', MAP).unique, true);
  assert.equal(w.zooOpts('g', MAP).lit, false, 'his marks are unlit');
});
