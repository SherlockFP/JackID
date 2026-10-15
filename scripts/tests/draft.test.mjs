// Starter Draft (draft wave): the three-charm offer is seeded and deterministic, always holds exactly one engine charm,
// the Bell waits for the pick (or the timer), and every Settle names what the bank paid.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let DRAFT, RUN, REG, CH, CHD, EV, SCH;
before(async () => {
  DRAFT = await load('src/game/draft.ts');
  RUN = await load('src/game/run.ts');
  REG = await load('src/machines/_base/registry.ts');
  CH = await load('src/game/charms/engine.ts');
  CHD = await load('src/game/data/charms.ts');
  EV = await load('src/core/events.ts');
  SCH = await load('src/game/data/schedule.ts');
  REG.load();
});

const SEEDS = Array.from({ length: 300 }, (_, i) => i + 1);

test('the offer is deterministic: the same seed gives the same three charms in the same order', () => {
  for (const seed of SEEDS) assert.deepEqual(DRAFT.starterOffer(seed), DRAFT.starterOffer(seed), `seed ${seed}`);
  assert.deepEqual(DRAFT.starterOffer(7), DRAFT.starterOffer(7));
});

test('the offer holds three distinct Common or Uncommon Launch charms, exactly one engine charm', () => {
  for (const seed of SEEDS) {
    const ids = DRAFT.starterOffer(seed);
    assert.equal(ids.length, DRAFT.STARTER_SIZE, `seed ${seed}: size`);
    assert.equal(new Set(ids).size, ids.length, `seed ${seed}: distinct`);
    const defs = ids.map((id) => CH.charmDef(id));
    for (const d of defs) {
      assert.ok(d, `seed ${seed}: ${d}`);
      assert.ok(d.rarity === 'common' || d.rarity === 'uncommon', `seed ${seed}: ${d.id} is ${d.rarity}`);
      assert.ok(CHD.LAUNCH_CHARM_IDS.has(d.id), `seed ${seed}: ${d.id} is launch`);
    }
    assert.equal(defs.filter((d) => DRAFT.archetypeOf(d) !== null).length, DRAFT.STARTER_ENGINE_SLOTS, `seed ${seed}: one engine`);
  }
});

test('owned charms are never offered again', () => {
  for (const seed of SEEDS.slice(0, 60)) {
    const first = DRAFT.starterOffer(seed)[0];
    const next = DRAFT.starterOffer(seed, (id) => id === first);
    assert.ok(!next.includes(first), `seed ${seed}`);
    assert.equal(next.length, DRAFT.STARTER_SIZE, `seed ${seed}: still three`);
  }
});

test('the offer varies by seed, and the engine slot ignores the Night gate (some engines unlock at N2+)', () => {
  const sets = new Set(SEEDS.map((s) => DRAFT.starterOffer(s).join('|')));
  assert.ok(sets.size >= 200, `distinct offers ${sets.size}`);
  const gated = SEEDS.some((s) => DRAFT.starterOffer(s).some((id) => CH.charmDef(id).unlock));
  assert.ok(gated, 'at least one seed offers a Night-gated engine charm at Night 1');
});

test('run start: the offer opens once, the Bell waits for a pick, and the pick lands in the pocket', () => {
  const run = RUN.createRun({ seed: 41, mode: 'debt' });
  assert.equal(run.starterDraft(), null, 'closed until the run opens it');
  assert.equal(run.openStarterDraft(), true);
  assert.equal(run.openStarterDraft(), false, 'opens once');
  const d = run.starterDraft();
  assert.ok(d && d.candidates.length === DRAFT.STARTER_SIZE);
  const owned = (id) => run.charms(run.selfId).some((c) => c.id === id);
  assert.deepEqual(d.candidates.map((c) => c.id), DRAFT.starterOffer(41, owned), 'the run offers the seeded three');
  assert.equal(run.startWatch(), true);
  assert.equal(run.shift.phase, 'bell');
  run.tick(10);
  assert.equal(run.shift.phase, 'bell', 'the Bell waits for the pick');
  assert.equal(run.pickStarter('not_on_offer'), false);
  const pick = d.candidates[1].id;
  assert.equal(run.pickStarter(pick), true);
  assert.equal(run.starterDraft(), null, 'the offer closes');
  assert.ok(owned(pick), 'the charm is in the pocket');
  run.tick(3);
  assert.equal(run.shift.phase, 'play', 'the Bell strikes after the pick');
  run.dispose();
});

test('run start: with no pick, the timer takes the first card that fits and the Bell goes on', () => {
  const run = RUN.createRun({ seed: 42, mode: 'debt' });
  assert.equal(run.openStarterDraft(), true);
  const first = run.starterDraft().candidates[0].id;
  const seen = [];
  const off = EV.bus.on('run:draft', (e) => seen.push(e));
  run.startWatch();
  for (let i = 0; i < 70 && run.starterDraft(); i++) run.tick(0.5);
  assert.equal(run.starterDraft(), null, 'the timer closed the offer');
  assert.deepEqual(seen.map((e) => [e.state, e.charm]), [['auto', first]]);
  assert.ok(run.charms(run.selfId).some((c) => c.id === first));
  for (let i = 0; i < 10 && run.shift.phase === 'bell'; i++) run.tick(0.5);
  assert.equal(run.shift.phase, 'play');
  off();
  run.dispose();
});

test('the offer is saved with the run and survives a snapshot round trip as plain data', () => {
  const run = RUN.createRun({ seed: 43, mode: 'debt' });
  run.openStarterDraft();
  const snap = JSON.parse(JSON.stringify(run.snapshot()));
  assert.equal(snap.ext.starter.open, true);
  assert.deepEqual(snap.ext.starter.ids, run.starterDraft().candidates.map((c) => c.id));
  run.dispose();
});

test('the starter offer is for Debt Runs only (a Free Casino run has none)', () => {
  const run = RUN.createRun({ seed: 44, mode: 'free' });
  assert.equal(run.openStarterDraft(), false);
  assert.equal(run.starterDraft(), null);
  run.dispose();
});

test('every Settle names the bank: the interest and its rate, or the pulls it still needs', () => {
  const notes = [];
  const sold = [];
  const off = EV.bus.on('run:interest', (e) => sold.push(e));
  const run = RUN.createRun({ seed: 45, mode: 'debt', banner: (text) => notes.push(text) });
  run.coins = 200;
  assert.ok(run.deposit(60, true));
  run.phase = 'closing';
  run.watchPulls = SCH.ACTIVITY_MIN_PULLS;
  run.settleWatch();
  assert.ok(notes.some((n) => /^BANK \+\d+ interest \(\d+%\)$/.test(n)), `interest note (${notes.join(' | ')})`);
  assert.equal(sold.length, 1, 'the interest sound is raised once');
  run.dispose();

  const quiet = [];
  const run2 = RUN.createRun({ seed: 46, mode: 'debt', banner: (text) => quiet.push(text) });
  run2.coins = 200;
  assert.ok(run2.deposit(60, true));
  run2.phase = 'closing';
  run2.watchPulls = 0;
  run2.settleWatch();
  assert.ok(quiet.some((n) => /^BANK \+0 interest \(\d+%\): pull \d+ more to earn it$/.test(n)), `short note (${quiet.join(' | ')})`);
  run2.dispose();
  off();
});
