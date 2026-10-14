// Money flow: the Dawn surplus returns to the pocket, the WIN callout preview equals what win() credits, the Night 1 bet
// limits are the real run limits, and the tutorial's spin step teaches rotation.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let RUN, REG, ECO, TUT;
before(async () => {
  RUN = await load('src/game/run.ts');
  REG = await load('src/machines/_base/registry.ts');
  ECO = await load('src/game/economy.ts');
  TUT = await load('src/game/tutorial.strings.ts');
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
