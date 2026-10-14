// Wave 25 integrator tests (run.ts hooks for the Tally Bench): Soul Marks (stake, return, lose, BLANK at 0, save round trip),
// the rival's Pledge charm, the Night encounters per table, the boss duel rewards (BOSS_REWARD + a Wing Key, once), the
// Audit tax, the Parlour opening for Lucan, the duel i18n parity and the placement of the three tables.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let RUN, SAVE, K, LAYOUT, RIV, BUS, SUITS;
before(async () => {
  RUN = await load('src/game/run.ts');
  SAVE = await load('src/core/save.ts');
  K = await load('src/game/duels/stakes.ts');
  LAYOUT = await load('src/world/layout.ts');
  RIV = await load('src/game/story/duels/rivals.ts');
  BUS = await load('src/core/events.ts');
  SUITS = await load('src/game/suits.ts');
});

const fresh = (seed = 31, night = 1) => {
  const run = RUN.createRun({ seed, mode: 'debt' });
  run.index = night - 1;
  run.recomputeQuota();
  return run;
};

test('a new run holds 3 Soul Marks; staking takes one off the card, winning or drawing returns it', () => {
  const run = fresh();
  assert.equal(run.duel.soulMarks(), K.SOUL_MARKS_PER_RUN);
  assert.equal(run.duel.stakeSoulMark(), true);
  assert.equal(run.duel.soulMarks(), 2);
  run.duel.returnSoulMark();
  assert.equal(run.duel.soulMarks(), 3);
  run.duel.returnSoulMark();                                   // nothing is on the table: no mark from thin air
  assert.equal(run.duel.soulMarks(), 3);
  run.dispose();
});

test('a lost Mark stays lost; the third one makes the JackID BLANK (the cursed charm), a Mark in play never does', () => {
  const run = fresh(32);
  const seen = [];
  const off = BUS.bus.on('duel:marks', (e) => seen.push(e));
  for (let i = 0; i < 2; i++) { assert.ok(run.duel.stakeSoulMark()); run.duel.loseSoulMark(); }
  assert.equal(run.duel.soulMarks(), 1);
  assert.equal(run.charmBox.has(run.selfId, 'blank_jackid'), false, 'one Mark left: the card is not blank');
  assert.ok(run.duel.stakeSoulMark());                          // the last Mark is on the table
  assert.equal(run.charmBox.has(run.selfId, 'blank_jackid'), false, 'a Mark in play is not a lost Mark');
  run.duel.loseSoulMark();
  assert.equal(run.duel.soulMarks(), 0);
  assert.equal(run.charmBox.has(run.selfId, 'blank_jackid'), true, 'BLANK at 0 Marks');
  assert.equal(run.duel.stakeSoulMark(), false, 'no Mark left to put up');
  assert.equal(seen.at(-1).blank, true);
  assert.equal(seen.filter((e) => e.lost).length, 3);
  off(); run.dispose();
});

test('BLANK still lands when the charm board is full', () => {
  const run = fresh(33);
  for (const id of ['mirror_shoe', 'brass_knuckles', 'hollow_dice', 'sun_dial', 'long_shot']) run.grantCharm(id);
  for (let i = 0; i < 3; i++) { assert.ok(run.duel.stakeSoulMark()); run.duel.loseSoulMark(); }
  assert.equal(run.charmBox.has(run.selfId, 'blank_jackid'), true);
  run.dispose();
});

test('Soul Marks (and the Mark on the table) survive a snapshot and a resume; a Mark left on the table returns at Dawn', () => {
  const run = fresh(34, 2);
  assert.ok(run.duel.stakeSoulMark()); run.duel.loseSoulMark();
  assert.ok(run.duel.stakeSoulMark());
  const snap = JSON.parse(JSON.stringify(run.snapshot()));
  assert.equal(snap.ext.soulMarks, 1);
  assert.equal(snap.ext.markEscrow, 1);
  const save = { data: { ...SAVE.defaultSave(), resume: snap }, update(fn) { fn(this.data); }, flush() {} };
  const back = RUN.resumeRun(save);
  assert.equal(back.duel.soulMarks(), 1);
  back.debtPaid = back.quota.due; back.dawn();
  assert.equal(back.duel.soulMarks(), 2, 'the unresolved Mark came home at Dawn');
  run.dispose(); back.dispose();
});

