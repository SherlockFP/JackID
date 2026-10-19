// THE NAME SEALS (docs/BLESSINGS.md §1, wave 1): a missed Dawn costs one seal while 2+ remain, the Night counts as paid with no
// offer and -2 luck stars, and the last seal ends the run as before. Each lost seal takes a named memory (the Dawn receipt prints
// it, a restored seal gives it back). HOUSE ENVY and the Hollow Door restore; a duel never takes the last seal; the seals and the
// memories survive a save; the Night 1 HUD strip reads three lit seals.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let RUN, REG, EV, SAVE, K, JM, MEM;
before(async () => {
  RUN = await load('src/game/run.ts');
  REG = await load('src/machines/_base/registry.ts');
  EV = await load('src/core/events.ts');
  SAVE = await load('src/core/save.ts');
  K = await load('src/game/duels/stakes.ts');
  JM = await load('src/menu/hud/juiceMath.ts');
  MEM = await load('src/game/sealMemories.ts');
  REG.load();
});

/** Opens Dawn of Night `night` (1-based) with `bank` coins banked against the quota, then runs it. */
function dawnAt(run, night, bank = 0) {
  run.index = night - 1;
  run.recomputeQuota();
  run.debtPaid = bank;
  run.syncQuota();
  run.phase = 'collection';
  run.dawn();
}

function listen(kind) {
  const seen = [];
  const off = EV.bus.on(kind, (e) => seen.push(e));
  return { seen, off };
}

test('a missed Dawn with 3 seals costs one seal, not the run: paid, no offer, -2 luck stars, a memory on the receipt', () => {
  const sealed = listen('quota:sealed');
  const failed = listen('quota:failed');
  const run = RUN.createRun({ seed: 801, mode: 'debt' });
  assert.equal(run.duel.soulMarks(), K.SOUL_MARKS_PER_RUN);
  dawnAt(run, 1, 0);
  assert.equal(run.over, false, 'the run goes on');
  assert.equal(run.duel.soulMarks(), 2);
  assert.equal(run.nightPaid, true, 'the Night counts as paid');
  assert.equal(run.boonOffer(), null, 'no offer on a sealed Dawn');
  assert.equal(run.luckStars(), -2, 'the same two stars as a fall');
  assert.equal(sealed.seen.length, 1);
  assert.equal(sealed.seen[0].left, 2);
  assert.equal(failed.seen.length, 0, 'quota:failed stays for the fall');
  const r = run.dawnReceipt();
  assert.ok(MEM.isSealMemory(r.memory), 'the receipt names the memory');
  assert.equal(r.seals, 2);
  assert.equal(r.memory, sealed.seen[0].memory);
  assert.equal(run.bank().balance, 0, 'the House kept the (empty) bank; nothing carried');
  sealed.off(); failed.off(); run.dispose();
});

test('two misses are survived with two different memories; the third (the last seal) ends the run as today', () => {
  const failed = listen('quota:failed');
  const falls = listen('player:fall');
  const run = RUN.createRun({ seed: 802, mode: 'debt' });
  dawnAt(run, 1);
  dawnAt(run, 2);
  assert.equal(run.over, false);
  assert.equal(run.duel.soulMarks(), 1);
  assert.equal(new Set(run.lostMemories).size, 2, 'two seals, two different memories');
  dawnAt(run, 3);
  assert.equal(run.over, true, 'the last seal: the run ends');
  assert.equal(failed.seen.length, 1);
  assert.equal(falls.seen.length, 1, 'the trapdoor, only now');
  failed.off(); falls.off(); run.dispose();
});

test('the last Night is never paid with a seal (a miss must not open the Topside door)', () => {
  const run = RUN.createRun({ seed: 803, mode: 'debt' });
  dawnAt(run, 8);
  assert.equal(run.over, true);
  assert.equal(run.duel.soulMarks(), 3, 'no seal was taken');
  run.dispose();
});

test('a paid Dawn takes no seal and prints no memory', () => {
  const run = RUN.createRun({ seed: 804, mode: 'debt' });
  dawnAt(run, 1, 1000);
  assert.equal(run.duel.soulMarks(), 3);
  assert.equal(run.dawnReceipt().memory, undefined);
  run.dispose();
});

test('HOUSE ENVY (4x) restores a seal and gives its memory back; with a full card it pays Obols instead', () => {
  const run = RUN.createRun({ seed: 805, mode: 'debt' });
  const due = run.quota.due;
  for (const id of ['gratuity', 'favoured', 'uncommon', 'golden', 'seal']) run.quota.claimed.push({ id, at: 0 });
  run.soulMarkCount = 1;
  run.lostMemories = ['street', 'song'];
  run.debtPaid = 4 * due;
  run.syncQuota();
  run.phase = 'collection';
  run.dawn();
  assert.equal(run.duel.soulMarks(), 2);
  assert.deepEqual(run.lostMemories, ['street'], 'the song came back');
  run.dispose();
});

