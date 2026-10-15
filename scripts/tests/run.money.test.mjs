// Money flow: the Dawn surplus returns to the pocket, the WIN callout preview equals what win() credits, the Night 1 bet
// limits are the real run limits, and the tutorial's spin step teaches rotation.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let RUN, REG, ECO, TUT, SCH, EV, HL;
before(async () => {
  RUN = await load('src/game/run.ts');
  REG = await load('src/machines/_base/registry.ts');
  ECO = await load('src/game/economy.ts');
  TUT = await load('src/game/tutorial.strings.ts');
  SCH = await load('src/game/data/schedule.ts');
  EV = await load('src/core/events.ts');
  HL = await load('src/game/hotline.ts');
  REG.load();
});

test('Dawn: a paid Night returns its surplus above the quota to the pocket, and the deposit state starts empty', () => {
  const run = RUN.createRun({ seed: 41, mode: 'debt' });
  const due = run.quota.due;
  const before = run.coins;
  run.debtPaid = due + 50;
  run.dawn();
  assert.equal(run.coins, before + 50, 'the 50 above the quota comes back to the pocket');
  assert.equal(run.debtPaid, 0, 'the next quota starts from zero deposited');
  run.dispose();
});

test('Dawn: an exact payment returns nothing extra', () => {
  const run = RUN.createRun({ seed: 42, mode: 'debt' });
  const due = run.quota.due;
  const before = run.coins;
  run.debtPaid = due;
  run.dawn();
  assert.equal(run.coins, before);
  assert.equal(run.debtPaid, 0);
  run.dispose();
});

test('quota met (decision 2): a deposit after the quota is met is banked, not paid back; the surplus waits for Dawn', () => {
  const run = RUN.createRun({ seed: 45, mode: 'debt' });
  const due = run.quota.due;
  const pocket = [];
  const off = EV.bus.on('eco:wallet', (e) => { if (e.reason === 'dawn:surplus') pocket.push(e.delta); });
  run.debtPaid = due - 100;
  run.syncQuota();
  run.coins = 1000;
  assert.ok(run.deposit(300, true), 'the deposit is accepted');
  assert.equal(run.coins, 700, 'nothing is paid back at the deposit');
  assert.equal(run.debtPaid, due + 200, 'the bank holds the whole deposit');
  assert.equal(run.quota.deposited, due + 200);
  assert.equal(run.quota.overshoot, 200, 'overshoot (and so the tiers) read the bank');
  assert.ok(run.quota.met);
  assert.deepEqual(pocket, [], 'no surplus reaches the pocket before Dawn');
  run.dawn();
  off();
  assert.deepEqual(pocket, [200], 'Dawn returns bank minus quota, once');
  assert.equal(run.coins, 900);
  run.dispose();
});

test('quota met (decision 2): overpays keep earning interest until Dawn, and Dawn returns the whole surplus once', () => {
  const run = RUN.createRun({ seed: 46, mode: 'debt' });
  const due = run.quota.due;
  run.debtPaid = due;
  run.syncQuota();
  run.coins = 500;
  run.deposit(120, true);
  run.deposit(80, true);
  assert.equal(run.coins, 300, 'every overpay stays in the bank');
  run.watchPulls = 3;
  run.settleWatch();
  const interest = run.stats.interest ?? 0;
  assert.equal(interest, Math.floor(Math.min(due + 200, 2 * due) * 0.55), 'Night 1 pays 55 % on the whole bank, overpay included');
  assert.equal(run.coins, 300, 'the interest goes into the bank too');
  assert.equal(run.debtPaid, due + 200 + interest);
  const before = run.coins;
  run.dawn();
  assert.equal(run.coins, before + 200 + interest, 'Dawn returns the whole surplus, interest included, exactly once');
  assert.equal(run.debtPaid, 0, 'the next quota starts from zero deposited');
  run.dispose();
});

test('WIN callout: previewCredit is exactly what win() credits', () => {
  const run = RUN.createRun({ seed: 43, mode: 'debt' });
  const src = { machineId: 'bigone', mid: 'm-preview' };
  const meta = { bet: 10, tier: 'big' };
  const preview = run.previewCredit(100, src, meta);
  const credited = run.win(100, src, meta);
  assert.equal(preview, credited);
  run.dispose();
});

