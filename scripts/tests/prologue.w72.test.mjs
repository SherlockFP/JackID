// THE PROLOGUE (wave 72): a fresh solo Debt Run starts in the apartment. The run holds the clock (no Watch, no draft, no lever) until
// the lift lands (`finishPrologue`), a resumed save skips it, the Starter Draft opens only in the Night 1 Mola (after the first Watch),
// and the Evening's knock fixes hold: a bed before the visitor fails the visit (Heat, toll), and a verdict's save records 'leave'.
// The scene itself (story/cutscenes/prologue.cutscene.ts) and its strings are checked for their keys in EN and TR.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let RUN, REG, EV, SAVE, K, EVE, STORY_STR, EVE_STR, CUT, KNOCK_STR;
before(async () => {
  RUN = await load('src/game/run.ts');
  REG = await load('src/machines/_base/registry.ts');
  EV = await load('src/core/events.ts');
  SAVE = await load('src/core/save.ts');
  K = await load('src/game/home/knock.ts');
  EVE = await load('src/game/home/evening.ts');
  STORY_STR = (await load('src/game/story/cutscenes/story.cut.strings.ts')).default;
  EVE_STR = (await load('src/game/home/evening.strings.ts')).default;
  KNOCK_STR = (await load('src/game/home/knock.strings.ts')).default;
  CUT = (await load('src/game/story/cutscenes/prologue.cutscene.ts')).default;
  REG.load();
});

const home = (seed) => RUN.createRun({ seed, mode: 'debt', home: true, prologue: true });

/** Advances the run by `sec` sim seconds in `step` slices (stops early when the run is over). */
function walk(run, sec, step = 0.25) {
  for (let t = 0; t < sec && !run.over; t += step) run.tick(step);
}

/** A save store in memory, with a resume slice taken from the run (as home.flow.test.mjs does). */
function storeOf(run) {
  const snap = JSON.parse(JSON.stringify(run.snapshot()));
  return { data: { ...SAVE.defaultSave(), resume: snap }, update(fn) { fn(this.data); }, flush() {} };
}

/** Collects the bus events of a kind (the returned list fills as the test runs; call the disposer when done). */
function listen(kind) {
  const got = [];
  const off = EV.bus.on(kind, (e) => got.push(e));
  return { got, off };
}

test('a fresh Home-layer run is in its prologue: no Watch, no lever, no draft until the lift lands', () => {
  const run = home(7301);
  assert.equal(run.prologueOn(), true, 'a fresh solo run starts in the prologue');
  assert.equal(run.startWatch(), false, 'the prologue holds the clock: no Watch yet');
  assert.equal(run.openFloor(), false, 'the lever does nothing in the prologue');
  assert.equal(run.openStarterDraft(), false, 'no starter draft in the prologue');
  walk(run, 30);
  assert.equal(run.phase, 'intermission', 'the clock does not run in the prologue');
  assert.equal(run.starterDraft(), null);
});

test('finishPrologue opens Night 1 Watch 1 once, and announces it on home:prologue', () => {
  const run = home(7302);
  const ev = listen('home:prologue');
  assert.equal(run.finishPrologue(), true);
  assert.equal(run.prologueOn(), false);
  assert.equal(run.finishPrologue(), false, 'the second call is a no-op');
  assert.equal(ev.got.length, 1);
  assert.equal(ev.got[0].state, 'done');
  ev.off();
  assert.equal(run.phase, 'bell', 'Watch 1 is open on the floor (its Bell phase) as the lift lands');
  assert.equal(run.startWatch(), false, 'and it is not opened twice');
  assert.equal(run.index, 0, 'still Night 1');
});

test('a resumed save skips the prologue (no scene, no hold on the clock)', () => {
  const run = home(7303);
  const store = storeOf(run);
  const back = RUN.resumeRun(store, { home: true });
  assert.ok(back, 'the save resumes');
  assert.equal(back.prologueOn(), false, 'a resumed run is not in its prologue');
});

test('the Starter Draft opens only in the Night 1 Mola, after the first Watch, never before the first Bell', () => {
  const run = home(7304);
  run.finishPrologue();
  assert.equal(run.openStarterDraft(), false, 'not on the first frame of Watch 1');
  assert.equal(run.phase, 'bell', 'the lift landed: Watch 1 is in its Bell');
  assert.equal(run.openStarterDraft(), false, 'not during the Bell or the first play');
  // run the first Watch out (the clock ends it) and the settle: the Mola follows
  for (let i = 0; i < 2400 && !(run.phase === 'intermission' && run.watch >= 1) && !run.over; i++) walk(run, 0.5, 0.25);
  assert.equal(run.phase, 'intermission', 'the first Watch has ended');
  assert.ok(run.watch >= 1, 'the Mola is after the first Watch');
  assert.equal(run.openStarterDraft(), true, 'the Mola opens the starter draft (the UI shows it once the Mola is quiet)');
  assert.equal(run.openStarterDraft(), false, 'it opens once');
  assert.equal(run.starterDraft()?.candidates.length, 3);
  assert.equal(run.pickStarter(run.starterDraft().candidates[0].id), true);
  assert.equal(run.startWatch(), true, 'the next Watch starts once the card is taken');
});

