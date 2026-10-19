// Wave 45 (director): the between-Watch flow. After Settle every Watch enters a real Mola (intermission) where the Pawn, the bank
// and the lever are open; the lever starts the next Watch and is never gated on the quota. A fall with money in the bank names
// the seized coins (the run's `debt().paid` at `run:end`, which the HUD toast reads).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let RUN, REG, EV, SCH;
before(async () => {
  RUN = await load('src/game/run.ts');
  REG = await load('src/machines/_base/registry.ts');
  EV = await load('src/core/events.ts');
  SCH = await load('src/game/data/schedule.ts');
  REG.load();
});

/** Ends the current Watch through Settle (1.5 s) into the next stop. */
function settleThrough(run) {
  run.phase = 'closing';
  run.watchPulls = 2;
  run.settleWatch();
  run.tick(1.6);
}

test('Mola: every Watch settles into an intermission, and the lever starts the next Watch with the quota unmet', () => {
  const run = RUN.createRun({ seed: 301, mode: 'debt' });
  run.coins = 60;
  run.debtPaid = 0;
  run.syncQuota();
  assert.equal(run.shift.phase, 'intermission', 'a new run opens in the intermission (its first Watch rings in with the lever)');
  assert.equal(run.startWatch(), true, 'the lever starts Watch 1 before anything is deposited');
  assert.equal(run.shift.phase, 'bell');
  run.tick(10);                       // the Bell runs out into play
  assert.equal(run.shift.phase, 'play');
  settleThrough(run);
  assert.equal(run.shift.phase, 'intermission', 'Settle hands over to a real intermission after Watch 1');
  assert.ok(run.watch >= 1, 'the Night moves on to its next Watch');
  assert.equal(run.quota.met, false, 'the quota is still unmet');
  assert.equal(run.startWatch(), true, 'the lever is never gated on the quota: the next Watch starts');
  run.dispose();
});

test('Mola: the Pawn, the bank and the phone are open in the intermission, and shut mid-Watch settle', () => {
  const run = RUN.createRun({ seed: 302, mode: 'debt' });
  run.coins = 60;
  settleThrough(run);
  assert.equal(run.shift.phase, 'intermission');
  assert.equal(run.bank().open, true, 'WITHDRAW and DEPOSIT open in the Mola');
  assert.equal(run.buyCharm('lucky_receipt', 0), true, 'the Pawn is open in the Mola');
  assert.equal(run.depositRefusal(5), null, 'a deposit goes in during the Mola');
  assert.ok(run.deposit(20, true), 'the deposit lands');
  assert.equal(run.withdraw(5), 5, 'and a withdraw comes out');
  run.dispose();
});

test('Mola: during Settle the lever is refused and the Pawn is closed, both come back in the intermission', () => {
  const run = RUN.createRun({ seed: 303, mode: 'debt' });
  run.coins = 60;
  run.phase = 'closing';
  run.watchPulls = 2;
  run.settleWatch();
  assert.equal(run.shift.phase, 'settle');
  assert.equal(run.buyCharm('lucky_receipt', 0), false, 'the Pawn is closed during Settle');
  assert.equal(run.startWatch(), false, 'the lever waits for the Settle to end');
  run.tick(1.6);
  assert.equal(run.shift.phase, 'intermission');
  assert.equal(run.startWatch(), true);
  run.dispose();
});

test('fall: a run that falls with money in the bank reports the bank it lost (the seized coins)', () => {
  const run = RUN.createRun({ seed: 304, mode: 'debt' });
  const due = run.quota.due;
  let summary = null;
  let seized = null;
  const off = EV.bus.on('run:end', (e) => { summary = e.summary; seized = Math.floor(run.debt().paid); });
  run.index = 1;
  run.soulMarkCount = 1;   // the last seal: a miss with 2+ seals costs a seal instead (seals.test.mjs)
  run.coins = 0;
  run.debtPaid = Math.floor(due / 2);   // money in the bank, short of the quota
  run.syncQuota();
  run.phase = 'collection';
  run.dawn();
  off();
  assert.equal(summary?.result, 'fell');
  assert.equal(seized, Math.floor(due / 2), 'the bank is still whole at run:end, so the toast reads its balance');
  assert.ok(seized > 0, 'the fall toast reads "Bank N seized by the House"');
  run.dispose();
});

test('the Night ladder the Mola walks through is monotonic, each step within its cap (2x to N3, 3x from N4)', () => {
  const q = SCH.BASE_NIGHTS.map((n) => n.base);
  for (let i = 1; i < q.length; i++) assert.ok(q[i] > q[i - 1] && q[i] <= SCH.maxLadderStep(i + 1) * q[i - 1], `N${i + 1} steps up, at most ${SCH.maxLadderStep(i + 1)}x`);
});