test('Calm mode and Free mode allow only the Coins tier', () => {
  const run = fresh(35);
  assert.equal(run.duel.coinsOnly(), false);
  run.dispose();
  const free = RUN.createRun({ seed: 36, mode: 'free' });
  assert.equal(free.duel.coinsOnly(), true);
  free.dispose();
  const save = { data: { ...SAVE.defaultSave(), settings: { ...SAVE.defaultSave().settings, calm: true } }, update(fn) { fn(this.data); }, flush() {} };
  const calm = RUN.createRun({ seed: 37, mode: 'debt', save });
  assert.equal(calm.duel.coinsOnly(), true);
  calm.dispose();
});

test('the rival\'s Pledge: the themed Rare charm once per rival, an Obol after that', () => {
  const run = fresh(38);
  run.duel.grantPledge('tamsin');
  assert.equal(run.charmBox.has(run.selfId, 'mirror_shoe'), true);
  const o = run.balance('obol');
  run.duel.grantPledge('tamsin');
  assert.equal(run.balance('obol'), o + 1, 'second win: an Obol instead');
  run.duel.grantPledge('lucan');
  assert.equal(run.charmBox.has(run.selfId, 'ringmasters_whistle'), true);
  run.dispose();
});

test('each table seats its rival: Lucan in the Parlour (the boss on Night 3 only), Tamsin in the Jade Room, Kuro in the Boiler', () => {
  const n3 = fresh(39, 3);
  assert.deepEqual(n3.duel.encounter('PAR-05'), { rivalId: 'lucan', night: 3, boss: true });
  assert.equal(n3.duel.encounter('CARD-08').rivalId, 'tamsin');
  assert.equal(n3.duel.encounter('BOI-07').rivalId, 'kuro');
  assert.equal(n3.duel.encounter('WELL-01'), null);
  n3.dispose();
  const n4 = fresh(39, 4);
  assert.equal(n4.duel.encounter('PAR-05').boss, false);
  n4.dispose();
});

test('phase 2 tables: Orrin boss on Night 6 in the Parlour, Mimosa in the Wash, Vell boss on Night 8 in the Counting Room', () => {
  const n6 = fresh(44, 6);
  assert.deepEqual(n6.duel.encounter('PAR-05'), { rivalId: 'orrin', night: 6, boss: true });
  n6.dispose();
  const n4 = fresh(44, 4);
  assert.deepEqual(n4.duel.encounter('LAU-10'), { rivalId: 'mimosa', night: 4, boss: false });
  assert.equal(n4.duel.encounter('PAR-05').rivalId, 'lucan');
  n4.dispose();
  const n8 = fresh(44, 8);
  assert.deepEqual(n8.duel.encounter('CNT-03'), { rivalId: 'vell', night: 8, boss: true });
  n8.openFloor?.();
  n8.prepareBoss();
  assert.equal(n8.tycoon.state().zones.includes('counting'), true, 'the Counting Room opens for the Night 8 boss duel');
  n8.dispose();
  assert.equal(LAYOUT.DEFAULT_ASSIGN['LAU-10'], 'tallytable');
  assert.equal(LAYOUT.DEFAULT_ASSIGN['CNT-03'], 'tallytable');
  assert.equal(LAYOUT.SLOTS.find((x) => x.id === 'CNT-03').zone, 'counting');
});

test("Vell's thrown match, called out, sets the vell_release ending path (saved); an uncalled duel does not", () => {
  const run = fresh(45, 8);
  const rep = { rivalId: 'vell', gameId: 'lastcount', night: 8, boss: true, tier: 'coins', S: 30, won: true, drew: false, net: 30, calledCorrect: false };
  run.duel.onDuelEnd(rep);
  assert.equal(run.endingPath, null, 'uncalled: a normal win');
  run.duel.onDuelEnd({ ...rep, calledCorrect: true });
  assert.equal(run.endingPath, 'vell_release');
  run.dispose();
});

