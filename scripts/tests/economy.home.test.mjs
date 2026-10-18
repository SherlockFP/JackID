// THE HOME COMPUTER (wave 77, src/game/economy): ventures (seeded Dawn pay, growth, the Collector's freeze, sell-back), the MARKET
// (food to the fridge, the deadbolt, the frame, reroll slips), the run goal, the save slice, the run wiring (Dawn pay, the deadbolt on
// a knock, the frame's star) and the headless balance bounds. Also the luck meter's reason for a kept word (`promise`).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let V, M, E, B, RUN, REG, EV, L, SCH;
before(async () => {
  V = await load('src/game/economy/ventures.ts');
  M = await load('src/game/economy/market.ts');
  E = await load('src/game/economy/homeEconomy.ts');
  B = await load('src/game/economy/balance.ts');
  L = await load('src/game/luck.ts');
  SCH = await load('src/game/data/schedule.ts');
  RUN = await load('src/game/run.ts');
  REG = await load('src/machines/_base/registry.ts');
  EV = await load('src/core/events.ts');
  REG.load();
});

/** A port over a plain pocket. */
function port(o = {}) {
  const p = { seed: 7, n: 2, paid: 1, coins: 1000, heatV: 0, rerolls: 0, isOpen: true, fridge: [], room: 8, ...o };
  return Object.assign(p, {
    night: () => p.n, nightsPaid: () => p.paid, wallet: () => p.coins,
    spend: (n) => { if (p.coins < n) return false; p.coins -= n; return true; },
    earn: (n) => { p.coins += n; },
    heat: () => p.heatV, addFreeReroll: (n) => { p.rerolls += n; }, open: () => p.isOpen,
    fridgeRoom: () => p.room - p.fridge.length, deliver: (id) => { p.fridge.push(id); return true; },
  });
}

test('every venture pays itself back in about 4 to 5.5 Nights and sells for half', () => {
  for (const id of V.VENTURE_IDS) {
    const d = V.VENTURES[id];
    const pb = V.paybackNights(d);
    assert.ok(pb >= 3.8 && pb <= 5.5, `${id} payback ${pb}`);
    assert.equal(V.sellValue(d), Math.floor(d.price / 2));
  }
  assert.equal(V.growthOf(0), 1);
  assert.equal(V.growthOf(99), V.GROWTH_MAX);
});

test('Dawn pay is seeded, grows with age, and the Collector freezes the dearest first', () => {
  const held = { vending: [0, 0], taxi: [2] };
  const a = V.rollDawn(11, 3, held, 0), b = V.rollDawn(11, 3, held, 0);
  assert.deepEqual(a, b, 'the same seed and Night pay the same');
  assert.deepEqual(a.after, { vending: [1, 1], taxi: [3] }, 'every unit paid is a Dawn older');
  const hot = V.rollDawn(11, 3, held, 3);
  assert.equal(hot.frozen, 1);
  assert.equal(hot.lines.find((l) => l.id === 'taxi').kind, 'frozen', 'the taxi goes first');
  assert.deepEqual(hot.after.taxi, [2], 'a frozen Dawn does not age it');
  assert.equal(V.rollDawn(11, 3, held, 5).frozen, 2);
  // over many Nights the mean of a new unit sits near base x (1 - bad)
  let sum = 0;
  for (let n = 1; n <= 2000; n++) sum += V.rollDawn(5, n, { laundry: [0] }, 0).total;
  const mean = sum / 2000, want = V.meanPay(V.VENTURES.laundry);
  assert.ok(Math.abs(mean - want) / want < 0.05, `laundry mean ${mean.toFixed(2)} vs ${want}`);
});

