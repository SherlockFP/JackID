// Unit tests for src/machines/_base/reels.ts (TECH_SPEC §3.7). The conventions tested come from the module header:
// strips are circular, the stop sits on the payline (middle row), grids are column-major grid[reel][row], and
// pays[symbol][n] is the multiplier for exactly n matching symbols. Skipped until the module exists.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite, hasModule } from './_vite.mjs';

after(closeVite);
const MOD = 'src/machines/_base/reels.ts';
const skip = hasModule(MOD) ? false : `${MOD} does not exist yet`;

test('spin() returns one in-range stop index per strip', { skip }, async () => {
  const { spin } = await load(MOD);
  const { createRng } = await load('src/core/rng.ts');
  const strips = [
    { symbols: ['A', 'B', 'C', 'D'] },
    { symbols: ['X', 'Y'], weights: [1, 3] },
    { symbols: Array.from({ length: 30 }, (_, i) => `S${i}`) },
  ];
  const stops = spin(createRng(4), strips);
  assert.equal(stops.length, strips.length);
  stops.forEach((s, i) => assert.ok(Number.isInteger(s) && s >= 0 && s < strips[i].symbols.length, `reel ${i}: ${s}`));
});

test('spin() is a pure function of the rng state', { skip }, async () => {
  const { spin } = await load(MOD);
  const { createRng } = await load('src/core/rng.ts');
  const strips = [{ symbols: ['A', 'B', 'C', 'D', 'E'] }, { symbols: ['P', 'Q', 'R'] }];
  assert.deepEqual(spin(createRng(11), strips), spin(createRng(11), strips));
});

test('spin() never stops on a zero-weight or zero-biased symbol', { skip }, async () => {
  const { spin } = await load(MOD);
  const { createRng } = await load('src/core/rng.ts');
  const rng = createRng(12);
  for (let i = 0; i < 300; i++) {
    assert.deepEqual(spin(rng, [{ symbols: ['A', 'B', 'C'] }], (_reel, s) => (s === 'B' ? 1 : 0)), [1]);
    assert.deepEqual(spin(rng, [{ symbols: ['A', 'B'], weights: [0, 1] }]), [1]);
  }
});

test('windowOf() centres the payline and wraps around the strip', { skip }, async () => {
  const { windowOf } = await load(MOD);
  const strip = { symbols: ['A', 'B', 'C', 'D'] };
  assert.deepEqual(windowOf(strip, 2, 3), ['B', 'C', 'D']);
  assert.deepEqual(windowOf(strip, 0, 3), ['D', 'A', 'B']);
});

test('windowOf() returns a contiguous cyclic window for every stop', { skip }, async () => {
  const { windowOf } = await load(MOD);
  const symbols = ['A', 'B', 'C', 'D', 'E'];
  const rotations = symbols.map((_, o) => symbols.map((_, k) => symbols[(o + k) % symbols.length]));
  for (let stop = 0; stop < symbols.length; stop++) {
    const w = windowOf({ symbols }, stop, symbols.length);
    assert.equal(w.length, symbols.length);
    assert.ok(rotations.some((r) => r.every((s, k) => s === w[k])), `stop ${stop} gave ${w.join(',')}`);
  }
});

test('gridOf() is column-major and matches windowOf() per reel', { skip }, async () => {
  const { gridOf, windowOf } = await load(MOD);
  const strips = [{ symbols: ['A', 'B', 'C', 'D'] }, { symbols: ['P', 'Q', 'R'] }];
  const stops = [2, 0];
  const grid = gridOf(strips, stops, 3);
  assert.equal(grid.length, strips.length);
  strips.forEach((s, c) => assert.deepEqual(grid[c], windowOf(s, stops[c], 3)));
});

test('stopsOf(), findStop() and stopChance() describe where a symbol sits', { skip }, async () => {
  const { stopsOf, findStop, stopChance } = await load(MOD);
  const { createRng } = await load('src/core/rng.ts');
  const strip = { symbols: ['A', 'B', 'A', 'C'] };
  assert.deepEqual(stopsOf(strip, 'A'), [0, 2]);
  assert.equal(findStop(strip, 'A'), 0);
  assert.equal(findStop(strip, 'Z'), -1);
  assert.ok([0, 2].includes(findStop(strip, 'A', createRng(1))));
  assert.ok(Math.abs(stopChance({ symbols: ['X', 'Y'], weights: [1, 3] }, 'Y') - 0.75) < 1e-12);
  assert.equal(stopChance(strip, 'Z'), 0);
});

