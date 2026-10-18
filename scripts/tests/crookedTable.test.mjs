// THE CROOKED TABLE (STORY_BIBLE S3, beginner): three tables, one rigged; call, wrong call, ride; tells; save; Tally Sheet lines.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let R, WE, CT, I18N, STR;
before(async () => {
  R = await load('src/core/rng.ts');
  WE = await load('src/game/watchEvents.ts');
  CT = await load('src/game/events/crookedTable.ts');
  I18N = await load('src/core/i18n.ts');
  STR = (await load('src/game/events/crookedTable.strings.ts')).default;
  I18N.registerStrings(STR.prefix, { en: STR.en, tr: STR.tr });
});

const FLOOR = { machines: ['coinflip', 'bigone', 'scratch', 'craps'], spotlight: null, lobby: { x: 0, z: 0 } };
const roll = (seed = 1, floor = FLOOR, intro = false) => CT.rollCrooked(R.createRng(seed).fork('c'), floor, intro);
const makeWE = (floor = FLOOR) => new WE.WatchEvents({ isHot: () => false, touch: () => {}, floor: floor ? () => floor : undefined });

function beginCrooked(we, night = 2) {
  for (let w = 0; w < 6000; w++) {
    const def = we.begin(R.createRng(777).fork(`try.${night}.${w}`), night, w, false);
    if (def && def.id === 'crooked_table') return def;
    we.end();
  }
  throw new Error('crooked_table never rolled');
}

test('roll: three different open machines, one rigged, seeded; fewer than three machines degrades', () => {
  const a = roll(5), b = roll(5);
  assert.deepEqual(a, b, 'seeded');
  assert.equal(a.tables.length, 3);
  assert.equal(new Set(a.tables).size, 3);
  for (const m of a.tables) assert.ok(FLOOR.machines.includes(m));
  assert.ok([0, 1, 2].includes(a.rigged));
  const seen = new Set();
  for (let s = 0; s < 60; s++) seen.add(roll(s).rigged);
  assert.equal(seen.size, 3, 'the rig lands on every table across seeds');
  assert.equal(roll(1, { machines: ['coinflip', 'bigone'] }), null);
  assert.equal(roll(1, { machines: [] }), null);
});

test('night gate and catalogue: Night 2 on, never Night 1', () => {
  const def = WE.WATCH_EVENTS.find((d) => d.id === 'crooked_table');
  assert.equal(def.minNight, 2);
  assert.equal(def.kind, 'crooked');
  for (let w = 0; w < 800; w++) {
    const r = WE.rollWatchEvent(R.createRng(9).fork(`n1.${w}`), 1);
    if (r) assert.notEqual(r.def.id, 'crooked_table');
  }
});

test('rig: only the rigged table pays x1.25 (scoped); none once called', () => {
  const s = roll(3);
  const fx = CT.rigEffects(s);
  assert.equal(fx.length, 1);
  assert.equal(fx[0].hook, 'payout.mult');
  assert.equal(fx[0].value, 1.25);
  assert.deepEqual(fx[0].scope, { machines: [s.tables[s.rigged]] });
  s.called = true;
  assert.deepEqual(CT.rigEffects(s), []);
});

test('ride: every third play at the rigged table is Heat +1; fair tables and other machines never heat', () => {
  const s = roll(4);
  const rig = s.tables[s.rigged], fair = s.tables[(s.rigged + 1) % 3];
  let heat = 0;
  for (let i = 0; i < 9; i++) heat += CT.recordPlay(s, rig, i % 2 === 0, i % 2 ? -5 : 8);
  assert.equal(heat, 3);
  assert.equal(CT.recordPlay(s, fair, true, 3), 0);
  assert.equal(CT.recordPlay(s, 'not-a-table', true, 3), 0);
  assert.equal(s.plays[s.rigged], 9);
  assert.equal(s.lost[s.rigged], 20, 'only net losses count');
});

test('right call: refund x2 of the loss there, capped at 25% of quota; +1 luck, Heat -1', () => {
  const s = roll(6);
  const rig = s.tables[s.rigged];
  for (let i = 0; i < 4; i++) CT.recordPlay(s, rig, false, -10);   // lost 40
  assert.deepEqual(CT.callSums(s, s.rigged, 1000), { refund: 80, fine: 0 }, 'x2 under the cap');
  assert.deepEqual(CT.callSums(s, s.rigged, 200), { refund: 50, fine: 0 }, 'capped at 25% of 200');
  const r = CT.callCheat(s, rig, 1000);
  assert.deepEqual(r, { right: true, table: s.rigged, refund: 80, fine: 0, luck: 1, heat: -1 });
  assert.equal(CT.callCheat(s, rig, 1000), null, 'one call per event');
});