test('Night 1 bet limits: the run cap (a third of the starting pocket), not the catalogue maximum', () => {
  const run = RUN.createRun({ seed: 44, mode: 'debt' });
  const lim = run.betLimits('bigone', 'm-limits');
  assert.ok(lim.max <= ECO.night1StakeCap(30), `Night 1 max ${lim.max} must respect the cap`);
  assert.ok(lim.min >= 1);
  run.dispose();
});

test('tutorial: the spin step teaches four pulls, then rotation (TILT lowers repeat pay), in EN and TR', () => {
  const en = TUT.default.en.spin;
  const tr = TUT.default.tr.spin;
  assert.match(en, /Spin 4 times, then try another machine/);
  assert.match(en, /TILT lowers repeat pay/);
  assert.match(tr, /4 kez/);
  assert.match(tr, /TİLT/);
});

// Cash starvation (wave 14): the float on the first deposit of a Watch, the dead pocket that rings the rescue call, and the
// Debt Terminal framing that keeps the keypad clear of the control bar at 4:3 and 16:9.
test('float: the first deposit of a Watch leaves min(30 % of the pocket, 2 cheapest bets); ALL goes below it only when confirmed', async () => {
  const F = await load('src/game/float.ts');
  {
    assert.equal(F.floorFor(100, 1), 2, 'the 2-bet cap binds on a 100 pocket');
    assert.equal(F.floorFor(8, 1), 2, '30 % of 8 is 2');
    assert.equal(F.floorFor(0, 1), 0, 'an empty pocket has no float');
    assert.equal(F.floorFor(100, 40), 30, 'the 30 % share binds when the bets are dear');
    assert.equal(F.depositRoom(100, 30), 70);
    assert.equal(F.depositRoom(10, 30), 0, 'the room never goes negative');
    assert.equal(F.pocketDead(0, 1), true);
    assert.equal(F.pocketDead(1, 1), false);
    assert.equal(F.pocketDead(4, 5), true, 'a pocket below the cheapest bet is dead');
  }
});

test('float: the run refuses any deposit that empties the pocket, and a confirmed ALL goes through', () => {
  const run = RUN.createRun({ seed: 51, mode: 'debt' });
  run.quota.due = 1_000_000;                  // far above these deposits: the quota is not met, so no surplus comes back here
  run.syncQuota();
  run.coins = 100;
  run.watchDeposits = 0;
  const floor = run.depositFloor();
  assert.ok(floor > 0 && floor < 100, `a float is kept (${floor})`);
  assert.equal(run.deposit(100), false, 'a deposit may not take the pocket below the float');
  assert.equal(run.coins, 100, 'a refused deposit moves no coins');
  assert.equal(run.deposit(100 - floor), true, 'the room above the float is deposited');
  assert.equal(run.coins, floor);
  assert.ok(run.depositFloor() > 0, 'the float applies to every deposit, not just the first');
  assert.equal(run.deposit(floor), false, 'a later deposit may not silently take the rest');
  assert.equal(run.deposit(floor, true), true, 'a confirmed later deposit goes below the float');
  assert.equal(run.coins, 0);
  run.coins = 40;
  run.watchDeposits = 0;
  assert.equal(run.deposit(40, true), true, 'a confirmed ALL goes below the float');
  assert.equal(run.coins, 0);
  run.dispose();
});

test('rescue: a pocket below the cheapest bet rings the Collector; a pocket that can still bet does not', () => {
  const run = RUN.createRun({ seed: 52, mode: 'debt' });
  run.phase = 'play';
  run.coins = 0;
  run.checkRescue();
  assert.equal(run.phone()?.script, 'hotline.call.rescue', 'an empty pocket with the quota unmet rings the rescue call');
  run.dispose();
  const run2 = RUN.createRun({ seed: 53, mode: 'debt' });
  run2.phase = 'play';
  run2.coins = run2.cheapestBet();
  run2.checkRescue();
  assert.equal(run2.phone(), null, 'a pocket that covers the cheapest bet does not ring');
  run2.dispose();
});