test('the Hollow Door restores a seal and its memory, capped at three', () => {
  const run = RUN.createRun({ seed: 806, mode: 'debt' });
  dawnAt(run, 1);
  assert.equal(run.lostMemories.length, 1);
  run.restoreSoulMark();
  assert.equal(run.duel.soulMarks(), 3);
  assert.equal(run.lostMemories.length, 0);
  run.restoreSoulMark();
  assert.equal(run.duel.soulMarks(), 3, 'the card holds three');
  run.dispose();
});

test('a duel never takes the last seal: a stake needs 2+, and a lost Mark takes a memory', () => {
  const run = RUN.createRun({ seed: 807, mode: 'debt' });
  const marks = listen('duel:marks');
  assert.equal(run.duel.stakeSoulMark(), true);            // 3 -> 2 on the card, 1 on the table
  run.duel.loseSoulMark();
  assert.equal(run.duel.soulMarks(), 2);
  assert.equal(run.lostMemories.length, 1, 'the lost Mark took a memory');
  assert.equal(run.duel.stakeSoulMark(), true);            // 2 -> 1 on the card, 1 on the table
  run.duel.loseSoulMark();
  assert.equal(run.duel.soulMarks(), 1);
  assert.equal(run.duel.stakeSoulMark(), false, 'the last seal stays off the table');
  assert.equal(run.duel.soulMarks(), 1);
  assert.equal(marks.seen.at(-1).blank, false, 'never BLANK from a duel');
  assert.equal(run.charmBox.has(run.selfId, 'blank_jackid'), false);
  marks.off(); run.dispose();
});

test('the seals, the memories and the receipt survive a save and a resume', () => {
  const run = RUN.createRun({ seed: 808, mode: 'debt' });
  dawnAt(run, 1);
  const memory = run.dawnReceipt().memory;
  const snap = JSON.parse(JSON.stringify(run.snapshot()));
  assert.equal(snap.ext.soulMarks, 2);
  assert.deepEqual(snap.ext.lostMemories, [memory]);
  const save = { data: { ...SAVE.defaultSave(), resume: snap }, update(fn) { fn(this.data); }, flush() {} };
  const back = RUN.resumeRun(save);
  assert.equal(back.duel.soulMarks(), 2);
  assert.deepEqual(back.lostMemories, [memory]);
  assert.equal(back.dawnReceipt().memory, memory);
  assert.equal(back.dawnReceipt().seals, 2);
  back.restoreSoulMark();
  assert.equal(back.lostMemories.length, 0, 'the resumed run gives the memory back');
  run.dispose(); back.dispose();
});

test('the Night 1 HUD strip shows three lit seals, and a lost seal leaves a ring', () => {
  const run = RUN.createRun({ seed: 809, mode: 'debt' });
  assert.equal(run.night(), 1);
  assert.deepEqual(JM.sealCells(run.duel.soulMarks(), K.SOUL_MARKS_PER_RUN), [true, true, true]);
  dawnAt(run, 1);
  assert.deepEqual(JM.sealCells(run.duel.soulMarks(), K.SOUL_MARKS_PER_RUN), [true, true, false]);
  assert.deepEqual(JM.sealCells(-1, 3), [false, false, false], 'junk clamps');
  assert.deepEqual(JM.sealCells(9, 3), [true, true, true]);
  run.dispose();
});

test('the memories: eight, each with an EN and a TR line for losing and for remembering', async () => {
  const mod = (await load('src/game/run.strings.ts')).default;
  assert.equal(MEM.SEAL_MEMORIES.length, 8);
  for (const id of MEM.SEAL_MEMORIES) {
    for (const k of [`mem.${id}.lost`, `mem.${id}.back`]) {
      assert.ok(mod.en[k] && mod.tr[k], k);
      assert.notEqual(mod.en[k], mod.tr[k], `${k} is translated`);
    }
    assert.match(mod.en[`mem.${id}.lost`], /^Forgotten: /);
    assert.match(mod.tr[`mem.${id}.lost`], /^Unutuldu: /);
  }
  const lost = [];
  for (let i = 0; i < 8; i++) lost.push(MEM.nextMemory(lost, 7, i));
  assert.equal(new Set(lost).size, 8, 'never the same memory twice while it is gone');
  assert.equal(MEM.nextMemory(['street'], 7, 1), MEM.nextMemory(['street'], 7, 1), 'seeded');
});

test('at home a miss with seals left takes the lift, not the doom; the last seal still ends in the Collector\'s visit', () => {
  const run = RUN.createRun({ seed: 810, mode: 'debt', home: true });
  assert.equal(run.homeOn, true);
  dawnAt(run, 1);
  assert.equal(run.homeStage(), null, 'no doomed ride');
  assert.equal(run.homeLiftReady(), true, 'the lever is the lift');
  run.soulMarkCount = 1;
  dawnAt(run, 2);
  assert.equal(run.homeStage(), 'doomed');
  run.dispose();
});
