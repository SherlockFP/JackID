// Lootbox headless RTP regression (src/machines/lootbox). The headless play used to be read at a 1-coin stake while a
// TIN capsule costs 10, so sim-profiles reported RTP 9.05 (905 %). These tests pin the value RTP of each tier from the
// tier table (analytic, no RNG), the Monte Carlo match of the headless play, and that the stake no longer changes it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let RU, R, DEF;
before(async () => {
  RU = await load('src/machines/lootbox/rules.ts');
  R = await load('src/core/rng.ts');
  DEF = (await load('src/machines/lootbox/index.ts')).def;
});

const CHARM_RARITIES = ['common', 'uncommon', 'rare', 'legendary', 'cursed'];

/** Value RTP of one capsule of a tier at SI 1 with the empty charm pool (the headless contract), from the tier table. */
function analyticRtp(tier) {
  const t = RU.TIERS[tier];
  const coinW = t.coins.reduce((s, c) => s + c.w, 0);
  const coinMean = t.coins.reduce((s, c) => s + c.amount * c.w, 0) / coinW;
  let ev = (t.weights.coins / 10000) * coinMean;
  for (const r of CHARM_RARITIES) ev += (t.weights[r] / 10000) * RU.REF_PRICE[r];
  return ev / t.price;
}

test('the cheapest capsule (TIN) is the stake floor, so no stake can buy a capsule below its price', () => {
  assert.equal(DEF.minBet, RU.TIERS[0].price);
  assert.equal(DEF.betSteps[0], RU.TIERS[0].price);
});

test('the weights of each tier sum to 10 000 basis points and the coin amounts to the coin weight', () => {
  for (const t of RU.TIERS) {
    const sum = Object.values(t.weights).reduce((s, w) => s + w, 0);
    assert.equal(sum, 10000, `${t.id} weights sum`);
    assert.equal(t.coins.reduce((s, c) => s + c.w, 0), t.weights.coins, `${t.id} coin amounts`);
  }
});

test('TIN value RTP is about 0.90 (9.04 coins back on a 10-coin capsule), not 9.05', () => {
  const rtp = analyticRtp(0);
  assert.ok(Math.abs(rtp - 0.904) < 1e-9, `analytic TIN RTP ${rtp}`);
});

test('every tier is a house edge (value RTP below 1) and above 0.5', () => {
  for (let t = 0; t < RU.TIERS.length; t++) {
    const rtp = analyticRtp(t);
    assert.ok(rtp < 1 && rtp > 0.5, `tier ${RU.TIERS[t].id} RTP ${rtp}`);
  }
});

test('headless Monte Carlo at the TIN price matches the analytic TIN RTP', () => {
  const rng = R.createRng(20260613);
  const hooks = { luck: 0, mod: (_h, base) => base };
  const n = 400_000;
  const bet = RU.TIERS[0].price;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += RU.playHeadless(rng, bet, hooks).gross;
  const rtp = sum / n / bet;
  assert.ok(Math.abs(rtp - analyticRtp(0)) < 0.01, `MC TIN RTP ${rtp}`);
});

test('a 1-coin stake gives the same value RTP as a 10-coin stake (the 905 % regression)', () => {
  const hooks = { luck: 0, mod: (_h, base) => base };
  const a = R.createRng(77);
  const b = R.createRng(77);
  for (let i = 0; i < 20_000; i++) {
    const g1 = RU.playHeadless(a, 1, hooks).gross;
    const g10 = RU.playHeadless(b, 10, hooks).gross;
    assert.ok(Math.abs(g1 * 10 - g10) < 1e-9, `play ${i}: stake 1 paid ${g1}, stake 10 paid ${g10}`);
  }
  const rng = R.createRng(99);
  let sum = 0;
  for (let i = 0; i < 200_000; i++) sum += RU.playHeadless(rng, 1, hooks).gross;
  const rtp1 = sum / 200_000 / 1;
  assert.ok(rtp1 < 1, `RTP at a 1-coin stake ${rtp1} must stay below 1`);
  assert.ok(Math.abs(rtp1 - analyticRtp(0)) < 0.01, `RTP at a 1-coin stake ${rtp1}`);
});
