// Wave 80: the Night Derby is back. Win / Place / Show odds, the house edge on every straight bet, strings in both languages.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);
let R, RNG, S;
before(async () => {
  R = await load('src/machines/derby/rules.ts');
  RNG = await load('src/core/rng.ts');
  S = (await load('src/machines/derby/derby.strings.ts')).default;
});

test('odds: six horses, win >= place >= show for each horse, nothing below the x1.1 floor', () => {
  const o = R.oddsFor(R.BASE_STRENGTHS);
  for (const k of ['win', 'place', 'show']) assert.equal(o[k].length, 6, k);
  for (let i = 0; i < 6; i++) {
    assert.ok(o.win[i] >= o.place[i] && o.place[i] >= o.show[i], `horse ${i + 1}: ${o.win[i]} / ${o.place[i]} / ${o.show[i]}`);
    for (const k of ['win', 'place', 'show']) assert.ok(o[k][i] >= R.MIN_ODDS, `${k} ${i + 1}`);
  }
  assert.ok(R.BET_TYPES.includes('show') && R.PICKS_NEEDED.show === 1);
  assert.equal(R.validBet({ t: 'show', p: [2], a: 5 }, 6, 0), '');
});

test('show pays for a top-three finish and nothing below it', () => {
  const o = R.oddsFor(R.BASE_STRENGTHS);
  const pay = (pick) => R.settleBets([{ t: 'show', p: [pick], a: 10 }], [3, 1, 5, 0, 2, 4], o, false, 1, R.NO_MODS).gross;
  for (const h of [3, 1, 5]) assert.ok(pay(h) > 0, `horse ${h} finished in the first three`);
  for (const h of [0, 2, 4]) assert.equal(pay(h), 0, `horse ${h} finished outside the first three`);
});

test('house edge: a flat bet on a random horse returns about 90 percent for win, place and show (never above 100)', () => {
  const rng = RNG.createRng(8080);
  const stake = { win: 0, place: 0, show: 0 }, back = { win: 0, place: 0, show: 0 };
  const N = 40000;
  for (let r = 0; r < N; r++) {
    const s = R.field(rng, false);
    const odds = R.oddsFor(s);
    const pick = rng.int(0, 5);
    for (const t of ['win', 'place', 'show']) {
      const out = R.runRace(rng, s, [[{ t, p: [pick], a: 100 }]], odds, R.NO_MODS, 0, true);
      stake[t] += 100; back[t] += out.seats[0].gross;
    }
  }
  for (const t of ['win', 'place', 'show']) {
    const rtp = back[t] / stake[t];
    assert.ok(rtp > 0.84 && rtp < 0.97, `${t} RTP ${rtp.toFixed(3)}`);
  }
});

test('copy: EN and TR have the same keys and placeholders, and the new bet and horse names exist', () => {
  assert.deepEqual(Object.keys(S.en).sort(), Object.keys(S.tr).sort());
  const ph = (x) => (x.match(/\{\w+\}/g) ?? []).sort().join();
  for (const k of Object.keys(S.en)) assert.equal(ph(S.en[k]), ph(S.tr[k]), k);
  for (const k of ['show', 'tShow', 'cShowType', 'horse1', 'horse6', 'horse7', 'nOdds']) assert.ok(S.en[k] && S.tr[k], k);
  for (const v of Object.values(S.en)) assert.ok(!/\brats?\b/i.test(v) || /Rat Run/.test(v), `a rat is left in: ${v}`);
});
