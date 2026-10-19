// Unit tests for the recorded tracks of the score: src/core/audio/music/oga.ts (when the saloon and the pursuit are wanted,
// the hysteresis, the Calm and jukebox rules, how far the bed ducks) and the files that ship. The crossfades themselves need an
// AudioContext: scripts/qa/musicTransitions.mjs records the real conductor through them.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { load, closeVite, ROOT } from './_vite.mjs';

after(closeVite);

let O, S, L;
before(async () => {
  O = await load('src/core/audio/music/oga.ts');
  S = await load('src/core/audio/music/stakes.ts');
  L = await load('src/world/layout.ts');
});

const bar = (o = {}) => ({ zone: 'lobby', x: -6, z: 14.2, dread: 0, floor: true, juke: null, ...o });
const at = (m) => ({ x: O.BAR.x + m, z: O.BAR.z });             // `m` metres from the bar, along x
const epic = (o = {}) => ({ stakes: 0, cue: false, busy: false, floor: true, juke: null, calm: false, ...o });

test('the bar constants are the layout\'s BAR_POS (core may not import the world, so this pins them)', () => {
  assert.equal(O.BAR.x, L.BAR_POS.x);
  assert.equal(O.BAR.z, L.BAR_POS.z);
});

test('saloon: in the lobby within 7 m of the bar, out beyond 10 m, and 7..10 m keeps whatever it was (hysteresis)', () => {
  assert.equal(O.barWanted(false, bar(at(5))), true);
  assert.equal(O.barWanted(false, bar(at(12))), false);
  assert.equal(O.barWanted(false, bar(at(8.5))), false);        // not in yet
  assert.equal(O.barWanted(true, bar(at(8.5))), true);          // not out yet
  assert.equal(O.barWanted(true, bar(at(10.5))), false);
  // walking out and back along a line toggles twice, not on every step
  let on = false, flips = 0;
  for (const m of [12, 11, 9, 7.5, 6.9, 6, 7.5, 9, 9.9, 10.1, 9.9, 9, 8]) {
    const next = O.barWanted(on, bar(at(m)));
    if (next !== on) flips++;
    on = next;
  }
  assert.equal(flips, 2);
});

test('saloon: only in the lobby (or a future "bar" zone), only on the floor, and never without a position', () => {
  assert.equal(O.barWanted(false, bar({ ...at(2), zone: 'well' })), false);
  assert.equal(O.barWanted(false, bar({ ...at(2), zone: null })), false);
  assert.equal(O.barWanted(false, bar({ x: null, z: null })), false);
  assert.equal(O.barWanted(false, bar({ zone: 'bar', x: null, z: null })), true);
  assert.equal(O.barWanted(true, bar({ ...at(2), floor: false })), false);           // a cutscene, the menu, a chase
});

test('saloon: a horror bed is not a bar tune (dread 0.35 in, 0.5 out)', () => {
  assert.equal(O.barWanted(false, bar({ dread: 0.34 })), true);
  assert.equal(O.barWanted(false, bar({ dread: 0.4 })), false);
  assert.equal(O.barWanted(true, bar({ dread: 0.4 })), true);
  assert.equal(O.barWanted(true, bar({ dread: 0.5 })), false);
});

test('saloon: the jukebox decides when it is playing something', () => {
  assert.equal(O.barWanted(false, bar({ ...at(30), zone: 'mouth', dread: 0.9, juke: 'drunken_saloon' })), true);
  assert.equal(O.barWanted(true, bar({ ...at(1), juke: 'velvet_ledger' })), false);
  assert.equal(O.barWanted(true, bar({ ...at(1), juke: 'drunken_saloon', floor: false })), false);
  assert.equal(O.OGA.drunken_saloon.juke, true);
  assert.equal(O.OGA.determined_pursuit.juke, false);
});

test('pursuit: in at stakes 0.8, out below 0.55, and between them it keeps what it was', () => {
  assert.equal(O.epicWanted(false, epic({ stakes: 0.79 })), false);
  assert.equal(O.epicWanted(false, epic({ stakes: 0.8 })), true);
  assert.equal(O.epicWanted(false, epic({ stakes: 0.7 })), false);
  assert.equal(O.epicWanted(true, epic({ stakes: 0.7 })), true);
  assert.equal(O.epicWanted(true, epic({ stakes: 0.55 })), true);
  assert.equal(O.epicWanted(true, epic({ stakes: 0.549 })), false);
  let on = false, flips = 0;
  for (const s of [0.5, 0.78, 0.82, 0.79, 0.81, 0.78, 0.82, 0.7, 0.6, 0.56]) {      // a meter hovering at the threshold
    const next = O.epicWanted(on, epic({ stakes: s }));
    if (next !== on) flips++;
    on = next;
  }
  assert.equal(flips, 1);
});

