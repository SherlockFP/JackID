// Unit tests for the juice-core numbers (wave 7): the net win pop, the win streak steps, the big-win windup, the gamble
// ladder tension and High Stakes chime. Pure functions only: presentation values, no outcome is involved.
// NOT registered in scripts/tests/index.js (the director registers it).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let tiers, gambleFx, events;
before(async () => {
  tiers = await load('src/machines/_base/tiers.ts');
  gambleFx = await load('src/core/audio/gambleFx.ts');
  events = await load('src/core/events.ts');
});

test('netWin: the pop is the gross less the stake; without a stake the amount is shown as given', () => {
  assert.equal(tiers.netWin(100, 10), 90);
  assert.equal(tiers.netWin(100), 100);
  assert.equal(tiers.netWin(100, 0), 100, 'a zero stake is no stake');
  assert.equal(tiers.netWin(5, 10), -5, 'a partial refund shows a negative net, the caller decides');
});

test('streakSteps: nothing below 3 wins, +1 semitone per win from the third, capped at +8', () => {
  assert.equal(tiers.STREAK_MIN, 3);
  assert.equal(tiers.streakSteps(0), 0);
  assert.equal(tiers.streakSteps(2), 0);
  assert.equal(tiers.streakSteps(3), 1);
  assert.equal(tiers.streakSteps(4), 2);
  assert.equal(tiers.streakSteps(10), 8);
  assert.equal(tiers.streakSteps(50), 8, 'the cap holds');
});

test('windupSec: big 0.6 s, huge and up 1.2 s, lower tiers no windup', () => {
  for (const t of ['none', 'push', 'small', 'medium']) assert.equal(tiers.windupSec(t), 0, `${t} has no windup`);
  assert.equal(tiers.windupSec('big'), 0.6);
  for (const t of ['huge', 'mega', 'jackpot']) assert.equal(tiers.windupSec(t), 1.2, `${t} winds up for 1.2 s`);
});

test('tensionParam climbs with the rung, 0.25 on the first rung to 1 on the last', () => {
  assert.equal(gambleFx.LADDER_RUNGS, 4);
  assert.equal(gambleFx.tensionParam(0), 0);
  assert.equal(gambleFx.tensionParam(1), 0.25);
  assert.equal(gambleFx.tensionParam(4), 1);
  assert.equal(gambleFx.tensionParam(9), 1, 'clamped');
  assert.ok(gambleFx.tensionParam(2) > gambleFx.tensionParam(1));
});

test('hsBoostPitch rises with the bonus and stays within +4 .. +12 semitones', () => {
  assert.equal(gambleFx.hsBoostPitch(0), 4);
  assert.equal(gambleFx.hsBoostPitch(1e9), 12);
  let prev = -1;
  for (const b of [0, 10, 100, 1000, 10000]) {
    const p = gambleFx.hsBoostPitch(b);
    assert.ok(p >= prev, `pitch does not fall as the bonus grows (${b})`);
    prev = p;
  }
});

test('gamble:fx tension plays tensionRise with the rung param; max plays winMega and a cascade; offer and hsBoost chime', () => {
  const calls = [];
  const engine = {
    play: (name, o) => { calls.push([name, o ?? null]); return null; },
    coins: (n) => { calls.push(['coins', n]); },
  };
  const off = gambleFx.wireGambleFx(engine);
  try {
    events.bus.emit('gamble:fx', { kind: 'tension', mid: 't', step: 2, pot: 20 });
    events.bus.emit('gamble:fx', { kind: 'max', mid: 't', step: 4, pot: 400 });
    events.bus.emit('gamble:fx', { kind: 'offer', mid: 't', step: 0, pot: 50 });
    events.bus.emit('gamble:fx', { kind: 'hsBoost', mid: 't', step: 0, pot: 100 });
  } finally { off(); }
  assert.deepEqual(calls[0], ['tensionRise', { param: 0.5 }]);
  assert.equal(calls[1][0], 'winMega');
  assert.equal(calls[2][0], 'coins');
  assert.ok(calls[2][1] > 0 && calls[2][1] <= 40, 'a cascade of at most 40 clinks');
  assert.equal(calls[3][0], 'chime');
  assert.equal(calls[4][0], 'chime');
  assert.equal(calls[4][1].pitch, gambleFx.hsBoostPitch(100), 'the boost chime is pitched by the bonus');
});