test('the economy: trades only in the Evening, caps, short pockets, sell the newest, and Night locks', () => {
  const p = port();
  const e = E.createHomeEconomy(p);
  p.isOpen = false;
  assert.equal(e.buyVenture('vending'), 'closed');
  p.isOpen = true;
  assert.equal(e.buyVenture('nope'), 'none');
  assert.equal(e.buyVenture('cards'), 'locked', 'the card game opens after Night 3');
  for (let i = 0; i < 3; i++) assert.equal(e.buyVenture('vending'), 'ok');
  assert.equal(e.buyVenture('vending'), 'cap');
  assert.equal(p.coins, 1000 - 90);
  e.dawn(3);
  assert.equal(e.buyVenture('vending'), 'cap');
  assert.equal(e.sellVenture('vending'), 'ok');
  assert.equal(e.held('vending'), 2);
  assert.ok(e.ventures().find((v) => v.id === 'vending').growth > 1, 'the grown ones stay');
  p.coins = 10;
  assert.equal(e.buyVenture('laundry'), 'short');
  assert.ok(e.incomeMean() > 0 && e.worth() === 30);
});

test('the MARKET: food to the fridge, per-Evening limits, upgrades once, reroll slips, the frame star', () => {
  const p = port({ n: 1 });
  const e = E.createHomeEconomy(p);
  const fr = [];
  const off = EV.bus.on('econ:frame', (x) => fr.push(x));
  assert.equal(e.buyItem('deadbolt'), 'locked', 'the deadbolt opens with the knocks (Night 2)');
  assert.equal(e.buyItem('groceries'), 'ok');
  assert.equal(e.buyItem('groceries'), 'limit');
  assert.deepEqual(p.fridge, ['sandwich', 'banana', 'banana'], 'delivered into the food lane fridge');
  p.room = 4;
  assert.equal(e.buyItem('coffee'), 'full', 'two cans do not fit in one free slot');
  const left = p.coins;
  p.room = 8;
  assert.equal(p.coins, left, 'a full fridge charges nothing');
  assert.equal(e.buyItem('reroll'), 'ok'); assert.equal(e.buyItem('reroll'), 'ok'); assert.equal(e.buyItem('reroll'), 'limit');
  assert.equal(p.rerolls, 2);
  p.n = 2;
  assert.equal(e.buyItem('groceries'), 'ok', 'a new Night, a new Evening');
  assert.equal(e.buyItem('frame'), 'ok');
  assert.equal(e.buyItem('frame'), 'owned');
  assert.equal(e.has('frame'), true);
  e.newNight(3);
  assert.deepEqual(fr, [{ night: 3, star: M.FRAME_STARS }]);
  off();
});

test('the run goal is the plain ladder still owed', () => {
  let total = 0;
  for (let i = 0; i < SCH.BASE_RUN_NIGHTS; i++) total += SCH.quotaFor(i);
  const g0 = E.runGoal(0);
  assert.equal(g0.total, total);
  assert.equal(g0.left, total);
  const g3 = E.runGoal(3);
  assert.equal(g3.paid, SCH.quotaFor(0) + SCH.quotaFor(1) + SCH.quotaFor(2));
  assert.equal(g3.left, total - g3.paid);
  assert.equal(E.runGoal(8).left, 0);
});

test('snapshot and restore round trip, and a damaged or old slice reads safely', () => {
  const p = port({ n: 4 });
  const e = E.createHomeEconomy(p);
  e.buyVenture('taxi'); e.buyItem('deadbolt'); e.buyItem('coffee');
  e.dawn(4);
  const snap = JSON.parse(JSON.stringify(e.snapshot()));
  const e2 = E.createHomeEconomy(port({ n: 4 }));
  e2.restore(snap);
  assert.deepEqual(e2.snapshot(), snap);
  e2.restore({ held: { vending: 2, cards: 9 }, upgrades: ['frame', 'junk'] });
  assert.equal(e2.held('vending'), 2, 'an old count reads as new ones');
  assert.equal(e2.held('cards'), 1, 'capped');
  assert.equal(e2.has('frame'), true);
  e2.restore('junk');
  assert.equal(e2.worth(), 0);
});

// ── the run ──────────────────────────────────────────────────────────────────────────────────────
const walk = (run, sec, step = 0.25) => { for (let t = 0; t < sec && !run.over; t += step) run.tick(step); };
function paidDawn(run) {
  run.debtPaid = run.quota.due;
  run.syncQuota();
  run.phase = 'collection';
  run.dawn();
}
function toEvening(run) {
  paidDawn(run);
  assert.equal(run.openFloor(), true);
  walk(run, RUN.HOME_TIMING.ride + 0.1);
  assert.equal(run.homeStage(), 'evening');
}
function sleep(run) {
  assert.equal(run.homeSleep(), true);
  walk(run, RUN.HOME_TIMING.sleep + 0.1);
}

