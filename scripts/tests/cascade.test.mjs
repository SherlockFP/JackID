// Gilded Cascade (src/machines/cascade): the rules are pure, so the tests run the real module. Covers the pay table, the
// tumble maths (a recorded spin replays to the same grid), orbs and the base / free multiplier, the free round and its
// retrigger, the max-win cap, determinism, EN/TR parity, the machine def, and a seeded 1e6-spin simulation of the RTP.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { load, closeVite, ROOT } from './_vite.mjs';

after(closeVite);

const R = await load('src/machines/cascade/rules.ts');
const { createRng } = await load('src/core/rng.ts');
const STR = (await load('src/machines/cascade/cascade.strings.ts')).default;

const SIM_SPINS = 1_000_000;

test('the pay table grows with the count and with the symbol, in whole half-bets', () => {
  assert.equal(R.PAY_H.length, R.SYM_N);
  for (const row of R.PAY_H) {
    assert.ok(row[0] <= row[1] && row[1] <= row[2], 'more of a kind never pays less');
    for (const h of row) assert.ok(Number.isInteger(h) && h >= 1);
  }
  for (let s = 1; s < R.SYM_N; s++) {
    assert.ok(R.PAY_H[s][2] >= R.PAY_H[s - 1][2], `symbol ${s} pays at least what symbol ${s - 1} pays at 12+`);
  }
  assert.equal(R.payFor(0, 7), 0, 'seven of a kind pays nothing');
  assert.equal(R.payFor(8, 8), 20);   // the gold coin: 10x
  assert.equal(R.payFor(8, 9), 20);
  assert.equal(R.payFor(8, 10), 50);
  assert.equal(R.payFor(8, 12), 100); // 50x
  assert.equal(R.payFor(8, 30), 100);
  assert.equal(R.scatterPay(3), 0);
  assert.equal(R.scatterPay(4), 6);   // 3x
  assert.equal(R.scatterPay(5), 10);  // 5x
  assert.equal(R.scatterPay(6), 200); // 100x
  assert.equal(R.scatterPay(9), 200);
});

test('findHits needs eight of a symbol; orbs and wheels never count', () => {
  const g = new Array(R.CELLS).fill(R.SCATTER);
  for (let i = 0; i < 7; i++) g[i] = 3;
  assert.deepEqual(R.findHits(g), []);
  g[7] = 3;
  assert.deepEqual(R.findHits(g), [[3, 8, R.PAY_H[3][0]]]);
  const orbs = new Array(R.CELLS).fill(R.ORB_AT + 5);
  assert.deepEqual(R.findHits(orbs), []);
  const two = new Array(R.CELLS).fill(1);
  for (let i = 0; i < 10; i++) two[i] = 5;
  const hits = R.findHits(two);
  assert.deepEqual(hits.map((h) => h[0]).sort(), [1, 5]);
  assert.equal(hits.find((h) => h[0] === 5)[1], 10);
});

test('applyStep: winners leave, the rest keeps its order and sinks, the refill fills from the top', () => {
  const g = Array.from({ length: R.CELLS }, (_, i) => (i % 5 === 2 ? 0 : 1 + (i % 4)));   // symbol 0 sits on row 2 of each column
  const hits = [[0, 6, 1]];
  const fill = [10, 11, 12, 13, 14, 15];
  const out = R.applyStep(g, hits, fill);
  assert.equal(out.length, R.CELLS);
  assert.ok(!out.some((c) => c === 0), 'nothing left of the winning symbol');
  for (let c = 0; c < R.COLS; c++) {
    assert.equal(out[R.at(c, 0)], fill[c], 'one new symbol on top of each column');
    const before = [0, 1, 2, 3, 4].map((r) => g[R.at(c, r)]).filter((x) => x !== 0);
    const after = [1, 2, 3, 4].map((r) => out[R.at(c, r)]);
    assert.deepEqual(after, before, 'survivors keep their order');
  }
});

test('a recorded spin replays to the same grid (the show and the maths cannot drift apart)', () => {
  const rng = createRng(2026);
  let withSteps = 0;
  for (let n = 0; n < 4000; n++) {
    const r = R.playSpin(rng, n % 2, n % 2 ? 12 : 0, 1, R.CAP_H);
    let g = r.g0.slice();
    let base = 0;
    for (const st of r.steps) {
      const hits = R.findHits(g);
      assert.deepEqual(hits, st.hits, 'the step hits are what the grid pays');
      assert.equal(st.fill.length, hits.reduce((a, h) => a + h[1], 0), 'one refill symbol per cleared cell');
      base += hits.reduce((a, h) => a + h[2], 0);
      g = R.applyStep(g, hits, st.fill);
    }
    assert.deepEqual(g, r.grid);
    assert.deepEqual(R.findHits(g), [], 'the spin ends when nothing pays');
    assert.equal(base, r.base);
    if (r.steps.length) withSteps++;
  }
  assert.ok(withSteps > 500, 'plenty of spins tumble');
});

