// Unit tests for the horror dread unit (src/game/horror/director.ts) and the Collector's visit scene
// (src/game/story/cutscenes/mafia_visit.cutscene.ts, routed from src/game/story/index.ts).
// dread:change must carry 0..1, the unit RunApi.dread() emits, because the story stingers (0.5 / 0.8) and the light
// grade both read that scale. Not registered in scripts/tests/index.js (the director registers it).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load, closeVite, ROOT } from './_vite.mjs';

after(closeVite);

let HD, EV, SCENE, STORY_STR;
before(async () => {
  HD = await load('src/game/horror/director.ts');
  EV = await load('src/core/events.ts');
  SCENE = (await load('src/game/story/cutscenes/mafia_visit.cutscene.ts')).default;
  STORY_STR = (await load('src/game/story/story.strings.ts')).default;
});

/** A director with every outside dependency stubbed (no audio, lights, actors or viewers) and a flat rng. */
function makeDirector() {
  const noop = () => {};
  const deps = {
    audio: {
      play: noop, setMuffle: noop,
      music: { setDread: noop, stinger: noop },
      voice: { speak: () => Promise.resolve() },
    },
    subtitle: noop,
    lights: () => null,
    actors: {
      update: noop, lookForward: noop, lookAt: noop, despawn: noop,
      play: () => Promise.resolve(), spawn: () => Promise.resolve(null), walkPath: () => Promise.resolve(false),
    },
    rng: { float: (a) => a, int: (a) => a, chance: () => false, pick: (xs) => xs[0], shuffle: (xs) => xs },
    viewers: () => [],
    // calm keeps the scares out of it, so only the meter and its events move
    settings: () => ({ calm: true, reduceFlashing: false, subtitles: false }),
  };
  return HD.createHorror(deps);
}

/** Collect every dread:change value while `fn` runs. */
function collectDread(fn) {
  const values = [];
  const off = EV.bus.on('dread:change', ({ value }) => values.push(value));
  try { fn(); } finally { off(); }
  return values;
}

const state = (over = {}) => ({
  night: 1, nightElapsed: 0, deposit: 0, quota: 0, cursedCharms: 0, brightBulbs: 0, charmRelief: 0,
  luck: 0, badRun: false, ...over,
});

test('dread:change is 0..1, the RunApi.dread() unit, and ends on the meter fraction', () => {
  const hd = makeDirector();
  const values = collectDread(() => {
    // Night 8 has a base of 60 and no quota pressure, so the shown value slews up to 60 in six 0.5 s steps
    for (let i = 0; i < 12; i++) hd.update(0.5, state({ night: 8 }), 0.5);
  });
  assert.ok(values.length > 0, 'the meter emitted');
  for (const v of values) assert.ok(v >= 0 && v <= 1, `value ${v} is inside 0..1`);
  assert.ok(Math.abs(values.at(-1) - 0.6) < 1e-9, `last value ${values.at(-1)} is 0.6`);
  assert.ok(Math.abs(values.at(-1) - hd.fraction) < 1e-9, 'the last value matches the director fraction');
});

test('a few points of dread stay far below the story thresholds (no 0..100 value on the bus)', () => {
  const hd = makeDirector();
  // Night 1 has a base of 0; one cursed charm adds 3 points, so the meter settles on 3 / 100
  const values = collectDread(() => { for (let i = 0; i < 4; i++) hd.update(0.5, state({ cursedCharms: 1 }), 0.5); });
  assert.ok(values.length > 0);
  assert.ok(values.every((v) => v < 0.5), `no value reaches the 0.5 stinger threshold: ${values}`);
  assert.ok(Math.abs(values.at(-1) - 0.03) < 1e-9, `settles on 0.03, got ${values.at(-1)}`);
});

test('the Collector visit scene: not skippable, one door hook, a pistol goon, and EN/TR subtitles', () => {
  assert.equal(SCENE.id, 'mafia_visit');
  assert.equal(SCENE.skippable, false, 'the death scene cannot be skipped');
  assert.ok(SCENE.duration > 0);

  const hooks = SCENE.tracks.filter((tr) => tr.kind === 'hook').flatMap((tr) => tr.cues.map((c) => c.hook));
  assert.deepEqual(hooks, ['home.doorOpen'], 'the only hook is the door swing');

  const goon = SCENE.actors.goon;
  assert.equal(goon.kind, 'mannequin');
  assert.ok(goon.props.some((p) => p.prop === 'pistol' && p.bone === 'hand_r'), 'the goon holds a pistol in hand_r');

  for (const tr of SCENE.tracks.filter((x) => x.kind === 'subtitle')) {
    for (const c of tr.cues) {
      const k = c.key.replace(/^story\./, '');
      assert.ok(STORY_STR.en[k], `en ${k}`);
      assert.ok(STORY_STR.tr[k], `tr ${k}`);
    }
  }

  // CutActors lerps straight lines with no collision, so every waypoint shares one x (the doorway's centre line)
  const moves = SCENE.tracks.filter((x) => x.kind === 'actor')
    .flatMap((x) => x.cues.filter((c) => c.moveTo).map((c) => c.moveTo.pos));
  assert.ok(moves.length >= 2, 'the goon walks in on at least two waypoints');
  for (const p of moves) assert.equal(p[0], moves[0][0], 'waypoints stay on the doorway axis');
});

test('story/index.ts routes an ending of shot to mafia_visit, before quota_fail, and registers the door hook', () => {
  const src = readFileSync(join(ROOT, 'src/game/story/index.ts'), 'utf8');
  const shot = src.indexOf("summary.ending === 'shot'");
  const fell = src.indexOf("summary.result === 'fell'");
  assert.ok(shot > 0 && fell > shot, 'the shot ending is checked before the fell branch');
  assert.ok(src.includes("playStory('mafia_visit')"));
  assert.ok(src.includes("registerHook('home.doorOpen'"), 'the door hook is registered');
});