test('Debt Terminal framing: the keypad clears the control bar at 4:3 and 16:9, and the solved view keeps every point in the band', async () => {
  const FIT = await load('src/machines/debt_terminal/fit.ts');
  const cam = [0, 1.6, 1.1];
  const pts = [
    [-0.23, 1.38, 0.05], [0.23, 1.38, 0.05], [-0.23, 1.74, 0.05], [0.23, 1.74, 0.05],
    [-0.24, 1.94, -0.02], [0.24, 1.94, -0.02], [-0.24, 1.18, -0.02], [0.24, 1.18, -0.02],
    [-0.37, 1.12, 0.0], [0.37, 1.12, 0.0], [-0.37, 1.12, 0.36], [0.37, 1.12, 0.36],
  ];
  const keypad = pts.slice(8);
  const cases = [
    { name: '4:3 1024x768', w: 1024, h: 768, top: 120, bot: 0.66 },
    { name: '4:3 1280x960', w: 1280, h: 960, top: 150, bot: 0.7 },
    { name: '16:9 1280x720', w: 1280, h: 720, top: 110, bot: 0.66 },
    { name: '16:9 1920x1080', w: 1920, h: 1080, top: 160, bot: 0.7 },
  ];
  for (const c of cases) {
    const band = FIT.bandFromPx(c.top, c.bot * c.h, c.h);
    const aspect = c.w / c.h;
    const view = FIT.frameConsole(cam, pts, [...pts.slice(0, 4), ...keypad], band, aspect);
    const at = view.cam;
    const ys = pts.map((p) => FIT.ndcOf(at, p, view.look, view.vHalf, aspect)?.[1] ?? NaN);
    const kys = keypad.map((p) => FIT.ndcOf(at, p, view.look, view.vHalf, aspect)?.[1] ?? NaN);
    assert.ok(kys.every((y) => y >= band.bot + FIT.FIT_MARGIN - 1e-6), `${c.name}: keypad clears the control bar (${Math.min(...kys).toFixed(3)} vs ${band.bot.toFixed(3)})`);
    assert.ok(ys.every((y) => y <= band.top - FIT.FIT_MARGIN + 1e-6), `${c.name}: the LEDs stay under the seat stack`);
    const deg = (2 * view.vHalf) * 180 / Math.PI;
    assert.ok(deg >= 40 - 1e-6 && deg <= 80 + 1e-6, `${c.name}: fov ${deg.toFixed(1)} inside the game clamp`);
  }
});

test('Debt Terminal framing: a band of the whole window (no seat bar) and a narrow or missing band', async () => {
  const FIT = await load('src/machines/debt_terminal/fit.ts');
  assert.deepEqual(FIT.bandFromPx(NaN, NaN, 768), { top: 1, bot: -1 }, 'no bar edges: the whole window');
  assert.deepEqual(FIT.bandFromPx(100, 150, 768), { top: 1, bot: -1 }, 'a band under 20 % of the window is ignored');
  const b = FIT.bandFromPx(0, 384, 768);
  assert.equal(b.top, 1);
  assert.ok(Math.abs(b.bot) < 1e-9, 'the bottom bar at mid-window is NDC 0');
});

// ── the House float, carried over, and the phone's first Watch (wave 17) ─────────────────────────────────
test('House float: at each Night start the pocket is topped up to 12 + 6n, free and not added to the quota', () => {
  assert.equal(ECO.houseFloat(0), 12);
  assert.equal(ECO.houseFloat(1), 18);
  assert.equal(ECO.houseFloatTopUp(3, 1), 15, 'the Night 2 start with 3 coins is topped up by 15');
  assert.equal(ECO.houseFloatTopUp(30, 1), 0, 'a pocket above the float is left alone');
  const run = RUN.createRun({ seed: 51, mode: 'debt' });
  run.coins = 3;
  run.nightDone = true;                       // Night 1 paid: the Dawn is over and OPEN THE FLOOR is pulled
  const got = [];
  const off = EV.bus.on('eco:wallet', (e) => { if (e.reason === 'house:float') got.push(e.delta); });
  assert.ok(run.openFloor(), 'the next Night opens');
  off();
  assert.equal(run.index, 1);
  assert.equal(run.coins, 18, 'topped up to F(1) = 18');
  assert.deepEqual(got, [15], 'the float is booked once, as 15 coins');
  assert.equal(run.quota.due, SCH.quotaFor(1), 'the quota is the schedule quota: the float is not part of it');
  run.dispose();
});

