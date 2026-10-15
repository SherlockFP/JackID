// Stakes (game/stakes.ts): the cumulative effects, the per-kit unlock after a Night-8 clear, the stake-6 boss, and what a
// stake does inside the run (run.ts).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let S, RUN, SAVE;
before(async () => {
  S = await load('src/game/stakes.ts');
  RUN = await load('src/game/run.ts');
  SAVE = await load('src/core/save.ts');
});

test('stake effects are cumulative and clamped to 0..7', () => {
  const e0 = S.stakeEffects(0);
  assert.equal(e0.pawnPriceMult, 1);
  assert.equal(e0.quotaMult, 1);
  assert.equal(e0.tiltGrace, 0);
  assert.equal(e0.rerollTickets, 0);
  assert.equal(e0.coldLamps, 0);
  assert.equal(e0.extraBoss, false);
  assert.equal(e0.interestAdd, 0);
  assert.equal(e0.obolMult, 1);

  const e3 = S.stakeEffects(3);
  assert.ok(Math.abs(e3.pawnPriceMult - 1.1) < 1e-9, 'stake 1 keeps Pawn ×1.10');
  assert.ok(Math.abs(e3.quotaMult - 1.08) < 1e-9, 'stake 2 keeps quota ×1.08');
  assert.equal(e3.tiltGrace, -1, 'stake 3 gives Tilt grace −1');
  assert.equal(e3.rerollTickets, 0, 'reroll Ticket starts at stake 4');
  assert.equal(e3.extraBoss, false);

  const e4 = S.stakeEffects(4);
  assert.equal(e4.rerollTickets, 1);
  assert.equal(S.stakeEffects(4).coldLamps, 0, 'Cold lamp starts at stake 5');
  assert.equal(S.stakeEffects(5).coldLamps, 1);
  assert.equal(S.stakeEffects(5).extraBoss, false, 'the extra boss starts at stake 6');
  assert.equal(S.stakeEffects(6).extraBoss, true);
  assert.equal(S.stakeEffects(6).interestAdd, 0);
  assert.ok(Math.abs(S.stakeEffects(7).interestAdd + 0.03) < 1e-9, 'stake 7 cuts interest by 3 points');
  assert.ok(Math.abs(S.stakeEffects(7).obolMult - 2.05) < 1e-9, 'Obols ×(1 + 0.15 × stake)');
  assert.ok(Math.abs(S.stakeObolMult(4) - 1.6) < 1e-9);

  assert.equal(S.stakeEffects(9).stake, 7, 'above 7 clamps to 7');
  assert.equal(S.stakeEffects(-2).stake, 0, 'below 0 clamps to 0');
  assert.equal(S.stakeEffects(NaN).stake, 0);
});

test('unlock: stake k+1 opens once Night 8 is cleared on stake k, per kit', () => {
  const none = {};
  assert.equal(S.stakeUnlocked(none, 'rotator', 0), true, 'stake 0 is always open');
  assert.equal(S.stakeUnlocked(none, 'rotator', 1), false);

  const c1 = S.recordStakeClear(none, 'rotator', 0);
  assert.deepEqual(none, {}, 'recordStakeClear does not mutate its input');
  assert.equal(S.stakeUnlocked(c1, 'rotator', 1), true);
  assert.equal(S.stakeUnlocked(c1, 'rotator', 2), false);
  assert.equal(S.stakeUnlocked(c1, 'hot_hand', 1), false, 'another kit is not unlocked');

  const c3 = S.recordStakeClear(c1, 'rotator', 2);
  assert.equal(S.bestStakeCleared(c3, 'rotator'), 2);
  assert.equal(S.stakeUnlocked(c3, 'rotator', 3), true);
  assert.equal(S.stakeUnlocked(c3, 'rotator', 4), false);

  const kept = S.recordStakeClear(c3, 'rotator', 1);
  assert.equal(kept.rotator, 2, 'a lower clear never lowers the best');
  assert.equal(S.bestStakeCleared(c3, 'banker'), -1);
  assert.equal(S.bestStakeCleared(undefined, 'banker'), -1);
});

test('a stake clear needs an escape on Night 8 or later', () => {
  assert.equal(S.isStakeClear('escaped', 8), true);
  assert.equal(S.isStakeClear('escaped', 7), false);
  assert.equal(S.isStakeClear('fell', 8), false);
  assert.equal(S.isStakeClear('quit', 8), false);
});

test('stake 6 adds a boss on Night 5 only, deterministic per seed', () => {
  assert.equal(S.stakeBossFor(1234, 5, 5), null, 'no extra boss below stake 6');
  assert.equal(S.stakeBossFor(1234, 4, 6), null, 'only on Night 5');
  const a = S.stakeBossFor(1234, 5, 6);
  assert.ok(a, 'stake 6 has a Night-5 boss');
  assert.equal(a.minShift, 5);
  assert.equal(a.maxShift, 5);
  assert.equal(a.weight, 0);
  assert.equal(a.exclusive, 'boss');
  assert.ok(['short_fuse', 'frozen_ledger', 'pennies'].includes(a.boss));
  assert.deepEqual(S.stakeBossFor(1234, 5, 6), a, 'same seed, same boss');
  const seen = new Set();
  for (let seed = 1; seed <= 30; seed++) seen.add(S.stakeBossFor(seed, 5, 6).boss);
  assert.ok(seen.size > 1, 'the seed picks among the pool');
});

test('a stake reaches the run: the quota is ×1.08 at stake 2 and the config keeps the stake', () => {
  const base = RUN.createRun({ seed: 11, mode: 'debt', cfg: { kit: 'pauper', stake: 0 } });
  const s2 = RUN.createRun({ seed: 11, mode: 'debt', cfg: { kit: 'pauper', stake: 2 } });
  const s9 = RUN.createRun({ seed: 11, mode: 'debt', cfg: { kit: 'pauper', stake: 9 } });
  try {
    assert.equal(s2.config.stake, 2);
    assert.equal(s9.config.stake, 7, 'the run clamps the stake');
    assert.equal(base.config.stake, 0);
    assert.equal(s2.shift.quota().due, Math.round(base.shift.quota().due * 1.08));
  } finally {
    base.dispose();
    s2.dispose();
    s9.dispose();
  }
});

test('migrateSave keeps stakeCleared as numbers and defaults it to none', () => {
  const d = SAVE.migrateSave({ stakeCleared: { rotator: 3, bad: 'x' } });
  assert.equal(d.stakeCleared.rotator, 3);
  assert.equal(d.stakeCleared.bad, undefined);
  assert.deepEqual(SAVE.migrateSave({}).stakeCleared, {});
});
