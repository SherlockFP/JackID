// SON OYUN (wave 106, src/game/lastGame.ts): the odds and their parts, and the run flow. Night 8 paid lights the House's machine, a loss
// burns a seal and keeps the run, a win ends it with `last_game`, the last seal lost ends it in THE CHAIR, a reload with a final pull
// rolled ends the run on its first tick, and an Overdrawn run that went back down gets the machine back at its next paid Dawn.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

test('the odds: base, ŞANS stars, run luck and the bonus, clamped', async () => {
  const L = await load('src/game/lastGame.ts');
  const o = (stars, luck, bonusPct) => L.lastGameOdds({ stars, luck, bonusPct });
  assert.deepEqual(o(0, 0, 0), { pct: 5, parts: [{ key: 'base', pct: 5 }], cap: 65 });
  assert.deepEqual(o(5, 10, 3).parts, [{ key: 'base', pct: 5 }, { key: 'stars', pct: 15 }, { key: 'luck', pct: 5 }, { key: 'bonus', pct: 3 }]);
  assert.equal(o(5, 10, 3).pct, 28);
  assert.equal(o(5, 30, 100).pct, 65, 'the cap');
  assert.equal(o(-2, 0, 0).pct, 2, 'the floor');
  assert.equal(o(NaN, 0, 0).pct, 5);
});

describe('the run', () => {
  let RUN, EV;
  before(async () => {
    RUN = await load('src/game/run.ts');
    EV = await load('src/core/events.ts');
    (await load('src/machines/_base/registry.ts')).load();
  });
  const paidDawn = (run) => { run.debtPaid = run.quota.due; run.syncQuota(); run.phase = 'collection'; run.dawn(); };
  const topside = (seed) => { const run = RUN.createRun({ seed, mode: 'debt', home: false }); run.index = 7; paidDawn(run); return run; };
  const ends = () => { const out = []; const off = EV.bus.on('run:end', ({ summary }) => out.push(summary)); return { out, off }; };

  test('Night 8 paid lights the machine; ŞANS stars show in the odds', () => {
    const run = RUN.createRun({ seed: 10601, mode: 'debt', home: false });
    run.index = 7;
    assert.equal(run.lastGameOpen(), false, 'before the Dawn');
    assert.equal(run.playLastGame(), null);
    paidDawn(run);
    assert.equal(run.topsideOpen, true);
    assert.equal(run.lastGameOpen(), true);
    const before = run.lastGameOdds().pct;
    EV.bus.emit('floor:luck', { star: 2, why: 'well' });
    assert.equal(run.lastGameOdds().parts.find((p) => p.key === 'stars')?.pct, run.luckStars() * 3);
    assert.ok(run.lastGameOdds().pct > before);
    run.dispose();
  });

  test('a loss burns one seal and keeps the run; the machine reopens after the reveal', () => {
    const run = topside(10602);
    const seals = run.endingFacts().seals;
    const heard = [];
    const off = EV.bus.on('lastgame:result', (r) => heard.push(r));
    run.rng.chance = () => false;
    const r = run.playLastGame();
    off();
    assert.deepEqual(r, { win: false, pct: r.pct, sealsLeft: seals - 1, final: false });
    assert.deepEqual(heard, [r]);
    assert.equal(run.lastGameOpen(), false, 'the reveal is still up');
    assert.equal(run.playLastGame(), null);
    run.endLastGame();
    run.endLastGame();   // idempotent
    assert.equal(run.over, false);
    assert.equal(run.lastGameOpen(), true);
    run.dispose();
  });

  test('a win ends the run escaped with SON OYUN, once', () => {
    const run = topside(10603);
    const e = ends();
    run.rng.chance = () => true;
    const r = run.playLastGame();
    assert.equal(r.final, true);
    assert.equal(run.over, false, 'the run waits for the reveal');
    run.endLastGame();
    run.endLastGame();
    e.off();
    assert.equal(e.out.length, 1);
    assert.deepEqual([e.out[0].result, e.out[0].ending, e.out[0].endingId], ['escaped', 'last_game', 'last_game']);
    assert.equal(run.endingRecord().id, 'last_game');
    run.dispose();
  });

  test('a loss on the last seal ends the run lost, in THE CHAIR', () => {
    const run = topside(10604);
    run.soulMarkCount = 1;
    const e = ends();
    run.rng.chance = () => false;
    assert.deepEqual(run.playLastGame(), { win: false, pct: run.lastGameOdds().pct, sealsLeft: 0, final: true });
    run.endLastGame();
    e.off();
    assert.deepEqual([e.out[0].result, e.out[0].endingId], ['lost', 'chair']);
    run.dispose();
  });

  test('a reload after a final pull ends the run on its first tick, and cannot roll again', () => {
    const run = topside(10605);
    run.rng.chance = () => true;
    run.playLastGame();
    const snap = JSON.parse(JSON.stringify(run.snapshot()));
    run.dispose();
    const store = { data: { resume: snap, history: [], codex: {} }, update(fn) { fn(this.data); }, flush() {} };
    const back = RUN.resumeRun(store, {});
    assert.equal(back.lastGameOpen(), false, 'no second pull');
    const e = ends();
    back.tick(0.016);
    e.off();
    assert.equal(back.over, true);
    assert.equal(e.out[0]?.ending, 'last_game');
    assert.equal(store.data.resume, null, 'the resume slot is cleared');
    back.dispose();
  });

  test('GO BACK DOWN shuts the machine; the next paid Dawn is a Topside again', () => {
    const run = topside(10606);
    assert.equal(run.goBackDown(), true);
    assert.equal(run.lastGameOpen(), false);
    assert.equal(run.openFloor(), true);
    assert.equal(run.night(), 9);
    paidDawn(run);
    assert.equal(run.over, false);
    assert.equal(run.topsideOpen, true);
    assert.equal(run.lastGameOpen(), true);
    run.dispose();
  });
});