test('House float: a pocket already at or above the float is not topped up', () => {
  const run = RUN.createRun({ seed: 52, mode: 'debt' });
  run.coins = 30;
  run.nightDone = true;
  assert.ok(run.openFloor());
  assert.equal(run.coins, 30);
  run.dispose();
});

test('carried over is the surplus released to the pocket: the House float is not counted in it', () => {
  const run = RUN.createRun({ seed: 53, mode: 'debt' });
  const due = run.quota.due;
  const carried = [];
  const off = EV.bus.on('eco:wallet', (e) => { if (e.reason === 'dawn:surplus') carried.push(e.delta); });
  run.coins = 500;
  run.debtPaid = due - 100;
  run.syncQuota();
  assert.ok(run.deposit(300, true));          // 200 above the quota goes back at once
  run.dawn();                                 // nothing more is held back
  off();
  assert.equal(carried.reduce((a, b) => a + b, 0), 200, 'the summary carry is exactly what reached the pocket');
  assert.equal(run.coins, 500 - 300 + 200);
  run.dispose();
});

/** A RunApi just big enough for the Hotline's scheduling (no deals are applied here). */
function phoneRun(night, watch, mods = {}) {
  const defs = new Map();
  return {
    seed: 7, selfId: 1, night: () => night,
    shift: { state: () => ({ segment: { index: watch, count: 3 }, duration: 150, stake: 1 }), quota: () => ({ due: 300 }), extend: () => {} },
    mod: (hook, _m, base) => (mods[hook] ? mods[hook](base) : base),
    buffs: { def: (id) => defs.get(id), register: (d) => { defs.set(d.id, d); }, add: () => {}, cleanse: () => {} },
    charms: () => [], grantCharm: () => true, wallet: () => 100, balance: () => 100, spend: () => true, earn: () => {},
    addDread: () => {}, dread: () => 0.3, jackpot: () => 100, jackpotAdd: () => {}, stat: () => 0,
  };
}
const phase = (p) => EV.bus.emit('shift:phase', { phase: p, index: 0 });

test('phone: from Night 2 the first Watch of every Night always rings; Night 1 and the middle Watches keep the seeded chance', () => {
  const zero = { 'x.phone.callChance': () => 0 };
  for (let seed = 1; seed <= 40; seed++) {
    for (const [night, watch, want] of [[2, 0, true], [3, 0, true], [5, 0, true], [1, 0, false], [2, 1, false], [4, 1, false]]) {
      const hl = HL.createHotline(phoneRun(night, watch, zero));
      phase('play');
      const at = hl.scheduledAt();
      assert.equal(at >= 0, want, `seed ${seed} N${night} watch ${watch + 1}: scheduled ${at}`);
      if (want) assert.ok(at >= 150 * 0.2 - 1e-9 && at <= 150 * 0.65 + 1e-9, 'the forced call lands in the usual window');
      phase('settle'); hl.dispose();
    }
  }
  // blank JackID (mute) still silences the phone, even on a first Watch
  const muted = HL.createHotline(phoneRun(2, 0, { ...zero, 'x.phone.mute': () => 1 }));
  phase('play');
  assert.equal(muted.scheduledAt(), -1, 'mute wins over the guarantee');
  phase('settle'); muted.dispose();
});

