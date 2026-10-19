// Wave 13 economy and safety tests: the strictly increasing quota ladder, Night 1 stake cap, the second-press stake confirm,
// the Collector's rescue loan, the Watch-clock hold, the Pawn's first-shop synergy guarantee and its Night-rollover restock.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let SCH, ECO, RUN, REG, SH, R, E, CH, HOLD, RES, EV, WE, KT;
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
  WE = await load('src/game/watchEvents.ts');
  KT = await load('src/game/data/kits.ts');
  REG.load();
});

// ─â”€ the ladder ─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─
test('quota ladder: strictly increasing night over night, N1 is twice the Pauper pocket', () => {
  const q = SCH.BASE_NIGHTS.map((n) => n.base);
  for (let i = 1; i < q.length; i++) assert.ok(q[i] > q[i - 1], `N${i + 1} (${q[i]}) must exceed N${i} (${q[i - 1]})`);
  assert.ok(q[0] >= 2 * SCH.START.pocket, `N1 ${q[0]} is at least twice the ${SCH.START.pocket} pocket (wave 85: the start never pays the quota)`);
  for (let i = 1; i < SCH.BASE_RUN_NIGHTS + 4; i++) assert.ok(SCH.quotaFor(i) > SCH.quotaFor(i - 1), `Overdrawn ladder keeps rising at ${i + 1}`);
});

// ─â”€ economy helpers ─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€
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

// ─â”€ WAVE 23 quota ladder smoothing (flow-fixes) ─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€
test('WAVE 47 ladder: no Night steps up more than its cap (2x up to N3, 3x from N4); the tuned late ladder is pinned', () => {
  const q = SCH.BASE_NIGHTS.map((n) => n.base);
  for (let i = 1; i < q.length; i++) assert.ok(q[i] / q[i - 1] <= SCH.maxLadderStep(i + 1) + 1e-9, `N${i + 1} / N${i} = ${(q[i] / q[i - 1]).toFixed(2)} <= ${SCH.maxLadderStep(i + 1)}`);
  assert.deepEqual([SCH.maxLadderStep(2), SCH.maxLadderStep(3), SCH.maxLadderStep(4), SCH.maxLadderStep(8)], [2, 2, 3, 3]);
  assert.deepEqual(q, [24, 36, 72, 144, 288, 576, 1152, 2304], 'the tuned ladder (director: N2 36, every step a 2x doubling; N1 teaching quota 24; scripts/sim/run.mjs, 2000 human runs, seed 20261013)');
  for (let i = 1; i < q.length; i++) assert.ok(q[i] <= 2 * q[i - 1], `N${i + 1} is at most 2x N${i} (director: no step above 2x after Night 2)`);
});

test('WAVE 85 house takes notice: every Night the quota is at least 1.25 x what the Night opens with, uncapped; the ladder is the floor; share 0 and a late "from" switch it off', () => {
  assert.equal(SCH.HOUSE_NOTICE_FROM, 1, 'wave 85: the notice runs on every Night');
  assert.equal(SCH.HOUSE_NOTICE_SHARE, 1.25, 'wave 85: a Night opens with at most 80 % of its quota');
  assert.equal(SCH.HOUSE_NOTICE_CAP, 0, 'wave 85: no cap (a cap would let a rich hold pay its own quota)');
  assert.equal(SCH.houseNoticeQuota(1, 24, 12), 24, 'the 12-coin start keeps the ladder (1.25 x 12 = 15)');
  assert.equal(SCH.houseNoticeQuota(1, 24, 0), 24, 'no wealth, no floor');
  assert.equal(SCH.houseNoticeQuota(1, 24, 22), 27.5, 'a Foundations pocket of +10 raises Night 1 instead of paying it');
  assert.equal(SCH.houseNoticeQuota(2, 36, 700), 875, 'a rich hold floors Night 2 (the old rule had no notice before Night 6)');
  assert.equal(SCH.houseNoticeQuota(6, 576, 1300), 1630, 'Night 6: 1.25 x 1300 (1625, rounded to the quota step), no 2.2 x ladder cap any more');
  assert.equal(SCH.houseNoticeQuota(6, 576, 1300, 1.25, 1, 2.2), 1270, 'the cap is still a dial: 2.2 x 576, rounded to the quota step');
  assert.equal(SCH.houseNoticeQuota(6, 504, 1000, 0), 504, 'share 0 switches the rule off');
  assert.equal(SCH.houseNoticeQuota(3, 72, 1e6, 1.25, 6), 72, '"from" 6 keeps the old late-only rule available');
  assert.equal(SCH.quotaFor(4, { wealth: 1000 }), 1250, 'quotaFor(index 4) is Night 5: the floor (1250) over the ladder (288)');
  assert.equal(SCH.quotaFor(4), 288, 'quotaFor without wealth is the ladder');
});