test('evalLines() pays a run from the left at the table multiplier', { skip }, async () => {
  const { evalLines } = await load(MOD);
  const grid = [['A', 'B', 'C'], ['A', 'X', 'C'], ['A', 'Y', 'C']];
  const lines = [[0, 0, 0], [1, 1, 1], [2, 2, 2]];
  // Line 1 (B X Y) has no pay for a single B; line 2 (C C C) has no pay entry for three C.
  assert.deepEqual(evalLines(grid, lines, { A: [0, 0, 0, 10] }), [{ line: 0, symbol: 'A', count: 3, mult: 10 }]);
});

test('evalLines() lets a wild stand in for the symbol it completes', { skip }, async () => {
  const { evalLines } = await load(MOD);
  const grid = [['A'], ['W'], ['A']];
  assert.deepEqual(evalLines(grid, [[0, 0, 0]], { A: [0, 0, 0, 10] }, 'W'), [{ line: 0, symbol: 'A', count: 3, mult: 10 }]);
});

test('evalLines() pays leading wilds as wilds when the wild table is better', { skip }, async () => {
  const { evalLines } = await load(MOD);
  const grid = [['W'], ['W'], ['A']];
  const pays = { W: [0, 0, 50], A: [0, 0, 0, 10] };
  assert.deepEqual(evalLines(grid, [[0, 0, 0]], pays, 'W'), [{ line: 0, symbol: 'W', count: 2, mult: 50 }]);
});

test('evalLines() returns only winning lines, in line order', { skip }, async () => {
  const { evalLines } = await load(MOD);
  const grid = [['A', 'B'], ['A', 'C'], ['A', 'D']];
  const lines = [[0, 0, 0], [1, 1, 1], [0, 0, 1]];
  assert.deepEqual(evalLines(grid, lines, { A: [0, 0, 2, 10] }), [
    { line: 0, symbol: 'A', count: 3, mult: 10 },
    { line: 2, symbol: 'A', count: 2, mult: 2 },
  ]);
});

test('evalPatterns() awards a pattern whose cells all match, scaled by symbol multipliers', { skip }, async () => {
  const { evalPatterns } = await load(MOD);
  const grid = [['A', 'B'], ['A', 'C']];
  const patterns = [
    { id: 'col', cells: [[0, 0], [0, 1]], mult: 3 },
    { id: 'diag', cells: [[0, 0], [1, 0]], mult: 5 },
  ];
  assert.deepEqual(evalPatterns(grid, patterns), [{ id: 'diag', symbol: 'A', mult: 5 }]);
  assert.deepEqual(evalPatterns(grid, patterns, undefined, { A: 2 }), [{ id: 'diag', symbol: 'A', mult: 10 }]);
});

test('evalPatterns() lets wilds complete a pattern and ignores cells off the grid', { skip }, async () => {
  const { evalPatterns } = await load(MOD);
  const grid = [['A', 'W'], ['A', 'B']];
  assert.deepEqual(evalPatterns(grid, [{ id: 'p', cells: [[0, 0], [0, 1], [1, 0]], mult: 4 }], 'W'),
    [{ id: 'p', symbol: 'A', mult: 4 }]);
  assert.deepEqual(evalPatterns(grid, [{ id: 'off', cells: [[0, 0], [5, 0]], mult: 4 }]), []);
  assert.deepEqual(evalPatterns([['W', 'W']], [{ id: 'all', cells: [[0, 0], [0, 1]], mult: 2 }], 'W'),
    [{ id: 'all', symbol: 'W', mult: 2 }]);
});

test('countSymbol() counts every matching cell in the grid', { skip }, async () => {
  const { countSymbol } = await load(MOD);
  assert.equal(countSymbol([['A', 'B'], ['A', 'A']], 'A'), 3);
});

test('nearMissLine() reports the reel that broke an otherwise matching line', { skip }, async () => {
  const { nearMissLine } = await load(MOD);
  assert.equal(nearMissLine([['A'], ['A'], ['B']], [0, 0, 0], 'A'), 2);
  assert.equal(nearMissLine([['A'], ['W'], ['B']], [0, 0, 0], 'A', 3, 'W'), 2);
  assert.equal(nearMissLine([['A'], ['A'], ['A']], [0, 0, 0], 'A'), -1);
  assert.equal(nearMissLine([['A'], ['B'], ['C']], [0, 0, 0], 'A'), -1);
});