test('the bed cannot dodge a planned visit: asleep before the visitor fails the visit (Heat and toll apply)', () => {
  const log = [];
  const io = {
    footstep() {}, shadow() {}, knock() {}, shove() {}, chainRattle() {}, scrape() {}, crack() {}, caption() {},
    resolve: (r) => log.push(r),
  };
  const st = K.newVisit(2, { kind: 'listener', at: 20 }, false);
  const v = K.createVisit(st, io);
  v.tick(3, { lights: true, chain: false, moved: false, looking: false });   // still planned (wait)
  assert.equal(st.phase, 'wait');
  v.abandon();   // the auto-sleep or the bed
  assert.equal(log.length, 1, 'the planned visit resolves once');
  assert.equal(log[0].pass, false, 'and it is a fail');
  assert.equal(log[0].kind, 'listener');
  assert.equal(st.phase, 'done');
});

test('the verdict is recorded before it is applied: a save inside the resolve sees phase "leave"', () => {
  const seen = [];
  const st = K.newVisit(2, { kind: 'listener', at: 0 }, false);
  let v;
  const io = {
    footstep() {}, shadow() {}, knock() {}, shove() {}, chainRattle() {}, scrape() {}, crack() {}, caption() {},
    resolve: () => seen.push(st.phase),
  };
  v = K.createVisit(st, io);
  st.phase = 'act';   // a visitor caught at the door (the act), as the knock state machine leaves it
  st.kind = 'listener';
  for (let i = 0; i < 200 && st.phase !== 'done'; i++) v.tick(0.5, { lights: true, chain: false, moved: true, looking: false });
  assert.deepEqual(seen, ['leave'], 'the save written at the verdict records leave');
});

test('a visit saved after its verdict is not resolved again on restore', () => {
  const log = [];
  const io = {
    footstep() {}, shadow() {}, knock() {}, shove() {}, chainRattle() {}, scrape() {}, crack() {}, caption() {},
    resolve: (r) => log.push(r),
  };
  const saved = K.readVisit(JSON.parse(JSON.stringify({ ...K.newVisit(2, { kind: 'picker', at: 0 }, false), phase: 'leave', pass: true })));
  assert.ok(saved, 'the saved visit reads back');
  const v = K.createVisit(saved, io);
  v.resume();
  assert.equal(log.length, 0, 'a verdict already saved is not applied twice');
  assert.equal(saved.phase, 'done');
});

test('the prologue scene: the scene id matches the Evening, and every subtitle key exists in EN and TR', () => {
  assert.equal(EVE.PROLOGUE_CUT, CUT.id);
  assert.equal(CUT.id, 'prologue');
  assert.ok(CUT.duration <= 40, 'the prologue is under the 40 s budget');
  const keys = CUT.tracks.filter((t) => t.kind === 'subtitle').flatMap((t) => t.cues.map((c) => c.key));
  assert.ok(keys.length >= 4, 'the spouse speaks twice and the Collector calls');
  for (const k of keys) {
    const bare = k.replace(/^story\./, '');
    assert.ok(bare in STORY_STR.en || k.startsWith('evening.'), `${k} in EN`);
    if (k.startsWith('story.')) assert.ok(bare in STORY_STR.tr, `${k} in TR`);
  }
  for (const k of ['prologue.objective', 'prologue.notYet']) {
    assert.ok(k in EVE_STR.en && k in EVE_STR.tr, `${k} in EN and TR`);
  }
  assert.ok(Object.keys(KNOCK_STR.en).length > 0);
});

test('the prologue scene uses the apartment anchors and a skippable story scene (not the intro tap rule)', () => {
  assert.notEqual(CUT.kind, 'intro', 'a hold skips it; a tap does not (the intro rule would skip on one tap)');
  assert.notEqual(CUT.skippable, false);
  const anchors = JSON.stringify(CUT.tracks.filter((t) => t.kind === 'camera')).match(/home\.[a-z]+/g) ?? [];
  for (const a of anchors) assert.ok(['home.spawn', 'home.spouse', 'home.table', 'home.phone', 'home.window'].includes(a), a);
});