test('wrong call: a fine of 5% of quota (at least 1), Heat +1, no luck, no refund; a non-table is no call', () => {
  const s = roll(7);
  const fair = s.tables[(s.rigged + 2) % 3];
  assert.equal(CT.callCheat(s, 'not-a-table', 500), null);
  assert.equal(s.called, false, 'a stray press costs nothing');
  const r = CT.callCheat(s, fair, 500);
  assert.deepEqual(r, { right: false, table: (s.rigged + 2) % 3, refund: 0, fine: 25, luck: 0, heat: 1 });
  const s2 = roll(7);
  assert.equal(CT.callSums(s2, (s2.rigged + 1) % 3, 5).fine, 1);
});

test('tells: PLATE at once, HABIT after 2 plays, TALLY after 5; the rig and the fair tables read differently', () => {
  const s = roll(8);
  const rig = s.rigged, fair = (s.rigged + 1) % 3;
  assert.deepEqual(CT.tellsAt(s, rig).map((x) => x.channel), ['plate']);
  assert.match(CT.tellsAt(s, rig)[0].key, /^tell\.plate\.rig\.[0-2]$/);
  assert.equal(CT.tellsAt(s, fair)[0].key, 'tell.plate.fair');
  for (let i = 0; i < 2; i++) { CT.recordPlay(s, s.tables[rig], true, 4); CT.recordPlay(s, s.tables[fair], true, 4); }
  assert.deepEqual(CT.tellsAt(s, rig).map((x) => x.channel), ['plate', 'habit']);
  assert.match(CT.tellsAt(s, rig)[1].key, /^tell\.habit\.rig\./);
  assert.equal(CT.tellsAt(s, fair)[1].key, 'tell.habit.fair');
  for (let i = 0; i < 3; i++) { CT.recordPlay(s, s.tables[rig], true, 4); CT.recordPlay(s, s.tables[fair], true, 4); }
  assert.equal(CT.tellsAt(s, rig)[2].key, 'tell.tally.rig');
  assert.equal(CT.tellsAt(s, fair)[2].key, 'tell.tally.fair');
});

test('tally: a table that never paid says cold, not crooked (the rig and a fair table read alike)', () => {
  const s = roll(9);
  const other = s.rigged === 0 ? 1 : 0;
  for (let i = 0; i < 5; i++) { CT.recordPlay(s, s.tables[0], false, -3); CT.recordPlay(s, s.tables[other], false, -3); }
  assert.equal(CT.tellsAt(s, 0)[2].key, 'tell.tally.cold');
  assert.equal(CT.tellsAt(s, other)[2].key, 'tell.tally.cold');
});

test('strings: every key the rules can emit exists in EN and TR; EN and TR keys match', () => {
  for (const lang of ['en', 'tr']) {
    const tb = STR[lang];
    for (const k of ['name', 'desc', 'announce', 'compere', 'hud', 'tamsin.speaker', 'tamsin.1', 'tamsin.2', 'tamsin.3', 'tell.plate.fair', 'tell.habit.fair',
      'tell.tally.rig', 'tell.tally.fair', 'tell.tally.cold', 'note.right', 'note.right0', 'note.wrong', 'note.heatUp', 'note.expired', 'sheet.t', 'sheet.empty',
      'sheet.l.plate', 'sheet.l.habit', 'sheet.l.tally', 'sheet.l.cold', 'sheet.l.right', 'sheet.l.wrong', 'sheet.l.ride']) assert.ok(tb[k], `${lang} ${k}`);
    for (let v = 0; v < CT.VARIANTS; v++) { assert.ok(tb[`tell.plate.rig.${v}`], `${lang} plate ${v}`); assert.ok(tb[`tell.habit.rig.${v}`], `${lang} habit ${v}`); }
  }
  assert.deepEqual(Object.keys(STR.en).sort(), Object.keys(STR.tr).sort(), 'EN and TR keys match');
  const lines = CT.tamsinIntro();
  assert.equal(lines.length, 3);
  assert.ok(lines.every((l) => l.text && !/\{/.test(l.text) && l.lane === 'ambient'));
});

test('in a Watch: tables and tells, play, call; the call ends the event, queues the result, lifts the rig', () => {
  const we = makeWE();
  beginCrooked(we);
  const v = we.crookedView();
  assert.equal(v.tables.length, 3);
  assert.equal(v.intro, true, 'Tamsin explains it the first time');
  const aux = we.snapshot().aux.crooked;
  const rig = aux.tables[aux.rigged];
  assert.equal(we.isCrookedTable(rig), true);
  assert.equal(we.isCrookedTable('nope'), false);
  we.onPull(rig, false, -20);
  we.onPull(rig, false, -20);
  we.onPull(rig, true, 5);
  assert.deepEqual(we.takeCrooked(), [{ kind: 'heat', heat: 1 }], 'the third play heats');
  assert.equal(we.callCheat('nope', 500), null);
  const r = we.callCheat(rig, 500);
  assert.equal(r.right, true);
  assert.equal(r.refund, 80, '2 x 40 lost, under 125');
  assert.equal(we.view(), null, 'the tables close');
  const out = we.takeCrooked();
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'call');
});

