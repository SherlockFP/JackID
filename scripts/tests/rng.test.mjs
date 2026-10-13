// Unit tests for src/core/rng.ts (TECH_SPEC §2.8): determinism, ranges, state round-trip and forking.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let createRng, hashSeed;
before(async () => { ({ createRng, hashSeed } = await load('src/core/rng.ts')); });

const draw = (rng, n) => Array.from({ length: n }, () => rng.next());

test('same numeric and string seeds give identical streams', () => {
  assert.deepEqual(draw(createRng(12345), 1000), draw(createRng(12345), 1000));
  assert.deepEqual(draw(createRng('table-7'), 1000), draw(createRng('table-7'), 1000));
});

test('different seeds diverge', () => {
  assert.notDeepEqual(draw(createRng(1), 16), draw(createRng(2), 16));
});

test('numeric seed is exposed as a uint32', () => {
  assert.equal(createRng(42).seed, 42);
  const s = createRng('lobby').seed;
  assert.ok(Number.isInteger(s) && s >= 0 && s <= 0xffffffff);
});

test('next() stays in [0, 1)', () => {
  for (const v of draw(createRng(99), 10000)) assert.ok(v >= 0 && v < 1, `out of range: ${v}`);
});

test('int() is inclusive at both ends and never leaves the range', () => {
  const r = createRng(5);
  const seen = new Set();
  for (let i = 0; i < 5000; i++) {
    const v = r.int(1, 6);
    assert.ok(Number.isInteger(v) && v >= 1 && v <= 6, `bad die value ${v}`);
    seen.add(v);
  }
  assert.equal(seen.size, 6);
});

test('float() stays within [min, max)', () => {
  const r = createRng(6);
  for (let i = 0; i < 5000; i++) {
    const v = r.float(-2, 3);
    assert.ok(v >= -2 && v < 3, `out of range: ${v}`);
  }
});

test('chance(0) never fires and chance(1) always fires', () => {
  const r = createRng(7);
  for (let i = 0; i < 2000; i++) {
    assert.equal(r.chance(0), false);
    assert.equal(r.chance(1), true);
  }
});

test('pick() returns members of the array only', () => {
  const items = ['A', 'B', 'C'];
  const r = createRng(8);
  for (let i = 0; i < 1000; i++) assert.ok(items.includes(r.pick(items)));
});

test('weightedIndex() never picks a zero weight', () => {
  const r = createRng(9);
  const hit = new Set();
  for (let i = 0; i < 4000; i++) hit.add(r.weightedIndex([0, 1, 0, 3]));
  assert.deepEqual([...hit].sort(), [1, 3]);
});

test('weightedIndex() stays in range when every weight is zero', () => {
  const r = createRng(10);
  for (let i = 0; i < 200; i++) {
    const v = r.weightedIndex([0, 0, 0]);
    assert.ok(v >= 0 && v < 3);
  }
});

test('shuffle() permutes in place and keeps the multiset', () => {
  const a = Array.from({ length: 52 }, (_, i) => i);
  const before = [...a];
  const out = createRng(3).shuffle(a);
  assert.equal(out, a);
  assert.deepEqual([...a].sort((x, y) => x - y), before);
  assert.notDeepEqual(a, before);
});

test('gauss() is centred on its mean', () => {
  const r = createRng(21);
  const n = 20000;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += r.gauss(10, 2);
  assert.ok(Math.abs(sum / n - 10) < 0.1, `mean ${sum / n}`);
});

test('getState()/setState() resume the stream exactly', () => {
  const r = createRng(77);
  draw(r, 5);
  const state = r.getState();
  const expected = draw(r, 20);
  r.setState(state);
  assert.deepEqual(draw(r, 20), expected);
});

test('fork() is deterministic per label and ignores the parent position', () => {
  const p1 = createRng(10), p2 = createRng(10);
  draw(p2, 100);
  assert.deepEqual(draw(p1.fork('bet'), 32), draw(p2.fork('bet'), 32));
  assert.notDeepEqual(draw(createRng(10).fork('bet'), 32), draw(createRng(10).fork('spin'), 32));
});

test('hashSeed() is stable, uint32 and separator-sensitive', () => {
  const h = hashSeed(12, 'coinflip', 3);
  assert.equal(h, hashSeed(12, 'coinflip', 3));
  assert.ok(Number.isInteger(h) && h >= 0 && h <= 0xffffffff);
  assert.notEqual(h, hashSeed(12, 'coinflip', 4));
  assert.notEqual(hashSeed('a', 'b'), hashSeed('ab'));
});
