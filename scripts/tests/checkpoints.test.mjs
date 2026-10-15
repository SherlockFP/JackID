// Wave 58 (director): Watch checkpoints. The Watch tithe (src/game/checkpoints.ts): from Night 3 each quota Watch must earn 20 %
// of the Night quota in play (net winnings, not deposits). Met pays a Ticket; missed adds the shortfall to tonight's quota.
// Also the bank's `left` after a paid Night (run.ts bank()), which reads 0 once the Night is paid, not the full quota after Dawn.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let CKP, RUN, EV;
before(async () => {
  CKP = await load('src/game/checkpoints.ts');
  RUN = await load('src/game/run.ts');
  EV = await load('src/core/events.ts');
});

test('tithe: the target is 12 % of the Night quota, floored, and never negative', () => {
  assert.equal(CKP.TITHE_SHARE, 0.12);
  assert.equal(CKP.titheTarget(72), 8);
  assert.equal(CKP.titheTarget(288), 34);
  assert.equal(CKP.titheTarget(0), 0);
  assert.equal(CKP.titheTarget(-5), 0);
  assert.equal(CKP.titheTarget(NaN), 0);
});

test('tithe: from Night 3 and never on the overtime Watch', () => {
  assert.equal(CKP.TITHE_FROM_NIGHT, 3);
  assert.equal(CKP.titheApplies(1, false), false, 'Night 1 is a teaching Night');
  assert.equal(CKP.titheApplies(2, false), false, 'Night 2 is a teaching Night');
  assert.equal(CKP.titheApplies(3, false), true);
  assert.equal(CKP.titheApplies(8, false), true);
  assert.equal(CKP.titheApplies(5, true), false, 'the rope-ladder overtime carries no tithe');
});

test('tithe: net winnings are credited wins less stakes, never below 0 (deposits are not part of it)', () => {
  assert.equal(CKP.titheEarned(50, 20), 30);
  assert.equal(CKP.titheEarned(10, 20), 0, 'a losing Watch earns nothing');
  assert.equal(CKP.titheEarned(20.7, 0), 20, 'whole coins');
});

test('WatchTithe: a met Watch pays its Ticket and adds no quota', () => {
  const t = new CKP.WatchTithe();
  t.setNightQuota(72);
  t.begin(3, false);
  assert.deepEqual(t.view(), { on: true, target: 8, earned: 0, met: false, shortfall: 8 });
  t.played(40, 0);
  t.played(0, 10);
  assert.equal(t.view().earned, 30);
  assert.equal(t.view().met, true);
  const r = t.settle();
  assert.deepEqual(r, { state: 'met', target: 8, earned: 30, shortfall: 0, tickets: CKP.TITHE_TICKETS });
  assert.equal(t.addedQuota(), 0);
  assert.equal(t.settle(), null, 'a settled Watch is closed');
});

test('WatchTithe: a missed Watch adds the shortfall to tonight\'s quota, and a new Night clears it', () => {
  const t = new CKP.WatchTithe();
  t.setNightQuota(288);
  t.begin(5, false);
  t.played(30, 20);                      // net 10 of 34
  const r = t.settle();
  assert.equal(r.state, 'missed');
  assert.equal(r.shortfall, 24);
  assert.equal(r.tickets, 0);
  assert.equal(t.addedQuota(), 24);
  t.begin(5, false);
  t.played(0, 100);                      // a losing next Watch: 34 more
  t.settle();
  assert.equal(t.addedQuota(), 58);
  t.newNight();
  assert.equal(t.addedQuota(), 0);
});

test('WatchTithe: plays outside a tithe Watch are ignored (Nights 1-2, overtime)', () => {
  const t = new CKP.WatchTithe();
  t.setNightQuota(144);
  t.begin(2, false);
  assert.equal(t.view().on, false);
  t.played(500, 0);
  assert.equal(t.settle(), null);
  t.begin(4, true);
  assert.equal(t.view().on, false);
});