test('in a Watch: an uncalled event times out with an expired result; nothing is fined', () => {
  const we = makeWE();
  beginCrooked(we);
  we.tick(CT.CROOKED_S + 1);
  assert.equal(we.view(), null);
  assert.deepEqual(we.takeCrooked(), [{ kind: 'expired', rigPlays: 0 }]);
});

test('Tamsin explains it once: the second time it starts, intro is false; the memory saves', () => {
  const we = makeWE();
  beginCrooked(we);
  assert.equal(we.crookedView().intro, true);
  we.end();
  const snap = we.snapshot();
  assert.equal(snap.crookedSeen, true);
  const we2 = makeWE();
  we2.restore(snap);
  beginCrooked(we2, 4);
  assert.equal(we2.crookedView().intro, false);
});

test('save round trip mid-event keeps the tables, the rig and the counts', () => {
  const we = makeWE();
  beginCrooked(we);
  const a = we.snapshot().aux.crooked;
  const rig = a.tables[a.rigged];
  we.onPull(rig, true, 4);
  const snap = JSON.parse(JSON.stringify(we.snapshot()));
  const we2 = makeWE();
  we2.restore(snap);
  assert.deepEqual(we2.snapshot().aux.crooked, snap.aux.crooked);
  assert.equal(we2.callCheat(rig, 400).right, true);
});

test('degrade: no floor facts, or fewer than three machines, never start the event', () => {
  for (const floor of [null, { machines: [] }, { machines: ['coinflip', 'bigone'] }]) {
    const we = makeWE(floor);
    for (let w = 0; w < 400; w++) {
      const def = we.begin(R.createRng(31).fork(`d.${w}`), 3, w, false);
      if (def) assert.notEqual(def.id, 'crooked_table');
      we.end();
    }
  }
});

test('Tally Sheet lines: the maths and its lessons come from the tells; outcomes teach', () => {
  const s = roll(11);
  const none = CT.sheetFromTells(s.tables.map((_, i) => ({ tells: CT.tellsAt(s, i) })));
  assert.deepEqual(none, [], 'plates and habits stay in the world until a call teaches them');
  for (let i = 0; i < 5; i++) CT.recordPlay(s, s.tables[0], true, 2);
  const lines = CT.sheetFromTells(s.tables.map((_, i) => ({ tells: CT.tellsAt(s, i) })));
  assert.equal(lines[0].key, 'sheet.l.tally');
  assert.ok(lines.some((l) => l.key.startsWith('tell.tally.')));
  assert.deepEqual(CT.sheetFromOutcome({ kind: 'call', right: true }).map((l) => l.key), ['sheet.l.plate', 'sheet.l.habit', 'sheet.l.right']);
  assert.deepEqual(CT.sheetFromOutcome({ kind: 'call', right: false }).map((l) => l.key), ['sheet.l.wrong']);
  assert.deepEqual(CT.sheetFromOutcome({ kind: 'heat', heat: 1 }).map((l) => l.key), ['sheet.l.ride']);
});

test('balance: the fine is 5% of quota, the refund doubles the loss and the cap holds at 25%', () => {
  const s = roll(12);
  assert.equal(CT.callSums(s, (s.rigged + 1) % 3, 400).fine, 20);
  s.lost[s.rigged] = 40;
  assert.equal(CT.callSums(s, s.rigged, 400).refund, 80);
  s.lost[s.rigged] = 400;
  assert.equal(CT.callSums(s, s.rigged, 400).refund, 100, 'the cap holds');
});
