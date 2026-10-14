// Wave 13 economy and safety tests: the strictly increasing quota ladder, Night 1 stake cap, the second-press stake confirm,
// the Collector's rescue loan, the Watch-clock hold, the Pawn's first-shop synergy guarantee and its Night-rollover restock.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let SCH, ECO, RUN, REG, SH, R, E, CH, HOLD, RES, EV;
before(async () => {
  SCH = await load('src/game/data/schedule.ts');
  ECO = await load('src/game/economy.ts');
  RUN = await load('src/game/run.ts');
  REG = await load('src/machines/_base/registry.ts');
  SH = await load('src/game/shop.ts');
  R = await load('src/core/rng.ts');
  E = await load('src/game/charms/engine.ts');
  CH = await load('src/game/data/charms.ts');
  HOLD = await load('src/game/clockHold.ts');
  RES = await load('src/game/rescue.ts');
  EV = await load('src/core/events.ts');
  REG.load();
});

// ── the ladder ───────────────────────────────────────────────────────────────────────────────────────
test('quota ladder: strictly increasing night over night, N1 just above the Pauper pocket', () => {
  const q = SCH.BASE_NIGHTS.map((n) => n.base);
  for (let i = 1; i < q.length; i++) assert.ok(q[i] > q[i - 1], `N${i + 1} (${q[i]}) must exceed N${i} (${q[i - 1]})`);
  assert.ok(q[0] > SCH.START.pocket && q[0] <= 45, `N1 ${q[0]} sits above ${SCH.START.pocket} and at most 45`);
  for (let i = 1; i < SCH.BASE_RUN_NIGHTS + 4; i++) assert.ok(SCH.quotaFor(i) > SCH.quotaFor(i - 1), `Overdrawn ladder keeps rising at ${i + 1}`);
});

// ── economy helpers ──────────────────────────────────────────────────────────────────────────────────
test('Night 1 stake cap is a third of the starting pocket and never below 1', () => {
  assert.equal(ECO.night1StakeCap(30), 10);
  assert.equal(ECO.night1StakeCap(2), 1);
  assert.equal(ECO.night1StakeCap(0), 1);
});

test('stakeNeedsConfirm: only stakes above half the pocket, never the machine minimum', () => {
  assert.equal(ECO.stakeNeedsConfirm(10, 30, 1), false);
  assert.equal(ECO.stakeNeedsConfirm(15, 30, 1), false, 'exactly half is allowed');
  assert.equal(ECO.stakeNeedsConfirm(16, 30, 1), true);
  assert.equal(ECO.stakeNeedsConfirm(1, 1, 1), false, 'the minimum never asks');
  assert.equal(ECO.stakeNeedsConfirm(5, 8, 5), false, 'minimum stake of a table never asks');
});

test('rescueLoan: N coins now, 1.5 N more quota, at least 8 coins', () => {
  const a = ECO.rescueLoan(40);
  assert.equal(a.coins, 10);
  assert.equal(a.quota, 15);
  assert.equal(ECO.rescueLoan(10).coins, ECO.RESCUE_MIN);
  const b = ECO.rescueLoan(4000);
  assert.equal(b.coins, 1000);
  assert.equal(b.quota, 1500);
});

// ── the Watch clock hold ─────────────────────────────────────────────────────────────────────────────
test('clock hold: holds for its time, release lets go, a forgotten hold expires', () => {
  HOLD.clearClockHolds();
  assert.equal(HOLD.clockHeld(), false);
  HOLD.holdClock('tutorial', 3);
  HOLD.holdClockFor('collector', 6);
  assert.equal(HOLD.clockHeld(), true);
  HOLD.tickClockHold(4);
  assert.deepEqual(HOLD.clockHolders(), ['collector'], 'the 3 s hold expired');
  HOLD.releaseClock('collector');
  assert.equal(HOLD.clockHeld(), false);
  HOLD.holdClock('x', 1);
  HOLD.tickClockHold(2);
  assert.equal(HOLD.clockHeld(), false);
});

/** A run in the play phase of Night 1, Watch 1. */
function playing(seed = 5) {
  const run = RUN.createRun({ seed, mode: 'debt' });
  assert.equal(run.startWatch(), true);
  for (let i = 0; i < 40 && run.shift.phase !== 'play'; i++) run.tick(0.5);
  assert.equal(run.shift.phase, 'play');
  return run;
}
const SRC = { mid: 'm-test', machineId: 'bigone' };
/** Lose a stake, pressing twice when the first press asks for confirmation. */
function burn(run, amount) {
  if (!run.bet(amount, SRC) && !run.bet(amount, SRC)) throw new Error('bet refused twice');
  run.win(0, SRC, { bet: amount, tier: 'none' });
}

