// Unit tests for THE CIRCUIT (src/game/circuit.ts, GDD §3.4) and the Obol maths (src/game/data/schedule.ts, GDD §11.2).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let C, S, R;
before(async () => {
  C = await load('src/game/circuit.ts');
  S = await load('src/game/data/schedule.ts');
  R = await load('src/core/rng.ts');
});

const cands = (n) => Array.from({ length: n }, (_, i) => ({ mid: `m${String(i).padStart(2, '0')}`, machineId: i % 2 ? 'bigone' : 'blackjack' }));

test('tilt: pulls 1-4 are full value, then x0.8 / x0.6 / x0.4 from the 7th', () => {
  const got = [1, 2, 3, 4, 5, 6, 7, 8, 12].map((n) => C.tiltFactor(n));
  assert.deepEqual(got, [1, 1, 1, 1, 0.8, 0.6, 0.4, 0.4, 0.4]);
});

test('tilt: grace pushes the thresholds back, negative grace pulls them forward', () => {
  assert.equal(C.tiltFactor(5, 2), 1);
  assert.equal(C.tiltFactor(6, 2), 1);
  assert.equal(C.tiltFactor(7, 2), 0.8);
  assert.equal(C.tiltFactor(9, 2), 0.4);
  assert.equal(C.tiltFactor(4, -1), 0.8);
});

test('tilt: the Tilt Switch table is harsher but keeps tier 0 at full value', () => {
  assert.equal(C.tiltFactor(4, 0, true), 1);
  assert.deepEqual([5, 6, 7].map((n) => C.tiltFactor(n, 0, true)), [0.75, 0.55, 0.35]);
});

test('tilt: bulbs count full-value pulls left, clamped to 0..4', () => {
  assert.deepEqual([0, 1, 3, 4, 5, 9].map((n) => C.tiltBulbs(n)), [4, 3, 1, 0, 0, 0]);
  assert.equal(C.tiltBulbs(0, 3), 4);
  assert.equal(C.tiltBulbs(5, 3), 2);
});

test('circuit: plays count per instance, the most played wins ties by first play, settle resets', () => {
  const c = new C.Circuit();
  c.addPlays('a', 2); c.addPlays('b', 2); c.addPlays('b', 1);
  assert.equal(c.firstPlayed(), 'a');
  assert.equal(c.playsOf('b'), 3);
  assert.equal(c.mostPlayed(), 'b');
  c.addPlays('a', 1);
  assert.equal(c.mostPlayed(), 'a');                       // 3 v 3: a was played first
  c.addPlays('c', 0);                                      // a free action never counts
  assert.equal(c.playsOf('c'), 0);
  c.settle();
  assert.equal(c.playsOf('a'), 0);
  assert.equal(c.firstPlayed(), null);
});

test('lamps: the roll is deterministic for a seed and independent of candidate order', () => {
  const list = cands(12);
  const a = C.rollLamps(R.createRng(R.hashSeed('lamps', 7, 1, 0)), list, { hot: 2, cold: 1 });
  const b = C.rollLamps(R.createRng(R.hashSeed('lamps', 7, 1, 0)), [...list].reverse(), { hot: 2, cold: 1 });
  assert.deepEqual(a, b);
  assert.equal(a.hot.length, 2);
  assert.equal(a.cold.length, 1);
  const other = C.rollLamps(R.createRng(R.hashSeed('lamps', 8, 1, 0)), list, { hot: 2, cold: 1 });
  const seen = new Set([JSON.stringify(a)]);
  for (let s = 9; s < 30; s++) seen.add(JSON.stringify(C.rollLamps(R.createRng(R.hashSeed('lamps', s, 1, 0)), list, { hot: 2, cold: 1 })));
  assert.ok(seen.size > 1 && other.hot.length === 2, 'different seeds vary');
});

test('lamps: Hot and Cold never share an instance, never repeat Hot, never make a new machine Cold', () => {
  const list = cands(6);
  for (let s = 0; s < 200; s++) {
    const r = C.rollLamps(R.createRng(s), list, { hot: 2, cold: 2, prevHot: ['m00', 'm01'], fresh: ['m05'] });
    assert.ok(!r.hot.includes('m00') && !r.hot.includes('m01'), 'prev Hot excluded');
    assert.ok(!r.cold.includes('m05'), 'fresh machine is not Cold');
    assert.ok(r.cold.every((m) => !r.hot.includes(m)), 'disjoint');
    assert.equal(new Set(r.hot).size, r.hot.length);
  }
});

test('lamps: asking for more lamps than candidates yields what exists, an empty floor yields none', () => {
  assert.deepEqual(C.rollLamps(R.createRng(1), [], { hot: 2, cold: 1 }), { hot: [], cold: [] });
  const r = C.rollLamps(R.createRng(1), cands(2), { hot: 5, cold: 5 });
  assert.equal(r.hot.length, 2);
  assert.equal(r.cold.length, 0);
});

