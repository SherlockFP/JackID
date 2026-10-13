// Unit tests for the pace maths (src/game/pace.ts, WAVE8 item 5) and the generated odds profiles
// (src/game/data/machineProfiles.ts).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let P, M;
before(async () => {
  P = await load('src/game/pace.ts');
  M = await load('src/game/data/machineProfiles.ts');
});

// A hand-made profile with round numbers, so the interpolation can be checked by hand.
const SYN = { hit: 0.4, p2: 0.2, p5: 0.05, p10: 0.01, p25: 0.001, p100: 0 };

test('paceOf: need = due - deposited - pocket, spread over the pulls left', () => {
  const p = P.paceOf({ due: 1000, deposited: 300, pocket: 200, pullsLeft: 10 });
  assert.equal(p.need, 500);
  assert.equal(p.perPull, 50);
  assert.equal(p.pullsLeft, 10);
  assert.equal(p.state, 'open');
});

test('paceOf: met once deposited plus pocket cover the quota, need never negative', () => {
  const p = P.paceOf({ due: 1000, deposited: 700, pocket: 300, pullsLeft: 4 });
  assert.deepEqual([p.need, p.perPull, p.state], [0, 0, 'met']);
  assert.equal(P.paceOf({ due: 100, deposited: 900, pocket: 0, pullsLeft: 0 }).state, 'met');
});

test('paceOf: dead when coins are still missing and no pulls are left', () => {
  const p = P.paceOf({ due: 1000, deposited: 0, pocket: 0, pullsLeft: 0 });
  assert.equal(p.state, 'dead');
  assert.equal(p.perPull, Infinity);
  assert.equal(p.need, 1000);
});

test('paceOf: fractional or negative pulls are floored at 0', () => {
  assert.equal(P.paceOf({ due: 10, deposited: 0, pocket: 0, pullsLeft: 3.9 }).pullsLeft, 3);
  assert.equal(P.paceOf({ due: 10, deposited: 0, pocket: 0, pullsLeft: -2 }).state, 'dead');
});

test('requiredMultiplier: perPull x actionCost / bet, 0 when met, Infinity when dead or unstaked', () => {
  const open = P.paceOf({ due: 600, deposited: 0, pocket: 0, pullsLeft: 10 }); // perPull 60
  assert.equal(P.requiredMultiplier(open, 2, 10), 12);
  assert.equal(P.requiredMultiplier(open, 1, 60), 1);
  assert.equal(P.requiredMultiplier(open, 0, 10), 6, 'a play always spends at least one pull');
  assert.equal(P.requiredMultiplier(open, 2, 0), Infinity);
  assert.equal(P.requiredMultiplier(P.paceOf({ due: 0, deposited: 0, pocket: 0, pullsLeft: 5 }), 2, 10), 0);
  assert.equal(P.requiredMultiplier(P.paceOf({ due: 9, deposited: 0, pocket: 0, pullsLeft: 0 }), 2, 10), Infinity);
});

test('chanceAtLeast: exact at the tiers, 1 at or below zero, hit for (0, 1]', () => {
  assert.equal(P.chanceAtLeast(SYN, 0), 1);
  assert.equal(P.chanceAtLeast(SYN, 0.5), 0.4);
  assert.equal(P.chanceAtLeast(SYN, 1), 0.4);
  assert.equal(P.chanceAtLeast(SYN, 2), 0.2);
  assert.equal(P.chanceAtLeast(SYN, 5), 0.05);
  assert.equal(P.chanceAtLeast(SYN, 10), 0.01);
  assert.equal(P.chanceAtLeast(SYN, 25), 0.001);
});

test('chanceAtLeast: log-log interpolation between tiers (sqrt(10) sits between 2 and 5)', () => {
  // P = sqrt(0.2 * 0.05) = 0.1 at the log-midpoint of [2, 5]
  const mid = Math.sqrt(2 * 5);
  assert.ok(Math.abs(P.chanceAtLeast(SYN, mid) - Math.sqrt(0.2 * 0.05)) < 1e-12);
});

test('chanceAtLeast: 0 beyond the last positive tier and beyond x100', () => {
  assert.equal(P.chanceAtLeast(SYN, 50), 0, 'between 25 (positive) and 100 (zero)');
  assert.equal(P.chanceAtLeast(SYN, 100), 0);
  assert.equal(P.chanceAtLeast(SYN, 1000), 0);
  assert.equal(P.chanceAtLeast(SYN, Infinity), 0);
  assert.equal(P.chanceAtLeast(SYN, NaN), 0);
});

