// THE PANTHEON in the run (docs/BLESSINGS.md §6, wave B): the first offer at the Night 1 Dawn, a boon kept for the run, the overpay
// tier shaping the offer, Loki's Ink (the swap and his boons), the boons that act at once (First Penny, Your Name Back), Noticed, Cooked
// Books, the Night 2 beat at the bar, and an old save with a Night Card, a Starter Draft and an overpay pick loading clean.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let RUN, REG, EV, SAVE;
before(async () => {
  RUN = await load('src/game/run.ts');
  REG = await load('src/machines/_base/registry.ts');
  EV = await load('src/core/events.ts');
  SAVE = await load('src/core/save.ts');
  REG.load();
});

/** Opens Dawn of Night `night` (1-based) with `bank` coins banked against the quota, then runs it. */
function dawnAt(run, night, bank) {
  run.index = night - 1;
  run.recomputeQuota();
  run.debtPaid = bank ?? run.quota.due;
  run.syncQuota();
  run.phase = 'collection';
  run.dawn();
}

test('a paid Night 1 Dawn opens three cards from three gods; a pick is kept for the run and the offer closes', () => {
  const run = RUN.createRun({ seed: 901, mode: 'debt' });
  const seen = [];
  const off = EV.bus.on('run:boon', (e) => seen.push(e.state));
  dawnAt(run, 1);
  const o = run.boonOffer();
  assert.equal(o.candidates.length, 3);
  assert.equal(new Set(o.candidates.map((c) => c.god)).size, 3);
  const id = o.candidates[1].id;
  assert.equal(run.pickBoon(id), true);
  assert.equal(run.boonOffer(), null);
  assert.deepEqual(run.boons(), [id]);
  assert.deepEqual(seen, ['offer', 'picked']);
  assert.equal(run.swapBoon(0), false, 'no swap without an offer');
  off(); run.dispose();
});

test('the offer timer stands still while the panel holds it', () => {
  const run = RUN.createRun({ seed: 903, mode: 'debt' });
  dawnAt(run, 1);
  const left = run.boonOffer().left;
  run.holdBoonTimer(true);
  run.pantheon.tick(5);
  assert.equal(run.boonOffer().left, left);
  run.holdBoonTimer(false);
  run.pantheon.tick(5);
  assert.equal(run.boonOffer().left, left - 5);
  run.dispose();
});

test('Loki swaps one card from Night 3 for 1 Ink; his boons cost Ink once, never past his cap, and no Dread', () => {
  const run = RUN.createRun({ seed: 902, mode: 'debt' });
  dawnAt(run, 3);
  assert.equal(run.boonOffer().canSwap, true);
  assert.equal(run.swapBoon(1), true);
  assert.equal(run.jokerInk(), 1, 'the swap is 1 Ink');
  const loki = run.boonOffer().candidates[1];
  assert.equal(loki.god, 'loki');
  assert.equal(run.swapBoon(0), false, 'once an offer');
  assert.equal(run.pickBoon(loki.id), true);
  assert.equal(run.jokerInk(), 1 + (loki.ink ?? 0), 'a Loki boon pays its Ink when kept');
  run.phase = 'play';
  assert.equal(run.mod('dread.add', 'bigone', 0), 0, 'no Dread from Loki any more');
  run.dispose();
  const cap = RUN.createRun({ seed: 904, mode: 'debt' });
  dawnAt(cap, 3);
  cap.pantheon.restore({ offer: { night: 3, ids: ['loki_grin', 'well_soft'], picks: 1, left: 20, swapped: true } });
  cap.jokerSys.ink = 7;
  assert.equal(cap.pickBoon('loki_grin'), false, 'Ink 7 + 3 would bring him home: refused');
  assert.equal(cap.pickBoon('well_soft'), true);
  assert.equal(cap.jokerInk(), 7);
  cap.dispose();
});