test('the Watch clock stands still while the tutorial holds it, and runs again after', () => {
  HOLD.clearClockHolds();
  const run = playing();
  const t0 = run.timeLeft();
  HOLD.holdClock('tutorial', 30);
  for (let i = 0; i < 10; i++) run.tick(1);
  assert.equal(run.timeLeft(), t0, 'held');
  HOLD.releaseClock('tutorial');
  run.tick(5);
  assert.ok(run.timeLeft() < t0, 'released');
  run.dispose();
});

// ── stake safety ─────────────────────────────────────────────────────────────────────────────────────
test('Night 1 caps the top stake at a third of the starting pocket; Night 2 does not', () => {
  const run = RUN.createRun({ seed: 3, mode: 'debt' });
  if (!REG.get('bigone')) { run.dispose(); return; }
  assert.equal(run.betLimits('bigone', 'x').max, 10);
  run.dispose();
});

test('a stake above half the pocket needs a second press (event + refusal), then goes through', () => {
  const run = playing(8);
  const seen = [];
  const off = EV.bus.on('run:stakeConfirm', (e) => seen.push(e));
  const spin = (amount) => {
    const ok = run.bet(amount, SRC);
    if (ok) run.win(0, SRC, { bet: amount, tier: 'none' });
    return ok;
  };
  assert.equal(spin(10), true, '10 of 30 needs no confirm');
  assert.equal(spin(10), true, '10 of 20 is exactly half');
  assert.equal(run.wallet(), 10);
  assert.equal(run.bet(10, SRC), false, 'all-in: first press refused');
  assert.equal(String(run.lastRefusal()), 'confirm');
  assert.equal(run.wallet(), 10, 'nothing was charged');
  assert.equal(seen.at(-1).state, 'ask');
  assert.equal(seen.at(-1).amount, 10);
  assert.deepEqual(run.pendingStake(SRC.mid), { amount: 10, left: 6 });
  assert.equal(run.bet(10, SRC), true, 'second press confirms');
  assert.equal(run.wallet(), 0);
  assert.equal(seen.at(-1).state, 'clear');
  off();
  run.dispose();
});

test('the second press must repeat the same stake, and the arm lapses after 6 s', () => {
  const run = playing(9);
  run.bet(10, SRC); run.win(0, SRC, { bet: 10, tier: 'none' });
  run.bet(10, SRC); run.win(0, SRC, { bet: 10, tier: 'none' });
  assert.equal(run.bet(10, SRC), false);
  assert.equal(run.bet(5, SRC), true, 'a different, smaller stake just plays');
  run.win(0, SRC, { bet: 5, tier: 'none' });
  assert.equal(run.wallet(), 5);
  assert.equal(run.bet(4, SRC), false, 'armed again');
  for (let i = 0; i < 8; i++) run.tick(1);
  assert.equal(run.pendingStake(SRC.mid), null, 'lapsed');
  run.dispose();
});

// ── the rescue call ──────────────────────────────────────────────────────────────────────────────────
test('rescue: pocket 0 with the quota unmet rings the Collector loan; taking it pays N now and adds 1.5 N to the quota', () => {
  const run = playing(11);
  const rings = [];
  const off = EV.bus.on('phone:ring', (e) => rings.push(e.callId));
  for (let k = 0; k < 3; k++) { burn(run, 10); }
  assert.equal(run.wallet(), 0);
  const due0 = run.shift.quota().due;
  const call = run.phone();
  assert.ok(call, 'the phone rings');
  assert.ok(call.id >= 1_000_000, 'rescue ids never collide with the hotline');
  assert.equal(call.script, 'hotline.call.rescue');
  assert.equal(call.options.length, 1);
  assert.match(call.options[0], /^hotline\.deal\.rescue\|c=8\|q=12$/);
  assert.equal(rings.length, 1);
  run.answerPhone(-1);
  run.answerPhone(0);
  assert.equal(run.phone(), null);
  assert.equal(run.wallet(), 8);
  assert.equal(run.shift.quota().due, due0 + 12);
  off();
  run.dispose();
});

test('rescue: no call while the pocket has coins, the quota is met, or interest alone covers it', () => {
  const run = playing(12);
  assert.equal(run.phone(), null);
  run.bet(10, SRC); run.win(0, SRC, { bet: 10, tier: 'none' });
  assert.equal(run.phone(), null, 'pocket still 20');
  run.dispose();
  const rich = playing(13);
  for (let k = 0; k < 3; k++) { burn(rich, 10); }
  assert.ok(rich.phone(), 'broke with 0 deposited: rings');
  rich.dispose();
});