// ── THE BANK (wave 27, bank-econ): WITHDRAW, the churn rule, the broke-start help, the cashier's way out ───────────
test('bank math (wave 41): the whole deposit is the bank; the withdrawable part leaves out quota credit that never was cash; churn is min(out, back in)', async () => {
  const BK = await load('src/game/bank.ts');
  const i = { debtPaid: 50, granted: 6, due: 31, rate: 0.9, watchPulls: 3, churn: 0 };
  assert.equal(BK.bankBalance(i), 50, 'the surplus above the quota is still in the bank until Dawn');
  assert.equal(BK.withdrawable(i), 44, 'granted quota credit (deposit bonus, phone credit) stays in the bank');
  assert.equal(BK.churnOf(20, 12), 12);
  assert.equal(BK.churnOf(5, 12), 5);
  assert.equal(BK.interestBase(30, 12), 18);
  assert.equal(BK.interestNext({ ...i, debtPaid: 20, granted: 0 }), 18, '20 x 90 %');
  assert.equal(BK.interestNext({ ...i, debtPaid: 20, granted: 0, churn: 20 }), 0, 'coins that went out and back this Watch earn nothing');
  const pv = BK.previewWithdraw({ debtPaid: 40, granted: 0, due: 31, rate: 0.9, watchPulls: 3, churn: 0 }, 15);
  assert.equal(pv.coins, 15);
  assert.equal(pv.bankAfter, 25);
  assert.equal(pv.leftAfter, 6);
  assert.equal(pv.metLost, true, 'the quota was met and would not be');
  assert.equal(pv.interestLost, Math.floor(Math.min(40, 62) * 0.9) - Math.floor(Math.min(25, 62) * 0.9), 'the interest the 15 coins would have earned at the next Bell');
  assert.equal(BK.previewWithdraw({ debtPaid: 5, granted: 5, due: 31, rate: 0.9, watchPulls: 0, churn: 0 }, 99).coins, 0, 'nothing but granted credit: nothing to take');
});

test('Bank: DEPOSIT then WITHDRAW returns the coins, clamps to the bank and the quota drops with them', () => {
  const run = RUN.createRun({ seed: 61, mode: 'debt' });
  run.coins = 40;
  assert.ok(run.deposit(20, true));
  assert.equal(run.bank().balance, 20);
  assert.equal(run.bank().withdrawable, 20);
  assert.equal(run.coins, 20);
  assert.equal(run.withdraw(15), 15, 'takes what was asked');
  assert.equal(run.coins, 35);
  assert.equal(run.quota.deposited, 5, 'withdrawn coins stop counting toward the quota');
  assert.equal(run.withdraw(100), 5, 'a bigger ask is clamped to what the bank holds');
  assert.equal(run.withdraw(1), 0, 'an empty bank gives nothing');
  assert.equal(run.coins, 40, 'every coin is back: nothing was created or lost');
  run.dispose();
});

test('Bank: an overpay stays in the bank: a part withdrawn keeps the quota met, taking past the quota gives it up, and putting it back pays no surplus', () => {
  const run = RUN.createRun({ seed: 62, mode: 'debt' });
  const due = run.quota.due;
  run.coins = 100;
  assert.ok(run.deposit(50, true));
  assert.equal(run.coins, 50, 'the overpay is not paid back at the deposit (decision 2)');
  assert.equal(run.bank().balance, 50, 'the bank holds the whole deposit');
  assert.equal(run.quota.met, true);
  const over = 50 - due;                       // the coins above the quota
  assert.equal(run.withdrawPreview(over).metLost, false, 'taking only the surplus keeps the quota met');
  assert.equal(run.withdrawPreview(over + 1).metLost, true, 'one coin more and the quota is no longer met');
  assert.equal(run.withdraw(over + 1), over + 1);
  assert.equal(run.quota.met, false, 'the quota is no longer met');
  assert.equal(run.quota.deposited, due - 1);
  const surplus = [];
  const off = EV.bus.on('eco:wallet', (e) => { if (e.reason === 'dawn:surplus') surplus.push(e.delta); });
  assert.ok(run.deposit(over + 1, true));
  off();
  assert.equal(surplus.length, 0, 'putting the coins back pays no surplus: Dawn is the only place it returns');
  run.dispose();
});
test('Bank: quota credit that never was cash cannot be withdrawn (no deposit-bonus loop)', () => {
  const run = RUN.createRun({ seed: 63, mode: 'debt' });
  run.coins = 50;
  assert.ok(run.deposit(20, true));
  run.bankGranted = 8;                       // as a deposit.bonus of +8 or a phone credit would book
  run.debtPaid += 8;
  run.syncQuota();
  assert.equal(run.bank().balance, 28);
  assert.equal(run.bank().withdrawable, 20);
  assert.equal(run.withdraw(999), 20);
  assert.equal(run.bank().balance, 8, 'the granted 8 stays counted toward the quota');
  run.dispose();
});