test('First Penny gives its star at once; Your Name Back puts a seal back and is spent', () => {
  const run = RUN.createRun({ seed: 903, mode: 'debt' });
  dawnAt(run, 1);
  run.pantheon.restore({ offer: { night: 1, ids: ['well_penny', 'mir_name'], picks: 2, left: 20, swapped: false } });
  const stars = run.luckStars();
  run.soulMarkCount = 2;
  assert.equal(run.pickBoon('well_penny'), true);
  assert.equal(run.luckStars(), stars + 1);
  assert.ok(Math.abs(run.mod('payout.mult', 'bigone', 1) - (1 + 0.015 * run.luckStars())) < 1e-9, 'each star now pays 1.5 %');
  assert.equal(run.pickBoon('mir_name'), true);
  assert.equal(run.duel.soulMarks(), 3);
  assert.equal(run.pantheon.fx('sealAdd'), 0, 'the Rite is spent');
  run.dispose();
});

test('Noticed (1.25x) gives +1 Favour to the god of the last boon; Cooked Books drops the wealth floor once', () => {
  const run = RUN.createRun({ seed: 904, mode: 'debt' });
  run.pantheon.restore({ kept: ['ash_minute', 'ledg_books'] });
  run.quota.claimed.push({ id: 'gratuity', at: 0 });
  const before = run.boonFavour('ledgers');
  dawnAt(run, 1, Math.ceil(run.quota.due * 1.3));
  assert.equal(run.boonFavour('ledgers'), before + 1);
  run.houseWealth = 1e9;               // a wealth that would floor the next quota
  run.settleBoons();
  run.beginNight();
  assert.equal(run.houseWealth, 0, 'Cooked Books: no wealth floor tonight');
  assert.equal(run.pantheon.has('ledg_books'), false, 'and it is spent');
  run.dispose();
});

test('Night 2: the first Mola has Selim and Loki name the gods at the bar, once', () => {
  const run = RUN.createRun({ seed: 905, mode: 'debt' });
  const said = [];
  const off = EV.bus.on('floor:say', (e) => said.push(e.source));
  run.index = 1;
  run.watch = 0;
  run.watches = 4;
  run.afterSettle();
  run.afterSettle();
  assert.deepEqual(said, ['pantheon.beat.1', 'pantheon.beat.2', 'pantheon.beat.3']);
  off(); run.dispose();
});

test('an old save with a kept Night Card, an open Starter Draft and an overpay pick loads clean, with none of them', () => {
  const run = RUN.createRun({ seed: 906, mode: 'debt' });
  const snap = JSON.parse(JSON.stringify(run.snapshot()));
  snap.ext.nightCards = { offer: { night: 2, ids: ['rush_night', 'double_down'], left: 9 }, kept: { night: 1, id: 'grace' }, offered: 2 };
  snap.ext.starter = { ids: ['brass_thimble'], open: true, left: 12 };
  snap.ext.overpays = [{ rarity: 'rare', ids: ['sun_dial'], left: 30 }];
  snap.ext.ropeUsed = true;
  const store = { data: { ...SAVE.defaultSave(), resume: snap }, update(fn) { fn(this.data); }, flush() {} };
  const back = RUN.resumeRun(store, {});
  assert.ok(back, 'the save resumes');
  assert.equal(back.boonOffer(), null);
  assert.deepEqual(back.boons(), []);
  assert.equal(back.startWatch(), true, 'nothing holds the Bell');
  const out = back.snapshot().ext;
  assert.equal(out.nightCards, undefined);
  assert.equal(out.starter, undefined);
  assert.equal(out.overpays, undefined);
  back.dispose(); run.dispose();
});

test('the boon offer survives a save and a resume', () => {
  const run = RUN.createRun({ seed: 907, mode: 'debt' });
  dawnAt(run, 1);
  const ids = run.boonOffer().candidates.map((c) => c.id);
  const snap = JSON.parse(JSON.stringify(run.snapshot()));
  const back = RUN.resumeRun({ data: { ...SAVE.defaultSave(), resume: snap }, update(fn) { fn(this.data); }, flush() {} }, {});
  assert.deepEqual(back.boonOffer().candidates.map((c) => c.id), ids);
  back.dispose(); run.dispose();
});
