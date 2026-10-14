// Integration tests for the wave 8 wiring inside run.ts: kits, Pawn on the run, boss Nights, suit scope tags, False Ceiling.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let RUN, BOSS, SUITS, ECO;
before(async () => {
  RUN = await load('src/game/run.ts');
  BOSS = await load('src/game/bosses.ts');
  SUITS = await load('src/game/suits.ts');
  ECO = await load('src/game/economy.ts');
});

const mk = (cfg, seed = 7) => RUN.createRun({ seed, mode: 'debt', cfg });

test('kit: Banker starts with 12 coins, no Tickets, its charms and 25 pre-deposited', () => {
  const run = mk({ kit: 'banker' });
  assert.equal(run.wallet(), 12);
  assert.equal(run.balance('ticket'), 0);
  assert.deepEqual(run.charms().map((c) => c.id).sort(), ['piggy_tooth', 'wax_seal']);
  assert.equal(run.shift.quota().deposited, 25);
  run.dispose();
});

test('kit: Pauper (and no kit) is 30 coins and 2 Tickets', () => {
  for (const cfg of [{ kit: 'pauper' }, undefined]) {
    const run = mk(cfg);
    assert.equal(run.wallet(), 30);
    assert.equal(run.balance('ticket'), 2);
    assert.equal(run.charms().length, 0);
    run.dispose();
  }
});

test('Pawn: the run exposes a stocked, stable shelf', () => {
  const run = mk(undefined);
  const a = run.pawn.stock(run.selfId).map((s) => s?.charmId ?? null);
  assert.ok(a.filter(Boolean).length >= 3, 'three regular slots');
  const b = run.pawn.stock(run.selfId).map((s) => s?.charmId ?? null);
  assert.deepEqual(a, b, 'reading the stock does not reshuffle it');
  run.dispose();
});

test('suit tags reach the modifier scope: a REELS charm now fires on a REELS machine only', () => {
  const run = mk(undefined);
  run.grantCharm('brass_thimble');
  const reels = SUITS.SUITS_MACHINE ?? null;
  const onReels = run.mod('payout.mult', 'bandit', 1);
  const onCards = run.mod('payout.mult', 'blackjack', 1);
  assert.ok(onReels > 1, 'bandit is REELS');
  assert.equal(onCards, 1, 'blackjack is CARDS');
  assert.equal(reels, null);
  run.dispose();
});

test('boss: Night 3 triggers its boss before the clock and pulls are read, with random events off', () => {
  const run = mk(undefined, 11);
  const boss = BOSS.bossFor(11, 3);
  assert.ok(boss, 'Night 3 has a boss');
  const r = run;
  r.index = 2; r.watches = 3; r.watch = 0; r.recomputeQuota(); r.prepareBoss();
  assert.equal(run.nightEvents.chance(), 0, 'no random events on a boss Night');
  assert.equal(run.startWatch(), true);
  assert.ok(run.nightEvents.isActive(boss.id), 'boss active once the Watch has started');
  run.dispose();
});

test('boss: Night 6 and 8 have bosses, Night 4 does not (chance restored)', () => {
  assert.ok(BOSS.bossFor(3, 6));
  assert.ok(BOSS.bossFor(3, 8));
  assert.equal(BOSS.bossFor(3, 4), null);
  const run = mk(undefined, 3);
  run.index = 3; run.prepareBoss();
  assert.ok(run.nightEvents.chance() > 0);
  run.dispose();
});

test('False Ceiling: the House Limit grows with x.house.limitMult', () => {
  const base = ECO.settlePayout({ gross: 10000, bet: 1, A: 0, M: 1, flat: 0, quota: 100 });
  const wide = ECO.settlePayout({ gross: 10000, bet: 1, A: 0, M: 1, flat: 0, quota: 100, limitMult: 2.4 });
  assert.equal(base.credited, 500);
  assert.equal(wide.credited, 1200);
});
