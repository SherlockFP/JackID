// LOKI's voice in the run (docs/JOKER.md §3, §6, wave J2): a seat at a floor machine gives one tip a Watch and makes it askable, the
// bounty board and the Crooked Table have their own lines, system seats get none, a dare once a Night, a lie call only right after a line,
// Ink feeds Dread, the save keeps him, and the keys and strings exist.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let RUN, REG, EV, KM, J, S, SAVE;
before(async () => {
  RUN = await load('src/game/run.ts');
  REG = await load('src/machines/_base/registry.ts');
  EV = await load('src/core/events.ts');
  KM = await load('src/core/keymap.ts');
  J = await load('src/game/joker/joker.ts');
  S = (await load('src/core/ui/manga/joker.strings.ts')).default;
  SAVE = await load('src/core/save.ts');
  REG.load();
});

const KINDS = ['coinflip', 'bigone', 'bounty_board', 'debt_terminal'];
function floorRun(seed = 41) {
  const run = RUN.createRun({ seed, mode: 'debt' });
  run.attachWorld({ machines: () => KINDS.map((k) => ({ instance: `m-${k}`, machineId: k })), instancePos: () => undefined });
  assert.equal(run.startWatch(), true);
  for (let i = 0; i < 40 && run.shift.phase !== 'play'; i++) run.tick(0.5);
  return run;
}
function heard(names) {
  const got = [];
  const offs = names.map((n) => EV.bus.on(n, (d) => got.push([n, d])));
  return { got, off: () => offs.forEach((o) => o()) };
}
const seat = (run, k, on = true) => EV.bus.emit('player:seat', { pid: run.selfId, mid: `m-${k}`, seat: 0, on });

test('a floor seat: one tip and one dare; the same seat again is quiet this Watch; system seats say nothing', () => {
  const run = floorRun();
  const h = heard(['joker:whisper', 'joker:dare']);
  seat(run, 'debt_terminal');
  assert.equal(h.got.length, 0, 'the Debt Terminal is not his');
  seat(run, 'coinflip');
  assert.deepEqual(h.got.map(([n]) => n), ['joker:whisper', 'joker:dare']);
  assert.equal(h.got[0][1].ctx, 'machine');
  seat(run, 'coinflip', false); seat(run, 'coinflip');
  assert.equal(h.got.length, 3, 'no second tip at that seat this Watch, but the dare stays open until answered');
  run.jokerDare(true);
  seat(run, 'bigone');
  assert.equal(h.got.filter(([n]) => n === 'joker:dare').length, 2, 'answered: no more dares tonight');
  seat(run, 'bounty_board');
  assert.equal(h.got.at(-1)[1].ctx, 'bounty');
  h.off(); run.dispose();
});

test('Ask needs a place (Ink +1 each), the Crooked Table is one, and leaving it closes it', () => {
  const run = floorRun(42);
  assert.equal(run.jokerAsk(), false, 'nothing in front of you');
  run.jokerMoment('crooked', 'm-bigone');
  const ink = run.jokerInk();
  assert.equal(run.jokerAsk(), true);
  assert.equal(run.jokerInk(), ink + 1);
  run.jokerMoment(null);
  assert.equal(run.jokerAsk(), false);
  run.dispose();
});

test('a lie call counts only right after his line; Trust moves at most +1 a Night', () => {
  const run = floorRun(43);
  assert.equal(run.jokerCall(), false, 'he has said nothing');
  seat(run, 'coinflip');
  run.tick(5);
  assert.equal(run.jokerCall(), false, 'too late');
  seat(run, 'bigone');
  assert.equal(run.jokerCall(), true);
  assert.ok(run.jokerSys.trust <= 1);
  run.dispose();
});

test('Ink is a Dread input (4 a point) and the save keeps him', () => {
  assert.equal(J.inkDread(3), 12);
  const run = floorRun(44);
  run.jokerMoment('crooked', 't');
  run.jokerAsk(); run.jokerAsk();
  const snap = JSON.parse(JSON.stringify(run.snapshot()));
  assert.equal(snap.ext.joker.ink, 2);
  const back = RUN.resumeRun({ data: { ...SAVE.defaultSave(), resume: snap }, update(fn) { fn(this.data); }, flush() {} });
  assert.equal(back.jokerInk(), 2);
  assert.deepEqual(back.jokerSys.snapshot(), run.jokerSys.snapshot());
  run.dispose(); back.dispose();
});

test('keys: L and O are free of the Crooked Table call and the seated keys; strings EN and TR, no dashes', () => {
  const extra = KM.EXTRA_BINDINGS;
  assert.deepEqual([extra.jokerAsk, extra.callLiar], [['KeyO'], ['KeyL']]);
  const used = Object.entries(KM.ALL_DEFAULTS).filter(([k]) => k !== 'jokerAsk' && k !== 'callLiar').flatMap(([, v]) => v);
  for (const c of ['KeyO', 'KeyL']) assert.ok(!used.includes(c), c);
  assert.ok(KM.SEATED_WALK_ACTIONS.has('jokerAsk') && KM.SEATED_WALK_ACTIONS.has('callLiar'));
  assert.deepEqual(Object.keys(S.en).sort(), Object.keys(S.tr).sort());
  for (const l of ['en', 'tr']) for (const v of Object.values(S[l])) assert.ok(!/[–—]/.test(v), v);
});
