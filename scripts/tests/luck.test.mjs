// ŞANS, the luck meter (src/game/luck.ts): star bounds, the payout bonus (2 % a star through payout.mult), the luck hook left
// alone, the change event with its reason, the save round trip, and the wave 106 sources: Nazar Boncuğu (max +1, the first loss
// of a Night blocked), Full Bucket (a star on a tithe met) and Lucky Hand (a star on a x10 win), each once a Night.
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

test('ŞANS moves payout.mult by exactly 2 % per star and never touches the luck hook', () => {
  const m = L.createLuckMeter({});
  for (let stars = L.LUCK_MIN; stars <= L.LUCK_MAX; stars++) {
    m.restore({ stars });
    assert.equal(m.stars(), stars);
    const effects = effectsOf(m);
    assert.ok(effects.every((e) => e.hook === 'payout.mult'), `only payout.mult at ${stars} stars`);
    const expected = 1 + 0.02 * stars;
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

test('the Well tunes ŞANS through the run port: a richer star, a higher cap, a softer fall, Still Water and Wishing Coin', () => {
  const xs = { 'x.luck.perStar': 0.015, 'x.luck.max': 7, 'x.luck.failSoft': 1 };
  const fxs = { sealedNoStars: 1, depositPerStar: 0.01 };
  const m = L.createLuckMeter({ x: (h, b) => xs[h] ?? b, fx: (k) => fxs[k] ?? 0 });
  m.retune();
  m.restore({ stars: 9 });
  assert.equal(m.stars(), 7, 'The Well Answers lifts the cap to 7');
  assert.ok(Math.abs(m.payoutMult() - (1 + 0.015 * 7)) < 1e-12, 'First Penny: 1.5 % a star');
  assert.ok(effectsOf(m).some((e) => e.hook === 'deposit.bonus' && Math.abs(e.value - 0.07) < 1e-12), 'Wishing Coin: +1 % deposits a star');
  m.restore({ stars: 0 });
  bus.emit('quota:failed', { index: 0 });
  assert.equal(m.stars(), -1, 'Soft Landing: a fall costs one star, not two');
  bus.emit('quota:sealed', { index: 0, left: 2, memory: 'street' });
  assert.equal(m.stars(), -1, 'Still Water: a sealed Dawn costs no stars');
  m.dispose();
});

const tithe = (state) => ({ pid: 0, state, watch: 1, target: 10, earned: 10, shortfall: 0, tickets: 0 });
const win = (bet, gross) => ({ mid: 'm1', machineId: 'bandit', pid: 0, bet, gross, credited: gross, tier: 'big', tags: [] });

test('Nazar Boncuğu: the cap rises by one the moment the charm is held, and the first star loss of each Night is blocked whole', () => {
  const xs = {};
  const m = L.createLuckMeter({ x: (h, b) => xs[h] ?? b });
  bus.emit('night:begin', { night: 1 });
  m.restore({ stars: 5 });
  bus.emit('quota:met', { index: 0, ratio: 1 });
  assert.equal(m.stars(), 5, 'no charm: the cap is 5');
  Object.assign(xs, { 'x.luck.max': 6, 'x.luck.shield': 1 });   // the charm is bought: no retune() call, the meter reads it on the next move
  bus.emit('quota:met', { index: 1, ratio: 1 });
  assert.equal(m.stars(), 6, 'max +1');
  bus.emit('quota:failed', { index: 1 });
  assert.equal(m.stars(), 6, 'the first loss (two stars) is blocked whole');
  bus.emit('quota:failed', { index: 2 });   // not a missed tithe: a HomePhone left alive by another test hears those (heat, one more star)
  assert.equal(m.stars(), 4, 'the second loss of the Night goes through');
  bus.emit('night:begin', { night: 2 });
  bus.emit('quota:failed', { index: 3 });
  assert.equal(m.stars(), 4, 'a new Night: the first loss is blocked again');
  m.dispose();
});

test('Nazar Boncuğu is not spent by a loss that could not move the meter (already at the floor) and survives a save', () => {
  const m = L.createLuckMeter({ x: (h, b) => (h === 'x.luck.shield' ? 1 : b) });
  bus.emit('night:begin', { night: 1 });
  m.restore({ stars: -2 });
  bus.emit('quota:failed', { index: 0 });
  assert.equal(m.stars(), -2);
  bus.emit('quota:met', { index: 0, ratio: 1 });
  assert.equal(m.stars(), -1);
  bus.emit('quota:failed', { index: 1 });
  assert.equal(m.stars(), -1, 'the shield was still there for the first real loss');
  const snap = JSON.parse(JSON.stringify(m.snapshot()));
  m.restore(snap);
  bus.emit('quota:failed', { index: 2 });
  assert.equal(m.stars(), -2, 'restored as spent: the next loss goes through');
  m.restore({ stars: -1 });
  bus.emit('quota:failed', { index: 3 });
  assert.equal(m.stars(), -1, 'a slice with no flags (an old save): the shield is there');
  m.dispose();
});

test('a missed tithe costs one star a Night, however many Watches miss it (wave 107)', () => {
  const m = L.createLuckMeter({});
  // a HomePhone left alive by another test warms its Heat on a missed tithe, and each warm costs this meter a star too: count them out
  let warm = 0;
  const off = bus.on('home:heat', ({ delta }) => { if (delta > 0) warm += 1; });
  bus.emit('night:begin', { night: 3 });
  m.restore({ stars: 4 });
  for (let w = 0; w < 3; w++) bus.emit('run:tithe', tithe('missed'));
  assert.equal(m.stars(), 4 - 1 - warm, 'three misses, one star');
  const before = m.stars();
  warm = 0;
  bus.emit('night:begin', { night: 4 });
  bus.emit('run:tithe', tithe('missed'));
  assert.equal(m.stars(), Math.max(-2, before - 1 - warm), 'a new Night costs again');
  off();
  m.dispose();
});

test('Full Bucket and Lucky Hand: a star by play, once a Night each, and only while the boon is held', () => {
  const fxs = {};
  const m = L.createLuckMeter({ fx: (k) => fxs[k] ?? 0 });
  bus.emit('night:begin', { night: 1 });
  bus.emit('run:tithe', tithe('met'));
  bus.emit('machine:result', win(10, 100));
  assert.equal(m.stars(), 0, 'no boon: no stars');
  Object.assign(fxs, { starOnTithe: 1, starOnBigWin: 1 });
  bus.emit('quota:failed', { index: 0 });   // a loss still costs (not a missed tithe: see the Nazar test)
  assert.equal(m.stars(), -2, 'a loss still costs');
  bus.emit('run:tithe', tithe('met'));
  assert.equal(m.stars(), -1);
  assert.equal(m.last().why, 'titheMet');
  bus.emit('run:tithe', tithe('met'));
  assert.equal(m.stars(), -1, 'the tithe star is once a Night');
  bus.emit('machine:result', win(10, 99));
  assert.equal(m.stars(), -1, 'x9.9 is not a big win');
  bus.emit('machine:result', win(10, 100));
  assert.equal(m.stars(), 0);
  assert.equal(m.last().why, 'bigWin');
  bus.emit('machine:result', win(10, 500));
  assert.equal(m.stars(), 0, 'the big-win star is once a Night');
  bus.emit('night:begin', { night: 2 });
  bus.emit('run:tithe', tithe('met'));
  bus.emit('machine:result', win(10, 500));
  assert.equal(m.stars(), 2, 'a new Night: both again');
  m.dispose();
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