test('chanceAtLeast: non-increasing over a grid, for every generated profile', () => {
  const grid = [];
  for (let x = 0.1; x <= 120; x *= 1.07) grid.push(x);
  for (const [id, prof] of Object.entries(M.MACHINE_PROFILES)) {
    let prev = 1;
    for (const x of grid) {
      const c = P.chanceAtLeast(prof, x);
      assert.ok(c <= prev + 1e-12, `${id}: chance rose at x=${x.toFixed(2)}`);
      assert.ok(c >= 0 && c <= 1, `${id}: chance ${c} out of range`);
      prev = c;
    }
  }
});

test('oneIn: the reciprocal, null for zero', () => {
  assert.equal(P.oneIn(0.25), 4);
  assert.equal(P.oneIn(0), null);
});

test('number formats: one decimal under 10, grouped above; NEED rounds up', () => {
  assert.equal(P.fmtOddsN(3.1), '3.1');
  assert.equal(P.fmtOddsN(24), '24');
  assert.equal(P.fmtOddsN(200000), '200,000');
  assert.equal(P.fmtMult(6), '6');
  assert.equal(P.fmtMult(6.44), '6.4');
  assert.equal(P.fmtNeed(12.1), '13');
  assert.equal(P.fmtNeed(1234567), '1,234,567');
  assert.equal(P.fmtNeed(Infinity), '∞');
});

test('generated profiles: sane figures, tiers non-increasing, class matches sigma', () => {
  const entries = Object.entries(M.MACHINE_PROFILES);
  assert.ok(entries.length >= 30, 'the sim covers the gambling roster');
  for (const [id, p] of entries) {
    assert.equal(p.plays, 200000, `${id} was not run at 200k plays`);
    const chain = [p.hit, p.p2, p.p5, p.p10, p.p25, p.p100];
    for (const v of chain) assert.ok(v >= 0 && v <= 1, `${id}: ${v}`);
    for (let i = 1; i < chain.length; i++) assert.ok(chain[i] <= chain[i - 1], `${id}: tier ${i} above the one before`);
    const want = p.sigma < 1.5 ? 'STEADY' : p.sigma < 4 ? 'SWINGY' : 'WILD';
    assert.equal(p.cls, want, `${id}: class ${p.cls} for sigma ${p.sigma}`);
    assert.ok(p.rtp >= 0, `${id}: negative rtp`);
  }
});

test('profileOf: the entry, or null for unknown and prototype-named ids', () => {
  assert.equal(M.profileOf('roulette').cls, M.MACHINE_PROFILES.roulette.cls);
  assert.equal(M.profileOf('nope'), null);
  assert.equal(M.profileOf('constructor'), null);
});

test('oddsLine: formatted parts for the seat HUD (HIT, ×10+, CLASS, NEED)', () => {
  const prof = { plays: 200000, bet: 1, hit: 0.25, p2: 0.2, p5: 0.05, p10: 0.01, p25: 0.001, p100: 0, sigma: 3, rtp: 0.9, cls: 'SWINGY' };
  const pace = P.paceOf({ due: 600, deposited: 0, pocket: 0, pullsLeft: 10 }); // perPull 60
  const l = P.oddsLine(prof, pace, 2, 10); // NEED ×12 → P(>=12) between 10 (0.01) and 25 (0.001)
  assert.equal(l.plays, '200,000');
  assert.equal(l.cls, 'SWINGY');
  assert.equal(l.hit, '4');
  assert.equal(l.big, '100');
  assert.equal(l.need.kind, 'open');
  assert.equal(l.need.k, '12');
  assert.equal(l.need.odds, String(Math.round(1 / Math.exp(Math.log(0.01) + ((Math.log(12) - Math.log(10)) / (Math.log(25) - Math.log(10))) * (Math.log(0.001) - Math.log(0.01))))));
});

test('oddsLine: rare tiers are null, met and dead need states, null profile gives null', () => {
  const prof = { plays: 1000, bet: 1, hit: 0, p2: 0, p5: 0, p10: 0, p25: 0, p100: 0, sigma: 0.2, rtp: 0, cls: 'STEADY' };
  const l = P.oddsLine(prof, null, 1, 1);
  assert.deepEqual([l.hit, l.big, l.need], [null, null, null]);
  assert.equal(P.oddsLine(prof, P.paceOf({ due: 0, deposited: 0, pocket: 0, pullsLeft: 3 }), 1, 1).need.kind, 'met');
  assert.equal(P.oddsLine(prof, P.paceOf({ due: 5, deposited: 0, pocket: 0, pullsLeft: 0 }), 1, 1).need.kind, 'dead');
  const open = P.oddsLine(prof, P.paceOf({ due: 5, deposited: 0, pocket: 0, pullsLeft: 5 }), 1, 1);
  assert.deepEqual(open.need, { kind: 'open', k: '1', odds: null });
  assert.equal(P.oddsLine(null, null, 1, 1), null);
});