test('the run: ventures bought in the Evening pay at the next paid Dawn, and they survive a save', () => {
  const run = RUN.createRun({ seed: 7701, mode: 'debt', home: true });
  const econ = run.homeEconomy();
  assert.ok(econ, 'a Home-layer run has the computer');
  assert.equal(econ.buyVenture('vending'), 'closed', 'not on the casino floor');
  toEvening(run);
  run.earn('coin', 500, 'test');
  assert.equal(econ.buyVenture('vending'), 'ok');
  assert.equal(econ.buyVenture('laundry'), 'ok');
  sleep(run);
  const paid = [];
  const off = EV.bus.on('econ:dawn', (r) => paid.push(r));
  const before = run.wallet();
  paidDawn(run);
  off();
  assert.equal(paid.length, 1);
  assert.ok(run.wallet() >= before + paid[0].total, 'the pay is in the pocket');
  const snap = JSON.parse(JSON.stringify(run.snapshot()));
  assert.equal(snap.ext.econ.held.vending.length, 1);
  const store = { data: { resume: snap }, update(fn) { fn(this.data); }, flush() {} };
  const back = RUN.resumeRun(store, { home: true });
  assert.deepEqual(back.homeEconomy().snapshot(), snap.ext.econ);
  back.dispose();
  run.dispose();
  const plain = RUN.createRun({ seed: 7702, mode: 'debt' });
  assert.equal(plain.homeEconomy(), null, 'no Home layer, no computer');
  assert.equal(plain.snapshot().ext.econ, undefined);
  plain.dispose();
});

test('the run: the deadbolt gives half a knock toll back and stops a Picker taking a charm', () => {
  const run = RUN.createRun({ seed: 7703, mode: 'debt', home: true });
  toEvening(run);   // the Evening after Night 1
  sleep(run);
  toEvening(run);   // the Evening after Night 2: the deadbolt is on the MARKET
  run.earn('coin', 400, 'test');
  assert.equal(run.homeEconomy().buyItem('deadbolt'), 'ok');
  const before = run.wallet();
  assert.equal(run.spend('coin', 40, 'knock.toll'), true);
  assert.equal(run.wallet(), before - 20);
  const any = run.charms()[0];
  if (any) assert.equal(run.loseCharm(any.id), false);
  run.dispose();
});

test('ŞANS: a kept word at the kitchen table reads "promise", the frame gives a star at a Night start', () => {
  const m = L.createLuckMeter({});
  m.restore({ stars: 0 });
  EV.bus.emit('keepsake:stake', { state: 'won', id: 'ring', mid: 'promise', star: 1 });
  assert.equal(m.last().why, 'promise');
  EV.bus.emit('keepsake:stake', { state: 'won', id: 'ring', mid: 'm1', star: 1 });
  assert.equal(m.last().why, 'keepsake');
  EV.bus.emit('econ:frame', { night: 3, star: 1 });
  assert.equal(m.last().why, 'frame');
  assert.equal(m.stars(), 3);
  m.dispose();
});

test('balance: ventures matter but do not carry the late ladder (2000 seeded runs)', () => {
  const smart = B.simulateMany('smart', 2000);
  const greedy = B.simulateMany('greedy', 2000);
  const all = B.simulateMany('all-in', 2000);
  assert.ok(smart.net > 0, `a careful investor gains (${smart.net.toFixed(1)})`);
  assert.ok(greedy.shareOfLadder > 0.03, `greedy pays a real share (${(greedy.shareOfLadder * 100).toFixed(1)} %)`);
  assert.ok(all.shareOfLadder < 0.2, `all-in stays under 20 % of the ladder (${(all.shareOfLadder * 100).toFixed(1)} %)`);
  assert.ok(all.shareN8 < 0.15, `the Night 8 quota stays the game (${(all.shareN8 * 100).toFixed(1)} %)`);
});