test('Bank: WITHDRAW is open through Closing and Settle (wave 42, decision 2) and shut in Dawn and once the Night is paid', () => {
  const run = RUN.createRun({ seed: 64, mode: 'debt' });
  run.coins = 40;
  assert.ok(run.deposit(20, true));
  run.phase = 'collection';
  assert.equal(run.bank().open, false, 'collection: closed');
  assert.equal(run.withdraw(5), 0);
  for (const ph of ['settle', 'closing', 'bell', 'intermission', 'play', 'lastCall']) {
    run.phase = ph;
    assert.equal(run.bank().open, true, `${ph}: open`);
  }
  run.phase = 'intermission';
  run.nightDone = true;
  assert.equal(run.withdraw(5), 0, 'a paid Night has nothing to take back');
  run.dispose();
});

test('Bank: coins that go out and back in the same Watch earn no interest at the Settle (the churn rule)', () => {
  const settleInterest = (churn) => {
    const run = RUN.createRun({ seed: 65, mode: 'debt' });
    run.coins = 60;
    assert.ok(run.deposit(20, true));
    if (churn) { assert.equal(run.withdraw(20), 20); assert.ok(run.deposit(20, true)); }
    run.watchPulls = 3;
    run.settleWatch();
    const got = run.stats.interest ?? 0;
    run.dispose();
    return got;
  };
  assert.equal(settleInterest(false), 11, 'a plain deposit earns 55 % on Night 1 (wave 42)');
  assert.equal(settleInterest(true), 0, 'the same coins that left and came back this Watch earn nothing');
});

test('Bank: the broke-start help lists the ways out in order: bell, bank, phone, cashier, House loan', () => {
  const run = RUN.createRun({ seed: 66, mode: 'debt' });
  assert.equal(run.brokeHelp(), null, 'a pocket that can play is not broke');
  run.coins = 40;
  assert.ok(run.deposit(20, true));
  run.coins = 0;
  run.phase = 'play';
  run.pullCount = 5;
  run.tickets = 2;
  let ids = run.brokeHelp().steps.map((s) => s.id);
  assert.deepEqual(ids, ['bell', 'bank', 'cashier', 'loan'], 'phone not ringing yet; the Bell is always the first way out while playing');
  run.checkRescue();
  const help = run.brokeHelp();
  ids = help.steps.map((s) => s.id);
  assert.deepEqual(ids, ['bell', 'bank', 'phone', 'cashier', 'loan'], 'the order the prompt prints');
  assert.equal(help.steps[1].coins, 20, 'the bank step says how many coins can come back');
  assert.equal(help.steps[3].coins, 10, 'two Tickets sell for 10 coins on Night 1');
  assert.ok(help.steps[4].quota > 0, 'the loan names its quota price');
  // withdrawing takes the player out of the broke state and hangs up the Collector
  run.withdraw(10);
  assert.equal(run.brokeHelp(), null);
  assert.equal(run.phone(), null, 'the Collector hangs up once the pocket can play');
  run.dispose();
});

test('Bank: with an empty bank and no Tickets the only way out is the loan, and a nothing-left player gets no steps', async () => {
  const RESC = await load('src/game/rescue.ts');
  assert.deepEqual(RESC.brokeSteps({ bank: 0, tickets: 0, ticketCoins: 5, phoneRinging: false }), []);
  const only = RESC.brokeSteps({ bank: 0, tickets: 0, ticketCoins: 5, phoneRinging: false, loan: { coins: 8, quota: 10 } });
  assert.deepEqual(only.map((s) => s.id), ['loan']);
});

