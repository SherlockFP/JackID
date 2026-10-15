// Wave 46 (director): HOUSE MOOD (the Night's payout multiplier on every floor machine, through the payout.mult pipeline, and its
// HUD line under the quota), and the smart-stake presets rounded UP to the next affordable ladder step (SAFE never takes 1 from a
// 20-coin pocket up). The quota ladder is the one tuned for the human bot with the mood on.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let HM, SP, ECO, SCH, RUN, REG;
before(async () => {
  HM = await load('src/game/houseMood.ts');
  SP = await load('src/machines/_base/stakePresets.ts');
  ECO = await load('src/game/economy.ts');
  SCH = await load('src/game/data/schedule.ts');
  RUN = await load('src/game/run.ts');
  REG = await load('src/machines/_base/registry.ts');
  REG.load();
});

test('the mood table: N1 x1.12 … N8 x0.95, whole percents +12 … -5, Overdrawn Nights keep the last value', () => {
  assert.deepEqual([...HM.HOUSE_MOOD], [1.12, 1.07, 1.03, 1, 0.98, 0.97, 0.96, 0.95]);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map((i) => HM.houseMoodPct(i)), [12, 7, 3, 0, -2, -3, -4, -5]);
  assert.equal(HM.houseMoodMult(12), 0.95, 'Night 13 keeps x0.95');
});

test('the HUD line: GENEROUS +12% on Night 1, EVEN on Night 4 (no sign), TIGHT -5% on Night 8', () => {
  const n1 = HM.houseMoodLine(0);
  assert.equal(n1.tone, 'generous');
  assert.match(n1.text, /\+12%/);
  assert.equal(HM.houseMoodLine(3).tone, 'neutral');
  assert.match(HM.houseMoodLine(3).text, /0%/);
  const n8 = HM.houseMoodLine(7);
  assert.equal(n8.tone, 'tight');
  assert.match(n8.text, /-5%/);
});

test('the provider adds one payout.mult multiplier while active, none otherwise', () => {
  let on = false;
  let night = 1;
  const p = HM.houseMoodProvider({ index: () => night, active: () => on });
  const out = [];
  p.collect({}, out);
  assert.equal(out.length, 0, 'off outside a quota Watch');
  on = true;
  p.collect({}, out);
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'house');
  assert.equal(out[0].id, 'mood:2');
  assert.deepEqual(out[0].effects, [{ hook: 'payout.mult', op: 'mult', value: 1.07 }]);
});

test('a debt run in play folds House Favour and the mood into payout.mult (Night 1: 1.25 x 1.12)', () => {
  const run = RUN.createRun({ seed: 46, mode: 'debt' });
  assert.equal(run.mod('payout.mult', 'bigone', 1), 1, 'no multiplier before the Watch');
  assert.equal(run.startWatch(), true);
  for (let i = 0; i < 40 && run.shift.phase !== 'play'; i++) run.tick(0.5);
  assert.equal(run.shift.phase, 'play');
  assert.ok(Math.abs(run.mod('payout.mult', 'bigone', 1) - 1.25 * 1.12) < 1e-9);
});

test('the quota ladder is the tuned one (24 teaching N1, 36 N2 by director, then doubling) and each step is within its cap (2x to N3, 3x from N4)', () => {
  const q = SCH.BASE_NIGHTS.map((n) => n.base);
  assert.deepEqual(q, [24, 36, 72, 144, 288, 576, 1152, 2304]);
  for (let i = 1; i < q.length; i++) assert.ok(q[i] > q[i - 1] && q[i] <= SCH.maxLadderStep(i + 1) * q[i - 1], `N${i + 1} steps up, at most ${SCH.maxLadderStep(i + 1)}x`);
});

const plain = (pocket, extra = {}) => SP.stakePresetAmounts({ pocket, min: 1, ladder: ECO.bettingLadder(1, 100), costOf: (v) => v, hsMult: 1, ...extra });

test('presets round UP to the next ladder step: 20 coins -> SAFE 2 (never 1), BOLD 5, BIG 10', () => {
  assert.deepEqual(plain(20), { safe: 2, bold: 5, big: 10 });
});

test('presets at 100 coins: SAFE 5, BOLD 20, BIG 50 (each the step at or above its share)', () => {
  assert.deepEqual(plain(100), { safe: 5, bold: 20, big: 50 });
});

test('a small pocket keeps 1 for SAFE (the SAFE floor starts at 20 coins): 7 coins -> 1, 2, 5', () => {
  assert.deepEqual(plain(7), { safe: 1, bold: 2, big: 5 });
});

test('under HIGH STAKES (x5 debit) the presets fit the pocket and fall back to the largest affordable step', () => {
  assert.deepEqual(plain(100, { hsMult: 5 }), { safe: 5, bold: 20, big: 20 });
});

test('over many pockets: every preset is affordable, SAFE is never 1 from 20 up, and BOLD <= BIG', () => {
  for (let w = 20; w <= 3000; w += 7) {
    const a = plain(w);
    assert.notEqual(a.safe, 1, `pocket ${w}`);
    assert.ok(a.safe <= w && a.bold <= w && a.big <= w, `pocket ${w} affords every preset`);
    assert.ok(a.bold <= a.big, `pocket ${w}: BOLD <= BIG`);
  }
});
