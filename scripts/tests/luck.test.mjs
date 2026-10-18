// ŞANS, the luck meter (src/game/luck.ts): star bounds, the payout bonus (1 % a star through payout.mult), the luck hook left
// alone, the change event with its reason, and the save round trip.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

const { bus } = await load('src/core/events.ts');
const L = await load('src/game/luck.ts');

/** The effects the meter's provider contributes for one query. */
const effectsOf = (m) => {
  const out = [];
  m.provider().collect({}, out);
  return out.flatMap((s) => s.effects);
};

test('ŞANS starts at 0, adds no payout effect, stays in −2..5', () => {
  const m = L.createLuckMeter({});
  assert.equal(m.stars(), 0);
  assert.equal(m.payoutMult(), 1);
  assert.deepEqual(effectsOf(m), []);
  for (let i = 0; i < 9; i++) bus.emit('quota:met', { index: i, ratio: 1 });
  assert.equal(m.stars(), L.LUCK_MAX);
  for (let i = 0; i < 9; i++) bus.emit('quota:failed', { index: i });
  assert.equal(m.stars(), L.LUCK_MIN);
  m.dispose();
});

test('ŞANS moves payout.mult by exactly 1 % per star and never touches the luck hook', () => {
  const m = L.createLuckMeter({});
  for (let stars = L.LUCK_MIN; stars <= L.LUCK_MAX; stars++) {
    m.restore({ stars });
    assert.equal(m.stars(), stars);
    const effects = effectsOf(m);
    assert.ok(effects.every((e) => e.hook === 'payout.mult'), `only payout.mult at ${stars} stars`);
    const expected = 1 + 0.01 * stars;
    assert.ok(Math.abs(m.payoutMult() - expected) < 1e-12, `payoutMult at ${stars} stars`);
    if (stars === 0) assert.deepEqual(effects, []);
    else assert.ok(Math.abs(effects[0].value - expected) < 1e-12, `provider value at ${stars} stars`);
  }
  m.dispose();
});

test('ŞANS emits luck:change with the source reason, and only on a real move', () => {
  const m = L.createLuckMeter({});
  const seen = [];
  const step = (fire) => { const before = m.stars(); fire(); if (m.stars() !== before) seen.push(m.last()); };
  // read through `last()`: other meters a test file left alive also hear the bus
  step(() => bus.emit('quota:met', { index: 0, ratio: 1 }));
  step(() => bus.emit('run:tithe', { pid: 0, state: 'missed', watch: 1, target: 1, earned: 0, shortfall: 1, tickets: 0 }));
  step(() => bus.emit('home:heat', { delta: 1, heat: 1, why: 'thin' }));
  for (let i = 0; i < 9; i++) step(() => bus.emit('quota:overshoot', { tier: 'x', pid: 0 }));
  m.dispose();
  // 1, 0, -1 (heat gain costs a star), then six overshoots reach the cap of 5; the last three are capped and emit nothing
  assert.deepEqual(seen.map((e) => [e.delta, e.why]), [[1, 'quota'], [-1, 'tithe'], [-1, 'thin'], ...Array(6).fill([1, 'overshoot'])]);
  assert.equal(seen.at(-1).stars, L.LUCK_MAX);
});

test('ŞANS ignores events after dispose, restore is silent, and the save survives a round trip', () => {
  const m = L.createLuckMeter({});
  bus.emit('quota:met', { index: 0, ratio: 1 });
  const snap = JSON.parse(JSON.stringify(m.snapshot()));
  m.dispose();
  bus.emit('quota:met', { index: 1, ratio: 1 });
  const seen = [];
  const off = bus.on('luck:change', (e) => seen.push(e));
  const again = L.createLuckMeter({});
  again.restore(snap);
  assert.equal(again.stars(), 1);
  assert.equal(seen.length, 0);
  again.restore({ stars: 'x' });
  assert.equal(again.stars(), 0);
  off();
  again.dispose();
});

// The machines that stayed at or under 99 % at luck +10 keep their RTP guard (the luck hook itself is still read by the machines).
// The seven that went over at +10 were the reason the meter fed the luck hook; the meter no longer does, so they are not sampled.
for (const id of ['plinko', 'blackjack']) {
  test(`ŞANS RTP: ${id} at luck +10 stays at or below 99 % (headless, 60000 rounds)`, async () => {
    const R = await load(`src/machines/${id}/rules.ts`);
    const rngMod = await load('src/core/rng.ts');
    assert.equal(typeof R.playHeadless, 'function', `${id} exposes playHeadless`);
    const N = 60000;
    const lucky = (() => {
      const rng = rngMod.createRng(20261018);
      const h = { luck: 10, mod: (_k, b) => b };
      let staked = 0, back = 0;
      for (let i = 0; i < N; i++) { back += R.playHeadless(rng, 10, h).gross; staked += 10; }
      return back / staked;
    })();
    assert.ok(lucky <= 0.99, `${id} RTP at luck +10 is ${lucky.toFixed(4)}`);
  });
}
