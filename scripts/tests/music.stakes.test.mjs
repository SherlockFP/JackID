// Unit tests for the high-stakes score: src/core/audio/music/stakes.ts (event → stakes mapping, the meter's combining and
// slewing, the overlay's layer thresholds) and songs/cues.ts (cue registration). Rendering needs an AudioContext, so the
// sound itself is checked offline by scripts/qa/musicRender.mjs, not here.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let S, BEDS, C;
before(async () => {
  S = await load('src/core/audio/music/stakes.ts');
  ({ BEDS } = await load('src/core/audio/music/songs/beds.ts'));
  C = await load('src/core/audio/music/songs/cues.ts');
});

test('a bet maps to stakes by its share of the pocket, or by being 3x the usual bet', () => {
  assert.equal(S.betStakes(10, 1000, 10), 0);                 // 1 %: nothing
  assert.equal(S.betStakes(250, 1000, 10), 0.5);              // exactly 25 %
  assert.equal(S.betStakes(1000, 1000, 10), 1);               // all-in
  assert.ok(S.betStakes(600, 1000, 10) > 0.5 && S.betStakes(600, 1000, 10) < 1);
  assert.equal(S.betStakes(30, 1000, 10), 0.4);               // a big one for this player
  assert.equal(S.betStakes(20, 1000, 10), 0);
  assert.equal(S.betStakes(0, 1000, 10), 0);
  assert.equal(S.betStakes(5, 0, 0), 1);                      // an empty pocket: everything is on the line
});

test('gamble fx: open offers and climbing rungs raise the stakes, closing ones clear them', () => {
  assert.equal(S.gambleStakes('offer', 0), 0.5);
  assert.ok(S.gambleStakes('flip', 3) > S.gambleStakes('flip', 1));
  assert.ok(S.gambleStakes('flip', 99) <= 0.95);
  assert.equal(S.gambleStakes('allinFire', 1), 1);
  for (const k of ['collect', 'lose', 'hsOff', 'allinCancel', 'allinWin', 'allinLose']) assert.equal(S.gambleStakes(k, 2), null, k);
});

test('dread only counts above 0.4, up to 0.6', () => {
  assert.equal(S.dreadStakes(0.3), 0);
  assert.equal(S.dreadStakes(1), 0.6);
  assert.ok(S.dreadStakes(0.7) > 0 && S.dreadStakes(0.7) < 0.6);
});

test('the meter combines sources (never past 1), expires holds, and Calm caps it below the stabs', () => {
  const m = new S.StakesMeter();
  m.set('lastCall', S.STAKE.lastCall, 0);
  m.set('bet', 0.5, 0, S.HOLD.bet);
  assert.equal(m.target(0), 0.75);                            // 1 − 0.5 · 0.5
  assert.equal(m.target(S.HOLD.bet + 0.1), 0.5);              // the bet expired, Last Call stays
  m.set('a', 1, 10); m.set('b', 1, 10);
  assert.equal(m.target(10), 1);
  m.set('a', 0, 10); m.set('b', 0, 10);                       // 0 clears
  assert.equal(m.target(10), 0.5);
  m.calm = true;
  m.set('final', S.STAKE.final, 10);
  assert.equal(m.target(10), S.CALM_CAP);
  assert.ok(S.CALM_CAP < S.LAYER_AT.stabs);
});

test('smoothing: it rises within a few seconds, falls slower, and never overshoots', () => {
  const m = new S.StakesMeter();
  m.set('x', 1, 0);
  let t = 0, prev = 0;
  for (; t < 1.2; t += 0.025) { const v = m.tick(t, 0.025); assert.ok(v >= prev && v <= 1); prev = v; }
  assert.ok(prev > 0.55 && prev < 0.75, `one rise tau: ${prev}`);
  for (; t < 10; t += 0.025) m.tick(t, 0.025);
  assert.equal(m.value, 1);
  m.set('x', 0, t);
  const t0 = t;
  for (; t < t0 + 1.2; t += 0.025) m.tick(t, 0.025);
  assert.ok(m.value > 0.6, `falls slower than it rose: ${m.value}`);
  assert.equal(m.tick(t, 0), m.value);                        // dt 0 holds
});

test('layer thresholds: drums, bass, stabs, choir come in one after another as the stakes rise', () => {
  const parts = S.stakesLayer();
  const order = ['stk.drums', 'stk.bass', 'stk.stabs', 'stk.choir'];
  assert.deepEqual(parts.map((p) => p.id), order);
  const at = [S.LAYER_AT.drums, S.LAYER_AT.bass, S.LAYER_AT.stabs, S.LAYER_AT.choir];
  for (let k = 0; k < 4; k++) {
    const g = (s) => parts[k].gate({ i: 0, d: 0, s });
    assert.ok(g(at[k] - 0.1) < 0.025, `${order[k]} silent below its threshold`);
    assert.ok(g(at[k] + 0.15) > 0.95, `${order[k]} full above it`);
    if (k < 3) assert.ok(g(at[k + 1]) > 0.95, `${order[k]} already full when the next layer enters`);
  }
  for (const p of parts) assert.equal(p.gate({ i: 1, d: 1, s: 0 }), 0, `${p.id} ignores intensity and dread`);
});

test('cue registration: the floor beds wear the overlay, every cue is a bed, Last Call is the bed +15 %', () => {
  for (const id of ['lounge', 'arcade', 'felt', 'pipes', 'tango', 'laundry', 'carnival']) {
    assert.ok(BEDS[id].parts.some((p) => p.id === 'stk.choir'), `${id} has the stakes overlay`);
  }
  assert.ok(!BEDS.menu.parts.some((p) => p.id.startsWith('stk.')));
  for (const id of ['duel_lucan', 'duel_tamsin', 'duel_ada', 'burning_wager', 'reel_chase', 'lastcall', 'chase_hit', 'chase_miss']) {
    assert.ok(BEDS[id], `${id} registered`);
    const ids = BEDS[id].parts.map((p) => p.id);
    assert.equal(new Set(ids).size, ids.length, `${id} part ids are unique`);
  }
  for (const id of ['duel_lucan', 'duel_tamsin', 'duel_ada']) {
    const gated = BEDS[id].parts.filter((p) => p.gate({ i: 0.5, d: 0, s: 0.35 }) < 0.025 && p.gate({ i: 0.5, d: 0, s: 0.85 }) > 0.9);
    assert.ok(gated.length >= 2, `${id} has final-round layers`);
  }
  assert.ok(BEDS.duel_lucan.parts.some((p) => p.inst === 'harpsi'), 'Lucan plays the harpsichord');
  assert.equal(BEDS.duel_lucan.beats, 3);
  const lc = C.lastCallOf(BEDS.arcade);
  assert.equal(lc.bpm, Math.round(BEDS.arcade.bpm * 1.15));
  assert.equal(lc.key, BEDS.arcade.key);
  assert.ok(lc.parts.some((p) => p.id === 'lc.clock'));
  const hit = C.hitOf(BEDS.felt), miss = C.missOf(BEDS.felt);
  assert.ok(hit.oneShot && !hit.then && miss.oneShot && !miss.then, 'hit / miss end and hand back to the bed');
  assert.equal(hit.key, BEDS.felt.key);
  assert.deepEqual(BEDS.reel_chase.parts.map((p) => p.id), ['drum.heart'], 'the chase is a heartbeat only');
});
