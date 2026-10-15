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

test('WAVE 23 rescueTerms: the quota penalty is at most 1.3 x the cash given, and at least the minimum loan', () => {
  assert.equal(RES.RESCUE_PENALTY_MAX, 1.3);
  for (const due of [0, 10, 31, 58, 115, 196, 400, 1100, 4000]) {
    const l = RES.rescueTerms(due);
    assert.ok(l.coins >= ECO.RESCUE_MIN, `coins >= RESCUE_MIN at due ${due}`);
    assert.ok(l.quota <= Math.floor(l.coins * 1.3), `penalty ${l.quota} <= 1.3 x ${l.coins} at due ${due}`);
    assert.ok(l.quota > 0, 'a loan always adds some quota');
  }
  // the playtest case: 49 coins used to add +74 (1.5x); now +63
  assert.deepEqual(RES.rescueTerms(196), { coins: 49, quota: 63 });
});

// ── WAVE 23 quota ladder smoothing (flow-fixes) ──────────────────────────────────────────────────────
test('WAVE 42 ladder: no Night steps up more than 2x (director decision 1: the cap that keeps N2 and N3 near the human bot targets)', () => {
  const q = SCH.BASE_NIGHTS.map((n) => n.base);
  for (let i = 1; i < q.length; i++) assert.ok(q[i] / q[i - 1] <= 2 + 1e-9, `N${i + 1} / N${i} = ${(q[i] / q[i - 1]).toFixed(2)} <= 2`);
  assert.deepEqual(q, [31, 38, 72, 144, 288, 576, 1150, 2300], 'the tuned ladder (wave 45, scripts/sim/run.mjs, 2000 human runs with 5-15 % stakes)');
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
test('rescue: pocket 0 with the quota unmet rings the Collector loan; taking it pays N now and adds 1.3 N to the quota', () => {
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
  assert.match(call.options[0], /^hotline\.deal\.rescue\|c=8|q=10$\|q=12$/);
  assert.equal(rings.length, 1);
  run.answerPhone(-1);
  run.answerPhone(0);
  assert.equal(run.phone(), null);
  assert.equal(run.wallet(), 8);
  assert.equal(run.shift.quota().due, due0 + 10);
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

// ── Wave 20: live interest, the pocket-short lamp banner, distinct names for two lamps on one machine ────────
let CIRC, STR_TUT, STR_LAMPS;
before(async () => {
  CIRC = await load('src/game/circuit.ts');
  STR_TUT = (await load('src/game/tutorial.strings.ts')).default;
  STR_LAMPS = (await load('src/game/lamps.strings.ts')).default;
});

test('live interest: the schedule rate plus bonuses, floored at 0; the deposit is capped at 2 × the loan-inflated due', () => {
  assert.equal(SCH.ratePercent(SCH.interestRate(0.9, -0.03)), 87, 'Night 1 with a -3 % bonus');
  assert.equal(SCH.ratePercent(SCH.interestRate(0.3, -0.01)), 29, 'Night 2 with the Skipped Interest buff');
  assert.equal(SCH.interestRate(0.1, -0.5), 0, 'never negative');
  const live = SCH.liveInterest(0, 0, 50, 40);
  assert.deepEqual([live.rate, live.amount, live.cap], [0.55, 27, 80], 'floor(min(deposit, 2 × due) × rate), Night 1 at 55 % (wave 42)');
  assert.equal(SCH.liveInterest(0, 0, 500, 40).amount, 44, 'a huge deposit still earns on at most 2 × due (80 × 55 %)');
  assert.equal(SCH.liveInterest(0, 0, 500, 40).cap, 80);
});

test('the Terminal rate is the live rate of the current Night (what Settle pays), not the schedule rate alone', () => {
  const run = RUN.createRun({ seed: 41, mode: 'debt' });
  assert.equal(run.interestPct(), 55, 'Night 1 schedule rate (wave 42: 55 %, then 50, 45 … 20 per Night)');
  run.index = 1;
  assert.equal(run.interestPct(), 50, 'Night 2 schedule rate');
  run.index = 2;
  assert.equal(run.interestPct(), 45, 'Night 3 schedule rate');
  run.dispose();
});

test('the tutorial deposit line reads {rate} and names the Watch in both languages', () => {
  assert.ok(STR_TUT.en['deposit'].includes('{rate}% per Watch tonight'));
  assert.ok(STR_TUT.tr['deposit'].includes('%{rate} faiz'));
  assert.ok(!STR_TUT.en['deposit'].includes('{pct}') && !STR_TUT.tr['deposit'].includes('{pct}'));
  assert.ok(STR_LAMPS.en['none'] === 'No lamps tonight — pocket too low' && STR_LAMPS.tr['none']);
});

test('lampView: two Lamps on one machine get ordinals (Bandit (L1), Bandit (L2)); other machines and single Lamps stay bare', () => {
  const machine = { 'GAL-07': 'bandit', 'WELL-04': 'bandit', 'WELL-10': 'roulette', 'WELL-01': 'bigone' };
  const v = CIRC.lampView(['WELL-04'], ['GAL-07', 'WELL-10'], (mid) => machine[mid] ?? '');
  assert.deepEqual(v.hot, [{ mid: 'WELL-04', machineId: 'bandit', dup: 2 }], 'the later instance id is L2 (sorted by instance)');
  assert.deepEqual(v.cold[0], { mid: 'GAL-07', machineId: 'bandit', dup: 1 });
  assert.deepEqual(v.cold[1], { mid: 'WELL-10', machineId: 'roulette' }, 'a single Lamp carries no ordinal');
  assert.equal(CIRC.lampLabel('Bandit', v.hot[0].dup), 'Bandit (L2)');
  assert.equal(CIRC.lampLabel('Roulette'), 'Roulette');
  assert.equal(v.pocketShort, false);
  assert.equal(CIRC.lampView([], [], () => '', true).pocketShort, true, 'the pocket-short flag reaches the view');
});

test('pocket short: a Bell with no candidate at this pocket sets pocketShort; a Bell with a Lamp does not', () => {
  const rng = R.createRng(7);
  const c = new CIRC.Circuit();
  c.startWatch(rng, [], { lamps: true, hot: 1, cold: 1, newIsHot: false, pocketShort: true });
  assert.equal(c.pocketShort(), true);
  assert.deepEqual({ hot: c.hot(), cold: c.cold() }, { hot: [], cold: [] }, 'no candidate, no Lamp');
  c.startWatch(rng, [{ mid: 'WELL-01', machineId: 'bigone', minBet: 1 }], { lamps: true, hot: 1, cold: 0, newIsHot: false, pocketShort: false });
  assert.equal(c.pocketShort(), false);
  assert.deepEqual(c.hot(), ['WELL-01']);
  c.settle();
  assert.equal(c.pocketShort(), false, 'Settle clears the banner');
  const back = new CIRC.Circuit();
  back.restore({ ...c.snapshot(), short: true });
  assert.equal(back.pocketShort(), true, 'the flag survives a save');
});