test('orbs: x2 to x50, they stay on the grid, and the multiplier follows the base / free rules', () => {
  const rng = createRng(77);
  let sawBase = 0, sawFree = 0;
  for (let n = 0; n < 60000; n++) {
    const base = R.playSpin(rng, 0, 0, 1, R.CAP_H);
    let orbs = 0, wheels = 0;
    for (const c of base.grid) {
      if (R.isOrb(c)) { const v = R.orbValue(c); assert.ok(v >= 2 && v <= 50 && R.ORB_VALUES.includes(v)); orbs += v; } else if (c === R.SCATTER) wheels++;
    }
    assert.equal(base.orbs, orbs);
    assert.equal(base.scatters, wheels);
    assert.equal(base.mult, base.base > 0 && orbs > 0 ? orbs : 1, 'base: the orbs multiply a paying spin');
    if (!base.capped) assert.equal(base.win, base.base * base.mult + R.scatterPay(wheels));
    assert.equal(base.total, 0, 'no running total in the base game');
    if (base.base > 0 && orbs > 0) sawBase++;
    const free = R.playSpin(rng, 1, 9, 1, R.CAP_H);
    assert.equal(free.total, 9 + free.orbs, 'free: every orb adds to the total, win or not');
    assert.equal(free.mult, Math.max(1, free.total));
    assert.ok(free.total >= 9, 'the total never goes down inside the round');
    if (free.orbs > 0 && free.base === 0) sawFree++;
  }
  assert.ok(sawBase > 50, 'orbs do multiply paying base spins');
  assert.ok(sawFree > 50, 'a free spin with orbs and no win still adds to the total');
});

test('the max win cap: a spin never pays above the room it has left', () => {
  const rng = createRng(5);
  let capped = 0;
  for (let n = 0; n < 20000; n++) {
    const room = 1 + (n % 7);
    const r = R.playSpin(rng, 1, 40, 1, room);
    assert.ok(r.win <= room);
    if (r.capped) { capped++; assert.equal(r.win, room); }
  }
  assert.ok(capped > 100);
  assert.equal(R.CAP_X, 5000);
  assert.equal(R.CAP_H, 10000);
});

test('the free round: 15 spins, +5 on 3 wheels, never above 60, and the extra-spin hook is capped', () => {
  const f = R.startFeature(0);
  assert.equal(f.left, 15);
  assert.equal(R.startFeature(99).left, 20, 'the hook adds at most 5');
  const spin = (scatters, capped = false) => ({ scatters, capped, total: 7, win: 10 });
  assert.equal(R.advanceFeature(f, spin(2)), 0);
  assert.equal(f.left, 14);
  assert.equal(R.advanceFeature(f, spin(3)), 5);
  assert.equal(f.left, 18);
  assert.equal(f.spins, 20);
  assert.equal(f.total, 7);
  assert.equal(f.won, 20);
  // keep retriggering: the round stops growing at the cap
  for (let i = 0; i < 40; i++) R.advanceFeature(f, spin(4));
  assert.ok(f.spins <= R.MAX_FREE_SPINS);
  assert.equal(R.advanceFeature(R.startFeature(0), spin(4, true)), 0, 'a capped spin does not retrigger');
});

test('the same seed plays the same round, and luck only nudges the orb chance', () => {
  const run = (seed, luck) => { const rng = createRng(seed); return JSON.stringify(Array.from({ length: 300 }, () => R.playRound(rng, luck, 0))); };
  assert.equal(run(9, 0), run(9, 0));
  assert.notEqual(run(9, 0), run(10, 0));
  assert.equal(R.luckOrb(0), 1);
  assert.equal(R.luckOrb(10), 1.2);
  assert.equal(R.luckOrb(500), 1.5, 'capped');
  assert.equal(R.luckOrb(-4), 1, 'never below 1');
});

test('headless play: integer gross for every bet step, tags on a free round, nothing above the cap', () => {
  const rng = createRng(31);
  const h = { luck: 0, mod: (_hook, base) => base };
  let sawFree = false;
  for (let n = 0; n < 40000; n++) {
    const bet = R.BET_STEPS[n % R.BET_STEPS.length];
    const out = R.playHeadless(rng, bet, h);
    assert.ok(Number.isInteger(out.gross) && out.gross >= 0);
    assert.ok(out.gross <= bet * R.CAP_X);
    if (out.tags?.includes('freespins')) { sawFree = true; assert.ok(out.tags.includes('bonus')); }
  }
  assert.ok(sawFree);
  for (const b of R.BET_STEPS) assert.equal(b % 2, 0, 'bets are even so every pay is whole');
});

