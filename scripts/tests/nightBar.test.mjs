// Unit tests for the HUD night timeline maths (src/menu/hud/nightBar.ts): which Watch segment is current, how full each one is,
// the Mola's next Watch, the amber (last 60 s) and red (last Watch) flags, Dawn, and the "m:ss" readout. Pure: no DOM, no app.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let nb;
before(async () => {
  nb = await load('src/menu/hud/nightBar.ts');
});

const base = { phase: 'play', seg: 0, count: 3, left: 150, duration: 150, settled: false };

test('in a Watch: finished segments are solid, the current one fills with elapsed time, the rest are empty', () => {
  assert.deepEqual(nb.barView({ ...base, seg: 1, left: 75 }).fill, [1, 0.5, 0]);
  const v = nb.barView({ ...base, seg: 1, left: 75 });
  assert.equal(v.cur, 1);
  assert.equal(v.next, -1);
  assert.equal(v.dawn, false);
  assert.deepEqual(nb.barView({ ...base, phase: 'bell', seg: 2, left: 0 }).fill, [1, 1, 0], 'the Bell starts the Watch empty');
  assert.deepEqual(nb.barView({ ...base, phase: 'closing', left: 0 }).fill, [1, 0, 0], 'closing: full');
});

test('amber flag: only the last 60 s of a Watch in play, never at the Bell', () => {
  assert.equal(nb.barView({ ...base, left: 61 }).soon, false);
  assert.equal(nb.barView({ ...base, left: 60 }).soon, true);
  assert.equal(nb.barView({ ...base, phase: 'lastCall', left: 20 }).soon, true);
  assert.equal(nb.barView({ ...base, phase: 'bell', left: 0 }).soon, false);
});

test('red flag: the Night\'s last Watch (also an overtime Watch), no other', () => {
  assert.equal(nb.barView({ ...base, seg: 1 }).last, false);
  assert.equal(nb.barView({ ...base, seg: 2 }).last, true);
  assert.equal(nb.barView({ ...base, seg: 3, count: 4 }).last, true);
  assert.equal(nb.barView({ ...base, phase: 'intermission', seg: 2 }).last, false, 'a Mola is not a Watch');
});

test('Mola: the next Watch is the one after the settled Watch; before Watch 1 it is Watch 1', () => {
  const first = nb.barView({ ...base, phase: 'intermission', seg: 0, left: 0 });
  assert.deepEqual([first.cur, first.next, first.fill], [-1, 0, [0, 0, 0]]);
  const mola = nb.barView({ ...base, phase: 'intermission', seg: 0, left: 0, settled: true });
  assert.deepEqual([mola.cur, mola.next, mola.fill], [-1, 1, [1, 0, 0]]);
  assert.equal(nb.barView({ ...base, phase: 'settle', seg: 1, left: 0 }).next, 2, 'settling Watch 2 leads to Watch 3');
});

test('Dawn: after the last Watch settles, every segment is solid and nothing is next', () => {
  const v = nb.barView({ ...base, phase: 'settle', seg: 2, left: 0 });
  assert.deepEqual([v.dawn, v.next, v.fill], [true, -1, [1, 1, 1]]);
  assert.equal(nb.barView({ ...base, phase: 'collection', seg: 2, left: 0 }).dawn, true);
});

test('junk input stays inside 0..1 and the readout rounds up', () => {
  assert.deepEqual(nb.barView({ ...base, left: 999 }).fill, [0, 0, 0]);
  assert.deepEqual(nb.barView({ ...base, left: Number.NaN, duration: 0 }).fill, [0, 0, 0]);
  assert.equal(nb.leftText(293.2), '4:54');
  assert.equal(nb.leftText(60), '1:00');
  assert.equal(nb.leftText(9), '0:09');
  assert.equal(nb.leftText(-3), '0:00');
});