test('beating the Night 3 boss at the table pays BOSS_REWARD and a Wing Key, once', () => {
  const run = fresh(40, 3);
  const t0 = run.balance('ticket');
  const report = { rivalId: 'lucan', gameId: 'ghostshell', night: 3, boss: true, tier: 'coins', S: 30, won: true, drew: false, net: 30, calledCorrect: true };
  run.duel.onDuelEnd(report);
  assert.equal(run.wingKeys, 1, 'a Wing Key at once');
  for (let i = 0; i < 6; i++) run.tick(1);                          // the reward waits a beat for the reveal to clear
  assert.equal(run.balance('ticket') - t0, 3, 'BOSS_REWARD Tickets');
  assert.ok(run.overpayOffer(), 'and the Rare charm choice (1 of 3)');
  run.duel.onDuelEnd(report);                                        // a second report for the same Night pays nothing more
  assert.equal(run.wingKeys, 1);
  run.dispose();
  const lost = fresh(41, 3);
  lost.duel.onDuelEnd({ ...report, won: false, net: -30, calledCorrect: null });
  for (let i = 0; i < 6; i++) lost.tick(1);
  assert.equal(lost.wingKeys, 0);
  assert.equal(lost.overpayOffer(), null);
  lost.dispose();
});

test('Night 7, the Audit: the Clerk takes a fifth of a coin prize', () => {
  const run = fresh(42, 7);
  run.earn('coin', 1000, 't');
  const before = run.wallet();
  run.duel.onDuelEnd({ rivalId: 'tamsin', gameId: 'sealedwall', night: 7, boss: false, tier: 'coins', S: 50, won: true, drew: false, net: 100, calledCorrect: null });
  assert.equal(before - run.wallet(), 20);
  const o = run.wallet();
  run.duel.onDuelEnd({ rivalId: 'tamsin', gameId: 'sealedwall', night: 7, boss: false, tier: 'pledge', S: 50, won: true, drew: false, net: 100, calledCorrect: null });
  assert.equal(run.wallet(), o, 'no tax on a Pledge prize');
  run.dispose();
});

test('the Parlour opens when Night 3 starts, so the boss duel is never behind a closed grille', () => {
  const run = RUN.createRun({ seed: 43, mode: 'debt' });
  assert.equal(run.tycoon.state().zones.includes('parlour'), false);
  run.index = 2; run.recomputeQuota();
  run.openFloor?.();
  run.prepareBoss();
  assert.equal(run.tycoon.state().zones.includes('parlour'), true);
  run.dispose();
});

test('the three duel tables are placed and tallytable is a suit-less story device', () => {
  const at = (id) => LAYOUT.DEFAULT_ASSIGN[id];
  assert.equal(at('PAR-05'), 'tallytable');
  assert.equal(at('CARD-08'), 'tallytable');
  assert.equal(at('BOI-07'), 'tallytable');
  const slot = (id) => LAYOUT.SLOTS.find((s) => s.id === id);
  assert.equal(slot('PAR-05').zone, 'parlour');
  assert.equal(slot('CARD-08').zone, 'cards');
  assert.equal(slot('BOI-07').zone, 'boiler');
  assert.equal(SUITS.suitOf('tallytable'), null);
  assert.ok(SUITS.NO_SUIT.has('tallytable'));
  assert.equal(RIV.bossRivalFor(3)?.id, 'lucan');
});

test('the run-side duel strings have EN and TR parity', async () => {
  const mod = (await load('src/game/duels/duelrun.strings.ts')).default;
  assert.deepEqual(Object.keys(mod.en).sort(), Object.keys(mod.tr).sort());
  const ph = (s) => (s.match(/\{\w+\}/g) ?? []).sort().join();
  for (const k of Object.keys(mod.en)) assert.equal(ph(mod.en[k]), ph(mod.tr[k]), k);
});