test(`seeded ${SIM_SPINS.toLocaleString('en')}-spin simulation: RTP about 96 %, a hit about every 3.5 spins`, () => {
  const rng = createRng(20261019);
  let paid = 0, hits = 0, firstH = 0, freeH = 0, rounds = 0, capped = 0, big = 0, max = 0, sq = 0;
  for (let n = 0; n < SIM_SPINS; n++) {
    const r = R.playRound(rng, 0, 0);
    paid += r.totalH; firstH += r.firstH; freeH += r.freeH;
    if (r.totalH > 0) hits++;
    if (r.triggered) rounds++;
    if (r.capped) capped++;
    if (r.totalH >= 20) big++;
    if (r.totalH > max) max = r.totalH;
    sq += (r.totalH / 2) ** 2;
  }
  const rtp = paid / 2 / SIM_SPINS;
  const hit = hits / SIM_SPINS;
  const sd = Math.sqrt(sq / SIM_SPINS - rtp * rtp);
  console.log(`cascade sim ${SIM_SPINS} spins: RTP ${(rtp * 100).toFixed(2)} % (base ${(firstH / 2 / SIM_SPINS * 100).toFixed(2)} + free ${(freeH / 2 / SIM_SPINS * 100).toFixed(2)}), `
    + `hit rate ${(hit * 100).toFixed(2)} %, free round 1 in ${(SIM_SPINS / Math.max(1, rounds)).toFixed(0)}, 10x+ 1 in ${(SIM_SPINS / Math.max(1, big)).toFixed(0)}, `
    + `capped ${capped}, best ${max / 2}x, sd ${sd.toFixed(1)}`);
  assert.ok(rtp > 0.93 && rtp < 0.99, `RTP ${rtp}`);
  assert.ok(hit > 0.26 && hit < 0.31, `hit rate ${hit}`);
  assert.ok(rounds > 1500 && rounds < 4000, `free rounds ${rounds}`);
  assert.ok(max <= R.CAP_H);
});

test('strings: EN and TR have the same keys and placeholders, and the TR is its own text', () => {
  assert.deepEqual(Object.keys(STR.en).sort(), Object.keys(STR.tr).sort());
  const ph = (s) => (String(s).match(/\{\w+\}/g) ?? []).sort().join(',');
  for (const k of Object.keys(STR.en)) {
    assert.equal(ph(STR.en[k]), ph(STR.tr[k]), `placeholders of ${k}`);
    assert.ok(STR.en[k].length > 0 && STR.tr[k].length > 0);
  }
  for (const k of ['name', 'desc', 'goal', 'rule1', 'rule4', 'bTease']) assert.notEqual(STR.en[k], STR.tr[k], `${k} is translated`);
  assert.equal(STR.prefix, 'm.cascade.');
  assert.ok(/Kasa/.test(STR.tr.rule1), 'the House is Kasa in Turkish');
});

test('the machine def is valid and registered by its folder name', async () => {
  const M = await load('src/machines/cascade/index.ts');
  const d = M.def;
  assert.equal(d.id, 'cascade');
  assert.equal(d.slotSize, 'M');
  assert.equal(d.seats, 1);
  assert.equal(d.shared, false);
  assert.equal(d.maxPayoutMult, 5000);
  assert.equal(d.minBet, 2);
  assert.equal(d.maxBet, 200);
  assert.deepEqual(d.betSteps, [...R.BET_STEPS]);
  assert.ok(d.strings.en.name && d.strings.tr.name && d.strings.en.desc && d.strings.tr.desc);
  assert.equal(typeof M.default, 'function');
  assert.equal(typeof M.playHeadless, 'function');
  assert.equal(d.headless, M.playHeadless);
  assert.ok(d.rtp >= 0.94 && d.rtp <= 0.97);
  for (const hook of Object.keys(d.modHooks)) assert.ok(hook === 'luck' || hook.startsWith('m.cascade.'));
});

test('no wall clock and no Math.random in the machine (outcomes come from the seeded stream)', () => {
  const dir = join(ROOT, 'src/machines/cascade');
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.ts'))) {
    const src = readFileSync(join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.ok(!/Math\.random|Date\.now|performance\.now|new Date\(/.test(src), `${f} reads no clock or Math.random`);
  }
});