test('Cashier: SELL ALL turns every Ticket into coins, BUY +1 PULL costs 3 Tickets, the offers list is five rows', async () => {
  const CR = await load('src/machines/cashier/rules.ts');
  assert.equal(CR.OFFERS.length, 5);
  assert.equal(CR.offersFor('free')[4].op, 'loan', 'the Free Casino keeps its House Credit row');
  assert.equal(CR.offersFor('debt')[4].op, 'buy', 'the Debt run swaps the always-blocked loan for BUY 5');
  assert.equal(CR.OFFERS[0].op, 'sellAll', 'row 1 is the way out of an empty pocket');
  assert.deepEqual(CR.quote(CR.OFFERS[0], 1, 7), { coins: 35, tickets: -7 });
  assert.deepEqual(CR.quote(CR.OFFERS[0], 3, 2), { coins: 30, tickets: -2 }, 'x stake index');
  assert.deepEqual(CR.quote(CR.OFFERS[2], 1, 9), { coins: 0, tickets: -3 });
  const bank = { coin: 4, ticket: 6 };
  const run = {
    mode: 'debt', shift: { phase: 'play', state: () => ({ stake: 1 }) },
    balance: (c) => bank[c], stat() {},
    spend: (c, n) => { if (bank[c] < n) return false; bank[c] -= n; return true; },
    earn: (c, n) => { bank[c] += n; },
    buyPull: () => { bank.ticket -= 3; return true; },
  };
  assert.equal(CR.check(CR.OFFERS[0], run, 1), 'ok');
  assert.ok(CR.apply(CR.OFFERS[0], run, 1, 1));
  assert.deepEqual(bank, { coin: 34, ticket: 0 });
  assert.equal(CR.check(CR.OFFERS[0], run, 1), 'tickets', 'no Tickets left: nothing to sell');
  run.shift.phase = 'intermission';
  bank.ticket = 5;
  assert.equal(CR.check(CR.OFFERS[2], run, 1), 'phase', 'a Pull can only be bought while a Watch runs');
});

test('Debt Terminal keypad: 3 x 3, the top row picks the action, REST turns into PLAY', async () => {
  const R = await load('src/machines/debt_terminal/rules.ts');
  assert.deepEqual([...R.KEYS].slice(0, 3), ['dep', 'wd', 'quota']);
  assert.equal(R.KEYS.length, R.KEY_COLS * R.KEY_ROWS);
  assert.equal(R.modeOfKey('wd'), 'wd');
  assert.equal(R.modeOfKey('p25'), null);
  assert.equal(R.cycleMode('dep'), 'wd');
  assert.equal(R.cycleMode('quota'), 'dep');
  assert.equal(R.cycleMode('dep', -1), 'quota');
  assert.equal(R.playNeed(7, 1, 0), 14, 'seven pulls at two cheapest bets');
  assert.equal(R.playNeed(7, 1, 20), 0, 'a pocket that already covers it needs nothing');
  assert.equal(R.amountFor('dep', 100, 50), 0, 'a top-row key moves no coins');
});

test('float (wave 38): every Watch keeps 2 cheapest bets, fixed for the whole Watch: it does not shrink as the pocket shrinks', async () => {
  const F = await load('src/game/float.ts');
  assert.equal(F.watchFloat(1), 2, 'two 1-coin bets');
  assert.equal(F.watchFloat(40), 80, 'two dear bets');
  assert.equal(F.watchFloat(0), 2, 'never below 2 coins');
  const run = RUN.createRun({ seed: 67, mode: 'debt' });
  run.quota.due = 1_000_000;                  // far above these deposits: no quota met, and a dead pocket does not ring the rescue loan
  run.syncQuota();
  const fl = run.depositFloor();
  assert.equal(fl, F.watchFloat(run.cheapestBet()), 'the run reads the Watch float');
  run.coins = 30;
  assert.equal(run.depositFloor(), fl, 'the float does not move with the pocket');
  assert.equal(run.deposit(30 - fl + 1), false, 'depositing past the float is refused without the confirmed ALL');
  assert.equal(run.coins, 30, 'a refused deposit moves no coins');
  assert.ok(run.deposit(30 - fl));
  assert.equal(run.coins, fl, 'exactly the float is left in the pocket');
  assert.equal(run.depositFloor(), fl, 'a later deposit of the Watch keeps the same float');
  run.coins = 3 * fl;
  assert.equal(run.depositFloor(), fl, 'the float is still the same when the pocket is larger');
  assert.equal(run.deposit(run.coins), false, 'a later deposit may not silently empty the pocket');
  assert.equal(run.deposit(run.coins, true), true, 'a confirmed later deposit goes below the float');
  assert.equal(run.coins, 0);
  run.dispose();
});

