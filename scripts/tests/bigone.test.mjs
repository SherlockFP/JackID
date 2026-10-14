// Unit tests for The Big One's pure rules (src/machines/bigone/rules.ts): the feel contract (no refund-only hits, small hits
// pay at least 2x, patterns stack and tally smallest first), the near-miss tell, the EYE pattern, and the headless RTP.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let R, rngMod, STR;
before(async () => {
  R = await load('src/machines/bigone/rules.ts');
  rngMod = await load('src/core/rng.ts');
  STR = (await load('src/machines/bigone/strings.ts')).STRINGS;
});

const base = () => R.buildMods((_h, b) => b);
const spin = (rng, stake = 10, mods = base()) =>
  R.play(rng, stake, { mods, luck: 0, sinceCurse: rng.int(0, 9), wardOn: false, meter: 5000, maxStake: 100, prev: [], hold: -1 });

// grid helper: rows of five symbols (0 top .. 2 bottom)
const grid = (...rows) => rows.flat();

test('every positive line payout is at least twice the stake (no refund-only hits)', () => {
  const rng = rngMod.createRng(4242);
  let hits = 0;
  for (let i = 0; i < 60000; i++) {
    const o = spin(rng, 10);
    if (o.fill) continue;
    if (o.gross > 0) {
      hits++;
      assert.ok(o.gross >= 20, `gross ${o.gross} < 2x stake`);
    }
    for (const t of o.tally) assert.ok(t.amount >= 20, `${t.pat} paid ${t.amount}`);
  }
  assert.ok(hits > 5000, 'plenty of hits');
});

test('the tally is smallest first, combo grows by TUNE.combo per step, and the gross is the sum of the steps', () => {
  const rng = rngMod.createRng(99);
  let multi = 0;
  for (let i = 0; i < 80000; i++) {
    const o = spin(rng, 10);
    if (o.fill || o.curse) continue;
    let sum = 0;
    o.tally.forEach((t, k) => {
      assert.equal(t.combo, 1 + R.TUNE.combo * k);
      if (k > 0) assert.ok(t.raw >= o.tally[k - 1].raw, 'ascending raw');
      sum += t.amount;
    });
    assert.equal(o.gross, Math.min(sum, 10 * R.MAX_LINE_MULT));
    if (o.tally.length >= 2) multi++;
  }
  assert.ok(multi > 500, `stacked spins happen (${multi})`);
});

test('headless RTP is about 0.94 and the hit rate is 18-30 % over 300k spins', () => {
  const rng = rngMod.createRng(20261013);
  const h = { luck: 0, mod: (_k, b) => b };
  let sum = 0, hits = 0;
  const N = 300000;
  for (let i = 0; i < N; i++) {
    const g = R.playHeadless(rng, 10, h).gross;
    sum += g / 10;
    if (g > 0) hits++;
  }
  const rtp = sum / N;
  assert.ok(rtp > 0.9 && rtp < 0.99, `rtp ${rtp}`);
  assert.ok(hits / N > 0.18 && hits / N < 0.3, `hit ${hits / N}`);
});

test('EYE: a diamond ring pays, and a CROSS of the same symbol absorbs it', () => {
  const m = base();
  // EYE of CANDLE (3) around the centre cell (1,2): top (0,2), bottom (2,2), left (1,1), right (1,3); filler never repeats a symbol pair
  const g = grid([0, 1, 3, 2, 0], [1, 3, 5, 3, 1], [2, 0, 3, 4, 2]);
  const r = R.evaluate(g, m);
  assert.deepEqual(r.pays.map((p) => p.pat), ['EYE']);
  assert.equal(r.raw, m.values[3] * R.PATTERN_MULT.EYE);
  // fill the centre with the same symbol: CROSS pays, EYE is absorbed
  const g2 = g.slice();
  g2[7] = 3;
  const r2 = R.evaluate(g2, m);
  assert.deepEqual(r2.pays.map((p) => p.pat), ['CROSS']);
});

test('near-miss tell: a valuable pair or any trey slows the reel that would complete it', () => {
  // CROWN pair in row 1 (cols 0-1), col 2 differs: reel 2 anticipates a two-of-three
  const a = R.teaseInfo(grid([0, 1, 2, 3, 0], [5, 5, 2, 3, 1], [1, 0, 3, 2, 4]));
  assert.deepEqual(a && { reel: a.reel, row: a.row, len: a.len, sym: a.sym }, { reel: 2, row: 1, len: 2, sym: 5 });
  // a cheap pair does not tease
  assert.equal(R.teaseInfo(grid([0, 1, 2, 3, 0], [0, 0, 2, 3, 1], [1, 4, 3, 2, 4])), null);
  // a TREY of MOTH (cols 0-2) makes reel 3 anticipate a quad
  const b = R.teaseInfo(grid([0, 0, 0, 3, 1], [1, 2, 4, 2, 3], [4, 1, 3, 5, 2]));
  assert.deepEqual(b && { reel: b.reel, len: b.len }, { reel: 3, len: 3 });
  // a finished rail has nothing left to complete
  assert.equal(R.teaseInfo(grid([2, 2, 2, 2, 2], [1, 3, 4, 3, 1], [4, 1, 3, 5, 0])), null);
  // MAW breaks a run: the trey of MOTH is cut to a cheap pair, so nothing teases
  assert.equal(R.teaseInfo(grid([0, 0, 7, 0, 1], [1, 3, 4, 3, 2], [4, 2, 3, 0, 0])), null);
  // ... and a valuable pair cut by a MAW still asks the (dead) next reel
  const c = R.teaseInfo(grid([5, 5, 7, 5, 5], [1, 3, 4, 3, 2], [4, 2, 3, 0, 0]));
  assert.deepEqual(c && { reel: c.reel, len: c.len }, { reel: 2, len: 2 });
});

test('the tell is not constant: it fires on a minority of spins, and a missing tell-spin is tagged nearmiss', () => {
  const rng = rngMod.createRng(7);
  let tease = 0, near = 0;
  const N = 40000;
  for (let i = 0; i < N; i++) {
    const o = spin(rng, 10);
    if (o.tease) {
      tease++;
      assert.ok(o.teaseAt && o.teaseAt.reel >= 1 && o.teaseAt.reel <= 4);
    } else assert.equal(o.teaseAt, null);
    if (o.tags.includes('nearmiss')) { near++; assert.equal(o.gross, 0); }
  }
  assert.ok(tease / N > 0.03 && tease / N < 0.25, `tease ${tease / N}`);
  assert.ok(near > 0, 'some near-misses');
});

test('the paytable has 15 patterns, all with a multiplier of at least 2 except CLUSTER (n-5) and no refund tier', () => {
  assert.equal(R.PATTERN_IDS.length, 15);
  for (const p of R.PATTERN_IDS) {
    if (p === 'CLUSTER') continue;
    assert.ok(R.PATTERN_MULT[p] >= 2, `${p} x${R.PATTERN_MULT[p]}`);
  }
});

test('EN and TR strings carry the same keys, including the tally and the EYE pattern', () => {
  const en = Object.keys(STR.en).sort();
  const tr = Object.keys(STR.tr).sort();
  assert.deepEqual(en, tr);
  for (const k of ['pat_EYE', 'tCombo', 'tTotal', 'tMore', 'rule4', 'rule5']) assert.ok(STR.en[k] && STR.tr[k], k);
  for (const p of R.PATTERN_IDS) assert.ok(STR.en[`pat_${p}`] && STR.tr[`pat_${p}`], p);
});
