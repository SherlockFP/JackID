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

test('quota met: the deposit that covers it returns the surplus to the pocket at once, not at Dawn', () => {
  const run = RUN.createRun({ seed: 45, mode: 'debt' });
  const due = run.quota.due;
  run.debtPaid = due - 100;
  run.syncQuota();
  run.coins = 1000;
  assert.ok(run.deposit(300, true), 'the deposit is accepted');
  assert.equal(run.coins, 1000 - 300 + 200, 'the 200 above the quota is back in the pocket straight away');
  assert.equal(run.debtPaid, due + 200, 'the terminal still counts the whole deposit');
  assert.equal(run.quota.deposited, due + 200);
  assert.equal(run.quota.overshoot, 200, 'overshoot (and so the tiers) read the total, not the held part');
  assert.ok(run.quota.met);
  run.dispose();
});

test('quota met: later overpays are released as they land, and Dawn returns only what was not released', () => {
  const run = RUN.createRun({ seed: 46, mode: 'debt' });
  const due = run.quota.due;
  run.debtPaid = due;
  run.syncQuota();
  run.coins = 500;
  run.deposit(120, true);
  run.deposit(80, true);
  assert.equal(run.coins, 500 - 120 - 80 + 200, 'every overpay goes back at once');
  const before = run.coins;
  run.dawn();
  assert.equal(run.coins, before, 'nothing is paid twice at Dawn');
  assert.equal(run.debtPaid, 0, 'the next quota starts from zero deposited');
  run.dispose();
});

test('quota met: interest booked at Settle is on the whole deposit, and its surplus goes back too', () => {
  const run = RUN.createRun({ seed: 47, mode: 'debt' });
  const due = run.quota.due;
  run.debtPaid = due;
  run.syncQuota();
  run.coins = 500;
  run.deposit(100, true);
  const released = run.released;
  assert.equal(released, 100);
  const deposited = run.debtPaid;
  run.debtPaid += 30;                         // the interest settleWatch books (on the total deposit)
  run.releaseSurplus();
  assert.equal(run.debtPaid, deposited + 30, 'the total keeps the interest');
  assert.equal(run.released, released + 30, 'the interest above the quota is released as well');
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

test('float: the run refuses a first deposit that empties the pocket, accepts the rest, and a confirmed ALL goes through', () => {
  const run = RUN.createRun({ seed: 51, mode: 'debt' });
  run.quota.due = 1_000_000;                  // far above these deposits: the quota is not met, so no surplus comes back here
  run.syncQuota();
  run.coins = 100;
  run.watchDeposits = 0;
  const floor = run.depositFloor();
  assert.ok(floor > 0 && floor < 100, `a float is kept (${floor})`);
  assert.equal(run.deposit(100), false, 'the first deposit may not take the pocket below the float');
  assert.equal(run.coins, 100, 'a refused deposit moves no coins');
  assert.equal(run.deposit(100 - floor), true, 'the room above the float is deposited');
  assert.equal(run.coins, floor);
  assert.equal(run.depositFloor(), 0, 'the float applies to the first deposit only');
  assert.equal(run.deposit(floor), true, 'a later deposit may take the rest');
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