test('pulls (wave 38): a pull grant says "+N pulls · reason" on the banner; a loss stays silent', () => {
  const shown = [];
  const run = RUN.createRun({ seed: 68, mode: 'debt', banner: (text) => shown.push(text) });
  run.phase = 'play';                          // a bought pull needs the play phase
  run.tickets = 10;
  assert.equal(run.buyPull(), true);
  assert.ok(shown.some((s) => /\+1 pull\b/.test(s) && /Ticket/i.test(s)), `a bought pull is announced (${shown.join(' | ')})`);
  const n = shown.length;
  run.tickets = 0;
  assert.equal(run.buyPull(), false, 'no Tickets, no pull');
  assert.equal(shown.length, n, 'a refused purchase grants nothing and says nothing');
  run.phase = 'intermission';                  // the Bell: a new Watch starts with its pull allowance
  run.nightDone = false; run.topside = false;
  assert.equal(run.startWatch(), true, 'the Watch starts from the Bell');
  assert.ok(shown.some((s) => /\+\d+ pulls? · new Watch/.test(s)), `the Watch allowance is announced (${shown.join(' | ')})`);
  run.dispose();
});

test('Bell (decision 1): END WATCH ends a playing Watch at once, between Watches it is refused, unused pulls keep the rebate', () => {
  const run = RUN.createRun({ seed: 67, mode: 'debt' });
  assert.equal(run.ringBell(), false, 'no Watch to end between Watches');
  run.phase = 'play'; run.pullCount = 5; run.watchPulls = 3;
  const tickets = run.balance('ticket');
  assert.equal(run.ringBell(), true);
  assert.equal(run.shift.phase, 'closing', 'the Watch is closing, never stuck in play');
  assert.equal(run.ringBell(), false, 'a closing Watch cannot be ended twice');
  run.settleWatch();
  assert.equal(run.balance('ticket') - tickets, 5, 'the 5 unused pulls keep the usual Ticket rebate');
  assert.equal(run.pulls(), 0);
  run.dispose();
  const late = RUN.createRun({ seed: 67, mode: 'debt' });
  late.phase = 'lastCall'; late.pullCount = 2; late.watchPulls = 0;
  assert.equal(late.ringBell(), true, 'Last Call can be ended too');
  late.dispose();
});

test('Bell in the broke card: offered first while playing, never between Watches', async () => {
  const RESC = await load('src/game/rescue.ts');
  assert.deepEqual(RESC.brokeSteps({ bell: true, bank: 0, tickets: 0, ticketCoins: 5, phoneRinging: false }).map((s) => s.id), ['bell']);
  assert.deepEqual(RESC.brokeSteps({ bank: 0, tickets: 0, ticketCoins: 5, phoneRinging: false }), [], 'no Bell step unless the Watch plays');
  const run = RUN.createRun({ seed: 68, mode: 'debt' });
  run.coins = 40;
  assert.ok(run.deposit(20, true));
  run.coins = 0;
  run.phase = 'play'; run.pullCount = 4;
  assert.equal(run.brokeHelp().steps[0].id, 'bell');
  run.phase = 'intermission';
  assert.ok(!(run.brokeHelp()?.steps ?? []).some((s) => s.id === 'bell'), 'between Watches the Bell is not offered');
  run.dispose();
});