test('pursuit: the Burning Wager cue brings it in at once; Calm, a non-floor state and the jukebox keep it out', () => {
  assert.equal(O.epicWanted(false, epic({ stakes: 0, cue: true })), true);
  assert.equal(O.epicWanted(false, epic({ stakes: 1, calm: true })), false);
  assert.equal(O.epicWanted(true, epic({ stakes: 0, cue: true, calm: true })), false);
  assert.equal(O.epicWanted(true, epic({ stakes: 1, floor: false })), false);
  assert.equal(O.epicWanted(false, epic({ stakes: 1, juke: 'velvet_ledger' })), false);
});

test('pursuit: it does not bury a cue song that owns the moment (chase, duel theme), but the Burning Wager still takes it', () => {
  assert.equal(O.epicWanted(false, epic({ stakes: 0.9, busy: true })), false);
  assert.equal(O.epicWanted(true, epic({ stakes: 0.9, busy: true })), false);
  assert.equal(O.epicWanted(false, epic({ stakes: 0.9, busy: true, cue: true })), true);
});

test('pursuit against the real meter: an all-in comes in about 2 s after it opens and goes out about 2.4 s after it closes; Calm never reaches it', () => {
  const run = (calm) => {
    const m = new S.StakesMeter();
    m.calm = calm;
    m.set('gamble', 1, 0, S.HOLD.gamble);
    let on = false, tOn = -1, tOff = -1;
    for (let t = 0.025; t < 12; t += 0.025) {
      if (t >= 5) m.set('gamble', 0, t);                                                    // it closes at 5 s
      const next = O.epicWanted(on, epic({ stakes: m.tick(t, 0.025), calm }));
      if (next && !on && tOn < 0) tOn = t;
      if (!next && on) tOff = t - 5;
      on = next;
    }
    return { tOn, tOff };
  };
  const r = run(false);
  assert.ok(r.tOn > 1.5 && r.tOn < 2.5, `in at ${r.tOn}`);
  assert.ok(r.tOff > 1.8 && r.tOff < 3.2, `out ${r.tOff} s after`);
  assert.equal(run(true).tOn, -1);                                                          // Calm caps the meter at 0.5
});

test('the bed: it ducks under a recording, the pursuit wins over the saloon, and with neither it is at full level', () => {
  assert.deepEqual(O.mixOf(false, false), { bar: false, epic: false, bed: 1 });
  assert.deepEqual(O.mixOf(true, false), { bar: true, epic: false, bed: O.DUCK.bar });
  assert.deepEqual(O.mixOf(false, true), { bar: false, epic: true, bed: O.DUCK.epic });
  assert.deepEqual(O.mixOf(true, true), { bar: false, epic: true, bed: O.DUCK.epic });
  assert.ok(O.DUCK.bar < O.DUCK.epic && O.DUCK.epic < 1);
});

test('the shipped files: Ogg Opus, web-sized, with the licence next to them', () => {
  const dir = join(ROOT, 'public', 'assets', 'vendor', 'music-oga');
  for (const d of Object.values(O.OGA)) {
    const f = join(dir, d.file);
    assert.ok(existsSync(f), `${d.file} is missing`);
    const kb = statSync(f).size / 1024;
    assert.ok(kb > 1400 && kb < 2600, `${d.file} is ${kb.toFixed(0)} KB`);
    const head = readFileSync(f).subarray(0, 64).toString('latin1');
    assert.ok(head.startsWith('OggS') && head.includes('OpusHead'), `${d.file} is not Ogg Opus`);
    assert.ok(d.gain > 0 && d.gain < 4);
  }
  const lic = readFileSync(join(dir, 'LICENSE.txt'), 'utf8');
  for (const s of ['CC0', 'https://opengameart.org/content/drunken-saloon', 'https://opengameart.org/content/determined-pursuit-epic-orchestra-loop']) assert.ok(lic.includes(s), s);
});
