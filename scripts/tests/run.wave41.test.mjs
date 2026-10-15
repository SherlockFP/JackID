// Wave 41 (director decisions 1-5): the 3 s Closing window with the bank and the Pawn open, the banked surplus that keeps earning
// until Dawn, the deposit refusal reasons, the Night 1 interest, and the Night summary that reconciles to the pocket.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let RUN, REG, SCH, EV, LAY;
before(async () => {
  RUN = await load('src/game/run.ts');
  REG = await load('src/machines/_base/registry.ts');
  SCH = await load('src/game/data/schedule.ts');
  EV = await load('src/core/events.ts');
  LAY = await load('src/menu/hud/layout.strings.ts');
  REG.load();
});

test('decision 4: Night 1 pays 50 % a Watch; Night 2 pays 90 % (the sim needs it to hold Night 3 near 50 %)', () => {
  assert.equal(SCH.BASE_NIGHTS[0].interest, 0.5);
  assert.equal(SCH.BASE_NIGHTS[1].interest, 0.9);
  assert.equal(SCH.BASE_NIGHTS[2].interest, 0.28, 'Night 3 unchanged');
});

test('decision 1: the Closing window is 3 s in every Watch', () => {
  assert.equal(SCH.CLOSING_SEC, 3);
  assert.equal(SCH.closingSeconds(true), 3, 'the last Watch');
  assert.equal(SCH.closingSeconds(false), 3, 'the other Watches');
});

test('decision 1: during Closing the bank, the deposit and the Pawn are open; SETTLE and a second Bell are refused', () => {
  const run = RUN.createRun({ seed: 71, mode: 'debt' });
  run.coins = 100;
  assert.equal(run.buyCharm('rusty_key', 0), true, 'the Pawn is open between Watches');
  run.phase = 'play'; run.pullCount = 2; run.watchPulls = 2;
  assert.equal(run.buyCharm('bargain_coupon', 0), false, 'the Pawn is shut while the Watch plays');
  assert.equal(run.ringBell(), true, 'the Bell ends the Watch');
  assert.equal(run.shift.phase, 'closing');
  assert.equal(run.bank().open, true, 'WITHDRAW is open while the Watch ends');
  assert.equal(run.buyCharm('bargain_coupon', 0), true, 'the Pawn sells during Closing');
  assert.ok(run.deposit(10, true), 'a deposit goes in during Closing');
  assert.equal(run.withdraw(5), 5, 'and a withdraw comes back out');
  assert.equal(run.settleEarly(), false, 'SETTLE waits until the Watch has settled');
  assert.equal(run.ringBell(), false, 'a closing Watch cannot be ended twice');
  run.dispose();
});

test('decision 2: a deposit after the quota is met is accepted and earns interest; Dawn is the only way the surplus goes back', () => {
  const run = RUN.createRun({ seed: 72, mode: 'debt' });
  const due = run.quota.due;
  run.debtPaid = due;
  run.syncQuota();
  run.coins = 200;
  assert.equal(run.depositRefusal(50), null, 'the quota is met, the deposit is still accepted');
  assert.ok(run.deposit(50, true));
  assert.equal(run.coins, 150, 'the 50 stay in the bank');
  assert.equal(run.bank().balance, due + 50);
  run.watchPulls = 1;
  run.settleWatch();
  assert.ok((run.stats.interest ?? 0) > 0, 'the surplus earns the Watch interest');
  assert.equal(run.coins, 150, 'the interest goes into the bank, not the pocket');
  run.dispose();
});

test('decision 3: each refused deposit names its reason', () => {
  const run = RUN.createRun({ seed: 73, mode: 'debt' });
  run.coins = 100;
  assert.equal(run.depositRefusal(20), null, 'a deposit between Watches goes through');
  const fl = run.depositFloor();
  assert.equal(run.depositRefusal(100 - fl + 1), 'float', 'below the float');
  assert.equal(run.depositRefusal(100, true), null, 'a confirmed ALL goes through');
  run.coins = 0;
  assert.equal(run.depositRefusal(20), 'nothing', 'an empty pocket has nothing to deposit');
  run.coins = 100;
  run.phase = 'settle';
  assert.equal(run.depositRefusal(5), 'closed', 'Settle is the end of the Watch');
  run.phase = 'collection';
  assert.equal(run.depositRefusal(5), 'closed', 'Dawn is the end of the Watch');
  run.phase = 'intermission'; run.nightDone = true;
  assert.equal(run.depositRefusal(5), 'nightPaid', 'a paid Night has no quota until the floor opens');
  run.nightDone = false;
  assert.equal(run.deposit(5), true, 'and it is accepted again once the Night is open');
  run.dispose();
  const free = RUN.createRun({ seed: 74, mode: 'free' });
  assert.equal(free.depositRefusal(5), 'notQuota', 'the Free Casino has no quota Watch');
  free.dispose();
});

test('the Night summary: the pocket delta is carried + float (+ cut), the label reads NIGHT N PAID, EN and TR', () => {
  const run = RUN.createRun({ seed: 75, mode: 'debt' });
  const due = run.quota.due;
  run.coins = 500;
  run.debtPaid = due + 70;
  const carried = [];
  const off = EV.bus.on('eco:wallet', (e) => { if (e.reason === 'dawn:surplus') carried.push(e.delta); });
  const before = run.coins;
  run.dawn();
  off();
  assert.deepEqual(carried, [70], 'Dawn returns the surplus above the quota, once');
  assert.equal(run.nightLedger().carried, 70, 'the summary carries the same 70');
  assert.equal(run.coins, before + 70, 'the Dawn pocket delta is exactly the carried figure');
  const c0 = run.coins;
  assert.ok(run.openFloor(), 'OPEN THE FLOOR starts the next Night');
  assert.equal(run.coins - c0, run.nightLedger().float, 'the next Night books its House float as its own line');
  run.dispose();
});

test('strings: the summary says NIGHT N PAID (not QUOTA), the closing clock says WATCH ENDING, and EN and TR both have them', () => {
  const s = LAY.default;
  assert.match(s.en.nightSummary, /^NIGHT \{n\} PAID/);
  assert.doesNotMatch(s.en.nightSummary, /QUOTA/);
  assert.match(s.en['clock.closing'], /WATCH ENDING/);
  for (const k of ['nightSummary', 'clock.closing']) {
    assert.ok(s.tr[k] && s.tr[k].length > 0, `TR has ${k}`);
  }
});