test('WatchTithe: the save slice round-trips the Watch and the quota adds', () => {
  const t = new CKP.WatchTithe();
  t.setNightQuota(72);
  t.begin(3, false);
  t.played(9, 2);
  const s = JSON.parse(JSON.stringify(t.snapshot()));
  const u = new CKP.WatchTithe();
  u.restore(s);
  assert.deepEqual(u.view(), t.view());
  assert.equal(new CKP.WatchTithe().snapshot(), undefined, 'nothing to keep before a Night quota');
  u.restore(undefined);
  assert.equal(u.view().on, false);
});

test('run: Night 3 Watch 1 carries a tithe of 20 % of the Night quota; Night 2 does not', () => {
  const night2 = RUN.createRun({ seed: 581, mode: 'debt' });
  night2.index = 1;
  night2.recomputeQuota();
  night2.coins = 60;
  assert.equal(night2.startWatch(), true);
  assert.equal(night2.watchTithe().on, false, 'Night 2 has no tithe');
  night2.dispose();

  const run = RUN.createRun({ seed: 581, mode: 'debt' });
  run.index = 2;
  run.recomputeQuota();
  const base = run.quota.due;
  run.coins = 60;
  assert.equal(run.startWatch(), true);
  assert.equal(run.watchTithe().on, true, 'Night 3 has the tithe');
  assert.equal(run.watchTithe().target, Math.floor(CKP.TITHE_SHARE * base));
  run.dispose();
});

test('run: a missed tithe adds its shortfall to the Night quota and emits run:tithe', () => {
  const run = RUN.createRun({ seed: 582, mode: 'debt' });
  run.index = 2;
  run.recomputeQuota();
  const base = run.quota.due;
  const seen = [];
  const off = EV.bus.on('run:tithe', (e) => seen.push(e));
  run.coins = 60;
  assert.equal(run.startWatch(), true);
  run.tick(10);
  run.phase = 'closing';
  run.watchPulls = 2;
  run.settleWatch();
  run.tick(1.6);
  off();
  const target = Math.floor(CKP.TITHE_SHARE * base);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].state, 'missed');
  assert.equal(seen[0].shortfall, target, 'nothing was earned in play, so the whole target is short');
  assert.equal(run.quota.due, base + target, 'tonight\'s quota carries the shortfall');
  run.dispose();
});

test('run: a met tithe pays one Ticket and leaves the quota alone', () => {
  const run = RUN.createRun({ seed: 583, mode: 'debt' });
  run.index = 2;
  run.recomputeQuota();
  const base = run.quota.due;
  const seen = [];
  const off = EV.bus.on('run:tithe', (e) => seen.push(e));
  run.coins = 60;
  assert.equal(run.startWatch(), true);
  run.tick(10);
  run.tithe.played(Math.floor(CKP.TITHE_SHARE * base) + 5, 0);   // the net winnings of the Watch, as win() would count them
  run.pullCount = 0;                     // no unused pulls, so the only Ticket the Settle pays is the tithe's
  const tickets = run.balance('ticket');
  run.phase = 'closing';
  run.watchPulls = 2;
  run.settleWatch();
  run.tick(1.6);
  off();
  assert.equal(seen[0]?.state, 'met');
  assert.equal(run.balance('ticket'), tickets + CKP.TITHE_TICKETS);
  assert.equal(run.quota.due, base, 'a met tithe adds nothing to the quota');
  run.dispose();
});

test('run: bank().left reads 0 after a paid Night, not the full quota after the Dawn reset', () => {
  const run = RUN.createRun({ seed: 584, mode: 'debt' });
  const due = run.quota.due;
  run.coins = 0;
  run.debtPaid = due + 3;
  run.syncQuota();
  run.phase = 'collection';
  run.dawn();
  assert.equal(run.bank().due, due, 'the paid Night still reads its quota');
  assert.equal(run.bank().left, 0, 'the Night is paid: nothing is left to pay');
  run.dispose();
});

test('run: bank().left is the rest of the quota while the Night is unpaid', () => {
  const run = RUN.createRun({ seed: 585, mode: 'debt' });
  const due = run.quota.due;
  run.debtPaid = Math.floor(due / 2);
  run.syncQuota();
  assert.equal(run.bank().left, due - Math.floor(due / 2));
  run.dispose();
});
