// The identity pass (docs/ART.md "Identity"): the Boiler's precast panels split around their gaps, and the bilingual signs have both tables.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);
let I, S;
before(async () => {
  I = await load('src/world/props/identity.ts');
  S = (await load('src/world/props/props.strings.ts')).default;
});

test('panelSpans: panels no wider than w, never inside a gap, covering the rest of the run', () => {
  const spans = I.panelSpans(11.15, 30.85, [[20.4, 23.6]], 1.5);
  for (const [a, b] of spans) {
    assert.ok(b - a <= 1.5 + 1e-9 && b > a);
    assert.ok(b <= 20.4 + 1e-9 || a >= 23.6 - 1e-9, `panel ${a}..${b} crosses the neon`);
  }
  const covered = spans.reduce((n, [a, b]) => n + (b - a), 0);
  assert.ok(Math.abs(covered - ((20.4 - 11.15) + (30.85 - 23.6))) < 1e-9);
});

test('panelSpans: a span under half a metre is dropped, gaps out of the run are ignored', () => {
  assert.deepEqual(I.panelSpans(0, 3, [[0.3, 2.8]], 1.5), []);
  assert.deepEqual(I.panelSpans(0, 3, [[-5, -4], [9, 10]], 1.5), [[0, 1.5], [1.5, 3]]);
});

test('identity signs: every key has EN and TR, slogans are translated', () => {
  const keys = Object.keys(S.en).filter((k) => k.startsWith('id.'));
  assert.ok(keys.length >= 13);
  for (const k of keys) assert.ok(S.tr[k], `tr ${k}`);
  for (const i of [0, 1, 2]) assert.notEqual(S.en[`id.slogan${i}`], S.tr[`id.slogan${i}`]);
  assert.equal(S.tr['id.casino'], 'KASİNO');
});