test('circuit: startWatch rolls, remembers Hot for the next Watch and keeps new machines out of Cold', () => {
  const c = new C.Circuit();
  const list = cands(8);
  const first = c.startWatch(R.createRng(R.hashSeed('lamps', 3, 1, 0)), list, { lamps: true, hot: 1, cold: 1, newIsHot: false });
  assert.equal(first.hot.length, 1);
  assert.ok(c.isHot(first.hot[0]));
  assert.ok(c.isCold(first.cold[0]));
  c.settle();
  assert.equal(c.hot().length, 0);
  const grown = [...list, { mid: 'zz', machineId: 'plinko' }];
  for (let s = 0; s < 100; s++) {
    const probe = new C.Circuit(); probe.restore(c.snapshot());
    const next = probe.startWatch(R.createRng(s), grown, { lamps: true, hot: 1, cold: 1, newIsHot: false });
    assert.ok(!next.hot.includes(first.hot[0]), 'not Hot two Watches running');
    assert.ok(!next.cold.includes('zz'), 'a machine new this Watch is never Cold');
  }
  const ribbon = new C.Circuit(); ribbon.restore(c.snapshot());
  assert.ok(ribbon.startWatch(R.createRng(5), grown, { lamps: true, hot: 1, cold: 1, newIsHot: true }).hot.includes('zz'), 'Grand Opening Ribbon');
});

test('circuit: no lamps before the first Lamp Night, and snapshot/restore round-trips', () => {
  const c = new C.Circuit();
  const none = c.startWatch(R.createRng(1), cands(5), { lamps: false, hot: 1, cold: 1, newIsHot: false });
  assert.deepEqual(none, { hot: [], cold: [] });
  c.startWatch(R.createRng(2), cands(5), { lamps: true, hot: 1, cold: 1, newIsHot: false });
  c.addPlays('m01', 3);
  const snap = JSON.parse(JSON.stringify(c.snapshot()));
  const d = new C.Circuit(); d.restore(snap);
  assert.deepEqual(d.snapshot(), c.snapshot());
  assert.equal(d.playsOf('m01'), 3);
});

test('schedule: Hot Lamp count is 1 from Night 1 (2 from Night 5); Cold from Night 2 only', () => {
  assert.deepEqual([1, 2, 4, 5, 8].map(S.hotLampCount), [1, 1, 1, 2, 2]);
  assert.equal(S.LAMP_FIRST_NIGHT, 1);
  assert.equal(S.COLD_FIRST_NIGHT, 2);
  assert.deepEqual([1, 2, 3].map((n) => S.coldLampCount(n)), [0, 1, 1]);
  assert.equal(S.coldLampCount(2, 2), 3, 'x.lamp.coldCount adds on top of the one Cold Lamp');
  assert.equal(S.coldLampCount(1, 5), 0, 'no Cold Lamp on Night 1 whatever the charms');
  assert.equal(S.coldLampCount(3, -5), 0, 'never below zero');
});

test('schedule: the quota ladder is strictly increasing and Night 1 opens with at most half its quota in the pocket (wave 85: 12 of 24)', () => {
  assert.ok(2 * S.START.pocket <= S.BASE_NIGHTS[0].base, 'the starting pocket is at most half of Night 1 (it was 30 against 24: the quota was paid at once)');
  assert.ok(S.BASE_NIGHTS.every((n, i, a) => i === 0 || n.base > a[i - 1].base), 'quota ladder strictly increasing');
});

test('obols: GDD §11.2 examples and the outcome multipliers', () => {
  // fall at Night 5, about 6K deposited: floor(0.6 x 18.1) = 10, x0.5 = 5
  assert.equal(S.obolsFor({ deposited: 6000, outcome: 'fell' }), 5);
  // win, STAY UP at 1.34M: 66 x 1.5 = 99
  assert.equal(S.obolsFor({ deposited: 1_340_000, outcome: 'topside' }), 99);
  assert.equal(S.obolsFor({ deposited: 1_340_000, outcome: 'descend' }), 66);
  assert.equal(S.obolsFor({ deposited: 1_340_000, outcome: 'quit' }), 16);
  assert.equal(S.obolsFor({ deposited: 0, outcome: 'descend' }), 0);
});

test('obols: House Edge and Foundations gain scale the payout, outcome order is fell < quit-free < descend < topside', () => {
  assert.equal(S.obolsFor({ deposited: 1_000_000, outcome: 'descend', edge: 2 }), 72);           // 60 x 1.2
  assert.equal(S.obolsFor({ deposited: 1_000_000, outcome: 'descend', gain: 1.1 }), 66);         // 60 x 1.1
  const o = (k) => S.obolsFor({ deposited: 250_000, outcome: k });
  assert.ok(o('quit') < o('fell') && o('fell') < o('descend') && o('descend') < o('topside'));
});