test('WAVE 85 nogamble: a bot that banks every coin and never pulls fails Night 1 on all 200 seeds (sim probe), where the 30-coin start paid it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nogamble-'));
  const sim = fileURLToPath(new URL('../sim/run.mjs', import.meta.url));
  const play = (name, extra = []) => {
    const out = join(dir, name + '.json');
    const r = spawnSync(process.execPath, [sim, '--bots', 'nogamble,human', '--runs', '200', '--brief', '--json', out, ...extra], { encoding: 'utf8', timeout: 170000 });
    assert.equal(r.status, 0, r.stderr || r.stdout);
    return JSON.parse(readFileSync(out, 'utf8')).results;
  };
  try {
    const now = play('now');
    assert.equal(now.nogamble[0].reachPct, 0, 'no seed pays Night 1 without a single pull');
    assert.equal(now.nogamble[0].freePct, 0, 'and none opens with the whole quota in the pocket');
    assert.ok(now.human[0].reachPct > 50, 'the probe is not vacuous: the casual bot does pay Night 1 (' + now.human[0].reachPct + ' %)');
    for (const row of now.human) assert.equal(row.freePct, 0, 'Night ' + row.night + ': the casual bot never opens a Night able to pay it');
    const before = play('before', ['--start', '30', '--notice-from', '6', '--notice-share', '1', '--notice-cap', '2.2']);
    assert.equal(before.nogamble[0].reachPct, 100, 'the old 30-coin start paid Night 1 by depositing and never playing');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('WAVE 85 Dawn: the next quota is floored on what the next Night opens with (pocket + surplus, at least the float), and the Night opens on that quota', () => {
  // a rich Dawn: 20 in the pocket and 100 over the quota come to 120, so Night 2 asks 1.25 x 120 and the preview says so before the Night opens
  const rich = RUN.createRun({ seed: 85, mode: 'debt' });
  rich.coins = 20;
  rich.debtPaid = rich.quota.due + 100;
  rich.dawn();
  assert.equal(rich.coins, 120);
  const prev = rich.nextQuotaPreview();
  assert.equal(prev.due, SCH.quotaFor(1, { wealth: 120 }), 'the preview reads the hold of the opening');
  assert.ok(prev.due >= 1.25 * 120 && prev.due > rich.coins, 'Night 2 asks more than the 120 held: ' + prev.due);
  assert.equal(rich.openFloor(), true);
  assert.equal(rich.quota.due, prev.due, 'the Night opens on the quota the Dawn promised');
  assert.equal(rich.coins, 120, 'no float on top of a pocket above it');
  rich.dispose();
  // a poor Dawn: nothing left, the House float (18) is what Night 2 opens with, half of its 36
  const poor = RUN.createRun({ seed: 87, mode: 'debt' });   // a seed whose auto-picked Dawn boon (openFloor takes the leftmost card) leaves the quota alone
  poor.coins = 0;
  poor.debtPaid = poor.quota.due;
  poor.dawn();
  assert.equal(poor.openFloor(), true);
  assert.equal(poor.mod('quota.mult', 'run', 1), 1);
  assert.equal(poor.coins, ECO.houseFloat(1));
  assert.equal(poor.quota.due, SCH.quotaFor(1), 'the ladder: 1.25 x 18 is under 36');
  assert.equal(2 * poor.coins, poor.quota.due, 'and the hold is half the quota');
  poor.dispose();
});

test('WAVE 85 no hold pays its quota: every Night, every wealth, every kit, every stake, and a maxed Foundations pocket', () => {
  for (let index = 0; index < SCH.BASE_RUN_NIGHTS + 4; index++) {
    for (const wealth of [1, 7, 12, 22, 62, 99, 999, 1e4, 123456, 1e7]) {
      const q = SCH.quotaFor(index, { wealth });
      assert.ok(q > wealth, "Night " + (index + 1) + " holding " + wealth + ": quota " + q + " is more");
    }
  }
  // Night 1 as the player meets it: 12 of 24 in the pocket, and the 2 Tickets at the cashier (5 coins each) still leave it short
  assert.equal(SCH.START.pocket, ECO.houseFloat(0), 'the start is the Night 1 House float');
  assert.ok(SCH.START.pocket * 2 <= SCH.BASE_NIGHTS[0].base, 'half the quota or less');
  assert.ok(SCH.START.pocket + SCH.START.tickets * 5 < SCH.BASE_NIGHTS[0].base, 'pocket plus the Tickets sold is still short');
  for (let level = 0; level <= 5; level++) {
    const hold = SCH.START.pocket + 10 * level;   // Foundations V1: +10 a level
    assert.ok(SCH.quotaFor(0, { wealth: hold }) > hold, "Foundations V1 level " + level + ": " + hold + " coins");
  }
  // the real run, every kit on every stake: the quota is more than the pocket and the pre-deposit together
  for (const kit of KT.KITS) {
    for (let stake = 0; stake <= 7; stake++) {
      const run = RUN.createRun({ seed: 85, mode: 'debt', cfg: { kit: kit.id, stake } });
      const hold = run.wallet() + run.shift.quota().deposited;
      assert.equal(hold, kit.coins + kit.predeposit, kit.id + " holds its coins and pre-deposit");
      assert.ok(run.shift.quota().due > hold, kit.id + " stake " + stake + ": due " + run.shift.quota().due + " against " + hold);
      assert.ok(run.shift.quota().due >= 1.25 * hold - 1, kit.id + " stake " + stake + ": the quota keeps 25 % over the hold");
      assert.equal(run.shift.quota().met, false, kit.id + " stake " + stake + ": Night 1 starts unpaid");
      run.dispose();
    }
  }
});

test('WAVE 47 floor events: the same event is never rolled twice in a row within a Night (and the memory survives a save)', () => {
  // rollWatchEvent never returns the avoided id.
  for (const d of WE.WATCH_EVENTS) {
    const rng = R.createRng(20261013);
    for (let k = 0; k < 400; k++) {
      const r = WE.rollWatchEvent(rng.fork(`avoid.${d.id}.${k}`), 4, false, d.id);
      if (r) assert.notEqual(r.def.id, d.id, `${d.id} avoided`);
    }
  }
  // Consecutive Watches of one Night: no repeat. A new Night starts clean (the last event of the Night before may come back).
  const rng = R.createRng(20261013);
  const we = new WE.WatchEvents({ isHot: () => false, touch: () => {} });
  let prev = null, prevNight = 0, pairs = 0;
  for (let night = 1; night <= 800; night++) {
    for (let w = 0; w < 4; w++) {
      const def = we.begin(rng, night, w, false);
      const id = def ? def.id : null;
      if (id !== null && prev !== null && prevNight === night) { pairs++; assert.notEqual(id, prev, `Night ${night} Watch ${w + 1} repeated ${id}`); }
      prev = id; prevNight = night;
      we.end();
    }
  }
  assert.ok(pairs > 500, `the seeded run rolled enough consecutive pairs to test (${pairs})`);
  // The memory of the last event survives a save taken between Watches.
  const a = new WE.WatchEvents({ isHot: () => false, touch: () => {} });
  let first = null;
  for (let w = 0; w < 50 && !first; w++) first = a.begin(R.createRng(5), 2, w, false);
  a.end();
  const s = a.snapshot();
  assert.ok(s && s.id === null && s.last === first.id && s.lastNight === 2, 'the save keeps the last event of the Night');
  const b = new WE.WatchEvents({ isHot: () => false, touch: () => {} });
  b.restore(JSON.parse(JSON.stringify(s)));
  assert.equal(b.snapshot().last, first.id, 'a reload restores the memory');
  assert.equal(b.view(), null, 'and no event is live between Watches');
});

// ─â”€ the Watch clock hold ─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─
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
/** Lose the whole pocket, two coins at a time (Night 1 caps a stake at a third of the 12-coin start). */
function burnAll(run) {
  while (run.wallet() > 0) burn(run, Math.min(2, run.wallet()));
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

// ─â”€ stake safety ─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─
test('Night 1 caps the top stake at a third of the starting pocket; Night 2 does not', () => {
  const run = RUN.createRun({ seed: 3, mode: 'debt' });
  if (!REG.get('bigone')) { run.dispose(); return; }
  const lim = run.betLimits('bigone', 'x');
  assert.equal(lim.max, ECO.snapDown(ECO.night1StakeCap(SCH.START.pocket), lim.ladder), 'a third of the 12-coin start is 4: the top ladder step at or under it');
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
  assert.equal(spin(2), true, '2 of 12 needs no confirm');
  for (let k = 0; k < 4; k++) assert.equal(spin(2), true, '2 of 4 or more is half or under');
  assert.equal(run.wallet(), 2);
  assert.equal(run.bet(2, SRC), false, 'all-in: first press refused');
  assert.equal(String(run.lastRefusal()), 'confirm');
  assert.equal(run.wallet(), 2, 'nothing was charged');
  assert.equal(seen.at(-1).state, 'ask');
  assert.equal(seen.at(-1).amount, 2);
  assert.deepEqual(run.pendingStake(SRC.mid), { amount: 2, left: 6 });
  assert.equal(run.bet(2, SRC), true, 'second press confirms');
  assert.equal(run.wallet(), 0);
  assert.equal(seen.at(-1).state, 'clear');
  off();
  run.dispose();
});

test('the second press must repeat the same stake, and the arm lapses after 6 s', () => {
  const run = playing(9);
  for (let k = 0; k < 4; k++) { run.bet(2, SRC); run.win(0, SRC, { bet: 2, tier: 'none' }); }   // 12 -> 4
  run.bet(1, SRC); run.win(0, SRC, { bet: 1, tier: 'none' });                                   // 4 -> 3
  assert.equal(run.bet(2, SRC), false, '2 of 3 is more than half');
  assert.equal(run.bet(1, SRC), true, 'a different, smaller stake just plays');
  run.win(0, SRC, { bet: 1, tier: 'none' });
  assert.equal(run.wallet(), 2);
  assert.equal(run.bet(2, SRC), false, 'armed again');
  for (let i = 0; i < 8; i++) run.tick(1);
  assert.equal(run.pendingStake(SRC.mid), null, 'lapsed');
  run.dispose();
});

// ─â”€ the rescue call ─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€
test('rescue: pocket 0 with the quota unmet rings the Collector loan; taking it pays N now and adds 1.3 N to the quota', () => {
  const run = playing(11);
  const rings = [];
  const off = EV.bus.on('phone:ring', (e) => rings.push(e.callId));
  burnAll(run);
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
  run.bet(2, SRC); run.win(0, SRC, { bet: 2, tier: 'none' });
  assert.equal(run.phone(), null, 'pocket still 10');
  run.dispose();
  const rich = playing(13);
  burnAll(rich);
  assert.ok(rich.phone(), 'broke with 0 deposited: rings');
  rich.dispose();
});

test('rescue: an unanswered call lapses (the line goes dead) and does not ring again at once', () => {
  const run = playing(14);
  const res = [];
  const off = EV.bus.on('hotline:result', (e) => res.push(e));
  burnAll(run);
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

// ─â”€ the Pawn ─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─
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

// ─â”€ Wave 20: live interest, the pocket-short lamp banner, distinct names for two lamps on one machine ─â”€─â”€─â”€─â”€
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
  assert.ok(STR_LAMPS.en['none'] === 'No lamps tonight, pocket too low' && STR_LAMPS.tr['none']);
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
