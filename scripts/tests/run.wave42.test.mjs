// Wave 42 (director decisions 1-4): the bank stays open through Settle (1.5 s), every bank move is named, the Pawn and the
// stamp board always offer a cheap enough item, the ladder and the interest are the tuned numbers, and a fallen run's
// receipt reads the bank against the quota.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let RUN, REG, SCH, EV, PROG;
before(async () => {
  RUN = await load('src/game/run.ts');
  REG = await load('src/machines/_base/registry.ts');
  SCH = await load('src/game/data/schedule.ts');
  EV = await load('src/core/events.ts');
  PROG = await load('src/game/progression.ts');
  REG.load();
});

test('decision 1: the interest falls one step per Night (0.55 … 0.20), Overdrawn Nights continue the slope, and the ladder is strictly rising within its step cap', () => {
  assert.deepEqual(SCH.BASE_NIGHTS.map((n) => n.interest), [0.55, 0.5, 0.45, 0.4, 0.35, 0.3, 0.25, 0.2]);
  for (let no = 9; no <= 14; no++) {
    assert.ok(SCH.nightDef(no - 1).interest <= SCH.nightDef(no - 2).interest + 1e-9, `Overdrawn N${no} is not above N${no - 1}`);
  }
  const q = SCH.BASE_NIGHTS.map((n) => n.base);
  for (let i = 1; i < q.length; i++) assert.ok(q[i] > q[i - 1] && q[i] <= SCH.maxLadderStep(i + 1) * q[i - 1], `N${i + 1} steps up, at most ${SCH.maxLadderStep(i + 1)}x`);
});

test('decision 2: SETTLE is 1.5 s, the bank is open through it, and the lever (the next Watch) waits for it to end', () => {
  const run = RUN.createRun({ seed: 201, mode: 'debt' });
  run.coins = 80;
  assert.ok(run.deposit(20, true));
  run.phase = 'closing';
  run.watchPulls = 2;
  run.settleWatch();
  assert.equal(run.shift.phase, 'settle');
  assert.equal(run.bank().settleLeft, 1.5, 'the countdown starts at 1.5 s');
  assert.equal(run.bank().open, true, 'WITHDRAW is open in Settle');
  assert.equal(run.depositRefusal(5), null, 'a deposit goes in during Settle');
  assert.equal(run.withdraw(5), 5, 'and a withdraw comes out');
  assert.equal(run.startWatch(), false, 'the next Watch cannot start during Settle');
  run.tick(1.0);
  assert.equal(run.shift.phase, 'settle', 'still settling after 1.0 s');
  assert.ok(run.bank().settleLeft > 0 && run.bank().settleLeft <= 0.5 + 1e-9, 'the countdown runs down');
  run.tick(0.6);
  assert.equal(run.shift.phase, 'intermission', 'the Settle ends at 1.5 s, the next stop is the intermission');
  assert.equal(run.bank().settleLeft, 0, 'no countdown outside Settle');
  run.dispose();
});

test('decision 2: Dawn is still shut to the bank', () => {
  const run = RUN.createRun({ seed: 202, mode: 'debt' });
  run.coins = 10;
  run.phase = 'collection';
  assert.equal(run.bank().open, false);
  assert.equal(run.depositRefusal(1), 'closed');
  run.dispose();
});

test('decision 4 (bug b): every deposit into the bank is named in a banner that says where the coins went', () => {
  const lines = [];
  const run = RUN.createRun({ seed: 203, mode: 'debt', banner: (text) => { lines.push(text); } });
  run.coins = 40;
  assert.ok(run.deposit(15, true));
  assert.equal(lines.length, 1, 'one deposit, one line');
  assert.match(lines[0], /15/, 'the line names the amount');
  assert.match(lines[0], /bank/i, 'and says it went to the bank');
  run.dispose();
});

test('decision 3: every intermission offers a charm priced at most max(8, 25 % of the quota) (seeds x Nights)', () => {
  for (const seed of [11, 12, 13, 14]) {
    const run = RUN.createRun({ seed, mode: 'debt' });
    for (let idx = 0; idx < SCH.BASE_RUN_NIGHTS; idx++) {
      run.index = idx;
      run.phase = 'intermission';
      const quota = PROG.nightQuota(idx);
      const cap = Math.max(8, 0.25 * quota);
      const prices = run.pawn.stock(run.selfId).filter((s) => s && s.price > 0).map((s) => s.price);
      assert.ok(prices.length > 0, `seed ${seed} N${idx + 1}: the shelf is not empty`);
      assert.ok(Math.min(...prices) <= cap, `seed ${seed} N${idx + 1}: cheapest ${Math.min(...prices)} <= ${cap}`);
    }
    run.dispose();
  }
});

test('decision 3: every intermission offers a stamp priced at most 30 % of the quota', () => {
  for (const seed of [21, 22]) {
    const run = RUN.createRun({ seed, mode: 'debt' });
    for (let idx = 0; idx < SCH.BASE_RUN_NIGHTS; idx++) {
      run.index = idx;
      run.phase = 'intermission';
      const quota = PROG.nightQuota(idx);
      const offers = run.stamps.offers().filter((o) => o);
      assert.ok(offers.length > 0, `seed ${seed} N${idx + 1}: the board is not empty`);
      assert.ok(Math.min(...offers.map((o) => o.price)) <= 0.3 * quota, `seed ${seed} N${idx + 1}: a stamp <= 30 % of ${quota}`);
    }
    run.dispose();
  }
});

test('bug a: a run that falls at Dawn with the pocket equal to the quota reports the bank against the quota (short = quota), never met', () => {
  const run = RUN.createRun({ seed: 91, mode: 'debt' });
  const due = run.quota.due;
  let summary = null;
  const off = EV.bus.on('run:end', (e) => { summary = e.summary; });
  run.index = 1;
  run.coins = due;          // the pocket holds exactly the quota ...
  run.debtPaid = 0;         // ... but nothing was deposited
  run.syncQuota();
  run.phase = 'collection';
  run.dawn();
  off();
  assert.equal(summary?.result, 'fell');
  assert.equal(summary?.post?.short, due, 'the receipt is short by the whole quota');
  run.dispose();
});
