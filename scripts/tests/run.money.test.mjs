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
