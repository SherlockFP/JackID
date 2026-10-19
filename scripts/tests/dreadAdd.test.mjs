// dread.add is signed (docs/JOKER.md §7 "found while reading"): session.ts used to feed the Dread meter only the relief, Math.max(0, -mod), so a
// positive dread.add (cursed candy, the Moth Swarm, the draft event, Loki's boons) was dropped. The meter now gets -mod as its charmRelief, so a
// positive mod raises Dread and a negative one still relieves it. session.ts needs the app and the DOM, so the wiring line is checked in the
// source and the rest runs on the real run and the real meter.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load, closeVite, ROOT } from './_vite.mjs';

after(closeVite);

let RUN, HD, WE;
before(async () => {
  RUN = await load('src/game/run.ts');
  HD = await load('src/game/horror/dread.ts');
  WE = await load('src/game/watchEvents.ts');
});

/** What session.ts hands the meter: the signed relief. */
const reliefOf = (run) => -run.mod('dread.add', 'run', 0);
const state = (relief) => ({ night: 3, nightElapsed: 0, deposit: 0, quota: 100, cursedCharms: 0, brightBulbs: 0, charmRelief: relief });
const dread = (run) => HD.targetDread(state(reliefOf(run)), 0);

test('a positive dread.add raises the Dread target (the Moth Swarm +6, the draft event +4), a negative one still lowers it', () => {
  const run = RUN.createRun({ seed: 3, mode: 'debt' });
  const base = dread(run);
  assert.equal(base, HD.nightBase(3), 'nothing held: the Night base');
  assert.equal(run.grantCharm('moth_swarm'), true);
  assert.equal(run.mod('dread.add', 'run', 0), 6);
  assert.equal(dread(run), base + 6, 'the Moth Swarm raises it by its +6 (the cursed-charm count is a separate input)');
  assert.equal(run.grantCharm('night_light'), true);
  assert.equal(run.mod('dread.add', 'run', 0), -4, '+6 and -10 net to -4');
  assert.equal(dread(run), base - 4, 'a net relief lowers it');
  run.dispose();
  const draft = WE.WATCH_EVENTS.find((e) => e.id === 'draft').effects.find((e) => e.hook === 'dread.add');
  assert.equal(draft.value, 4);
  assert.equal(HD.targetDread(state(-draft.value), 0), base + 4);
});

test('the meter takes a negative relief as Dread and still clamps to 0..cap', () => {
  assert.equal(HD.targetDread(state(0), 0), 12);
  assert.equal(HD.targetDread(state(-8), 0), 20);
  assert.equal(HD.targetDread(state(8), 0), 4);
  assert.equal(HD.targetDread(state(-500), 0), HD.dreadCap(3), 'capped');
  assert.equal(HD.targetDread(state(500), 0), 0, 'floored');
});

test('session.ts hands the meter the signed mod, not its relief half', () => {
  const src = readFileSync(join(ROOT, 'src/game/ingame/session.ts'), 'utf8');
  assert.match(src, /charmRelief:\s*-run\.mod\('dread\.add',\s*'run',\s*0\)/);
  assert.doesNotMatch(src, /Math\.max\(0,\s*-run\.mod\('dread\.add'/);
});
