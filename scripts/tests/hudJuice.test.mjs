// Unit tests for the HUD juice maths (src/menu/hud/juiceMath.ts): the centre count-up length, the roll pitch and its 12 Hz
// throttle, the heat meter's colour and blink, the quota's quarter marks, and the overshoot tier's rank and sting.
// Pure functions only: no DOM, no app. Not registered in scripts/tests/index.js (the director registers it).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let jm;
before(async () => {
  jm = await load('src/menu/hud/juiceMath.ts');
});

test('the centre count-up lasts 0.5 to 1.1 s and never shortens as the tier rises', () => {
  for (let idx = 0; idx <= 7; idx++) {
    const s = jm.countUpSec(idx);
    assert.ok(s >= 0.5 && s <= 1.1, `tier ${idx} in range (${s})`);
    if (idx > 0) assert.ok(s >= jm.countUpSec(idx - 1), `tier ${idx} not shorter than ${idx - 1}`);
  }
  assert.equal(jm.countUpSec(7), 1.1, 'jackpot is the longest roll');
  assert.equal(jm.countUpSec(2), 0.5, 'a small win is the shortest');
});

test('the count-up clamps junk and out-of-range tier indices', () => {
  assert.equal(jm.countUpSec(-3), 0.5);
  assert.equal(jm.countUpSec(99), 1.1);
  assert.equal(jm.countUpSec(Number.NaN), 0.5);
});

test('a roll tick climbs one octave over the roll and clamps its progress', () => {
  assert.equal(jm.rollPitch(0), 0);
  assert.equal(jm.rollPitch(0.5), 6);
  assert.equal(jm.rollPitch(1), 12);
  assert.equal(jm.rollPitch(3), 12, 'past the end stays at an octave');
  assert.equal(jm.rollPitch(-1), 0, 'before the start stays at zero');
  assert.equal(jm.rollPitch(Number.NaN), 0);
});

test('the tick gate caps a moving roll at 12 ticks a second', () => {
  const gate = new jm.TickGate();
  let ticks = 0;
  for (let f = 0; f < 60; f++) if (gate.pass(1 / 60, true)) ticks++;
  assert.ok(ticks <= 12, `never above 12 Hz (${ticks})`);
  assert.ok(ticks >= 11, `close to the cap while the roll moves (${ticks})`);
});

test('the tick gate is silent when nothing moves, and fires again after the gap', () => {
  const gate = new jm.TickGate();
  assert.equal(gate.pass(1, false), false, 'no tick while the roll is still');
  assert.equal(gate.pass(0, true), true, 'the first move ticks at once');
  assert.equal(gate.pass(0.01, true), false, 'a second move inside the gap is held back');
  assert.equal(gate.pass(0.2, true), true, 'a move after the gap ticks again');
});

test('the heat meter runs amber to red, and blinks only above 75', () => {
  assert.equal(jm.heatTone(0).color, '#e69431');
  assert.equal(jm.heatTone(100).color, '#c52129');
  const mid = jm.heatTone(50).color;
  assert.match(mid, /^#[0-9a-f]{6}$/);
  assert.equal(jm.heatTone(75).blink, false, 'exactly 75 does not blink');
  assert.equal(jm.heatTone(76).blink, true);
  assert.equal(jm.heatTone(120).color, '#c52129', 'above 100 clamps to red');
});

test('the quota marks crossed are the quarter marks passed, each once', () => {
  assert.deepEqual(jm.quotaCrossings(20, 60), [25, 50]);
  assert.deepEqual(jm.quotaCrossings(0, 100), [25, 50, 75, 100]);
  assert.deepEqual(jm.quotaCrossings(50, 50), [], 'no move, no tick');
  assert.deepEqual(jm.quotaCrossings(75, 99), [], 'a mark already passed does not repeat');
  assert.deepEqual(jm.quotaCrossings(99, 100), [100]);
  assert.deepEqual(jm.quotaCrossings(60, 30), [], 'a fall crosses nothing');
});

test('the overshoot tiers rank in their schedule order, and the top two sting loudest', () => {
  assert.equal(jm.overTierLevel('gratuity'), 0);
  assert.equal(jm.overTierLevel('golden'), 3);
  assert.equal(jm.overTierLevel('envy'), 5);
  assert.equal(jm.overTierLevel('nope'), -1);
  assert.equal(jm.overTierLevel(null), -1);
  assert.equal(jm.overTierSting('seal'), 'winHuge');
  assert.equal(jm.overTierSting('envy'), 'winMega');
  assert.equal(jm.overTierSting('gratuity'), 'win1');
  assert.equal(jm.overTierSting('unknown'), 'win1', 'an unknown tier takes the small sting');
});