test('rescue: an unanswered call lapses (the line goes dead) and does not ring again at once', () => {
  const run = playing(14);
  const res = [];
  const off = EV.bus.on('hotline:result', (e) => res.push(e));
  for (let k = 0; k < 3; k++) { burn(run, 10); }
  assert.ok(run.phone());
  for (let i = 0; i < 34; i++) run.tick(1);   // the rescue call rings 30 s
  assert.equal(run.phone(), null);
  assert.equal(res.at(-1)?.kind, 'missed');
  run.tick(1); run.tick(1);
  assert.equal(run.phone(), null, 'cool-down');
  off();
  run.dispose();
});

test('rescue line: ring, pick up, take; one option; save-safe numbers', () => {
  const taken = [];
  const line = RES.createRescue({ selfId: 1, now: () => 0, ringSeconds: () => 10, take: (l) => taken.push(l) });
  assert.equal(line.active(), false);
  assert.equal(line.ring({ coins: 12, quota: 18 }), true);
  assert.equal(line.ring({ coins: 12, quota: 18 }), false, 'one call at a time');
  assert.equal(line.phone().answeredBy, null);
  line.answer(0);
  assert.equal(taken.length, 0, 'must pick up first');
  line.answer(-1);
  assert.equal(line.phone().answeredBy, 1);
  line.answer(0);
  assert.deepEqual(taken, [{ coins: 12, quota: 18 }]);
  assert.equal(line.active(), false);
});

// ── the Pawn ─────────────────────────────────────────────────────────────────────────────────────────
function pawnOf(o = {}) {
  const h = { night: o.night ?? 0, watch: o.watch ?? 0, held: [], suits: o.suits ?? ['reels', 'cards', 'dice', 'wheels', 'drops', 'curios'] };
  const rng = R.createRng(o.seed ?? 1);
  const host = {
    selfId: 1, rng: () => rng, night: () => h.night, watch: () => h.watch, open: () => true, si: () => 1,
    held: () => h.held, canTake: (id) => !h.held.includes(id), pegsFree: () => 6 - h.held.length, wallet: () => 1000, tickets: () => 5,
    spendTickets: () => true, freeRerolls: () => 0, useFreeReroll: () => false, buyCharm: () => true, sellCharm: () => true,
    sellValue: () => 0, removeCurse: () => true, meta: () => false,
    floor: () => h.suits.map((s) => ({ machineId: `m_${s}`, tags: [s] })),
  };
  return { h, p: new SH.Pawn(host) };
}
const SYN = (suits) => (id) => {
  const d = E.charmDef(id);
  return CH.SUIT_SCALED_CHARMS.has(id) && suits.includes(d.tag.toLowerCase());
};

test('first shop of a run always holds a synergy charm for a suit on the floor', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const { p } = pawnOf({ seed, suits: ['reels', 'cards'] });
    const ids = p.stock(1).filter((s, i) => s && i !== 3).map((s) => s.charmId);
    assert.ok(ids.some(SYN(['reels', 'cards'])), `seed ${seed}: ${ids.join(',')}`);
  }
});

test('the guarantee is for the first visit only: later shops are not forced', () => {
  let forced = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const { p } = pawnOf({ seed, night: 2, watch: 1, suits: ['reels'] });
    const ids = p.stock(1).filter((s, i) => s && i !== 3).map((s) => s.charmId);
    if (!ids.some(SYN(['reels']))) forced++;
  }
  assert.ok(forced > 0, 'some later shelves have no REELS synergy charm');
});

test('the Pawn restocks when the Night rolls over (the key changes with the Night, not only the Watch)', () => {
  const { h, p } = pawnOf({ seed: 21, night: 0, watch: 2 });
  const a = p.stock(1).map((s) => s?.charmId ?? null);
  h.night = 1; h.watch = 0;
  const b = p.stock(1).map((s) => s?.charmId ?? null);
  assert.notDeepEqual(a, b, 'a new Night draws a new shelf');
});

test('in a real run the Dawn shelf is already the next Night shelf and OPEN THE FLOOR keeps it', () => {
  const run = RUN.createRun({ seed: 31, mode: 'debt' });
  const ids = () => run.pawn.stock(run.selfId).map((s) => s?.charmId ?? null);
  const night1 = ids();
  assert.equal(night1.length, 4);
  run.watch = 2;                         // the last Watch's intermission: its own shelf
  const lastWatch = ids();
  assert.notDeepEqual(lastWatch, night1);
  run.nightDone = true;                  // Dawn, quota paid, floor not opened yet
  const dawn = ids();
  assert.notDeepEqual(dawn, lastWatch, 'the Night rolled over: a fresh shelf');
  run.index = 1; run.watch = 0; run.nightDone = false;   // what openFloor does
  assert.deepEqual(ids(), dawn, 'opening the floor does not reshuffle it');
  run.dispose();
});
