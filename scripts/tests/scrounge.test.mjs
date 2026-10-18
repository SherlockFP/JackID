// THE SCROUNGE (src/game/scrounge.ts): critters only while broke (pocket below the cheapest bet and nothing to withdraw), 3 to 5 on
// the floor, a catch within 1 m into a carry of at most 6, sell pays coins with the 12-coin Night cap, the watch sells once per
// run while broke for 8 coins, the critters leave once the pocket can play again, and the save round trip keeps the rng stream.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

const S = await load('src/game/scrounge.ts');

const SPOTS = [{ x: 0, z: 0 }, { x: 12, z: 0 }, { x: 0, z: 12 }];

/** A fake run: `coins` in the pocket, `wd` the bank's withdrawable, `bet` the cheapest bet, `night` the Night. */
function fakeRun({ coins = 0, wd = 0, bet = 5, night = 1 } = {}) {
  const r = {
    coins,
    wd,
    bet,
    night: () => night,
    balance: (cur) => (cur === 'coin' ? r.coins : 0),
    cheapestBet: () => r.bet,
    bank: () => ({ withdrawable: r.wd }),
    earn: (cur, amount) => { if (cur === 'coin') r.coins += amount; },
  };
  return r;
}

function make(run, seed = 7) {
  return S.createScrounge(run, { seed, spots: SPOTS });
}

/** Ticks `sec` seconds in 0.1 s steps. */
function ticks(sc, sec) {
  for (let i = 0; i < Math.round(sec / 0.1); i++) sc.tick(0.1);
}

test('no critters when the pocket covers the cheapest bet', () => {
  const run = fakeRun({ coins: 5, bet: 5 });
  const sc = make(run);
  sc.tick(0.1);
  assert.equal(sc.state().broke, false);
  assert.equal(sc.state().critters.length, 0);
});

test('no critters while the bank can still give coins back, even with an empty pocket', () => {
  const run = fakeRun({ coins: 0, wd: 30, bet: 5 });
  const sc = make(run);
  sc.tick(0.1);
  assert.equal(sc.isBroke(), false);
  assert.equal(sc.state().critters.length, 0);
});

test('broke spawns 3 to 5 critters near the spots, rats and cockroaches', () => {
  const run = fakeRun({ coins: 2, bet: 5 });
  const sc = make(run);
  sc.tick(0.1);
  const cs = sc.state().critters;
  assert.ok(cs.length >= S.SCROUNGE_MIN_SPAWN && cs.length <= S.SCROUNGE_MAX_SPAWN, `got ${cs.length}`);
  for (const c of cs) {
    assert.ok(c.kind === 'rat' || c.kind === 'roach');
    const near = SPOTS.some((p) => Math.hypot(c.ax - p.x, c.az - p.z) < 1e-9);
    assert.ok(near, 'a critter wanders around a spot');
    assert.ok(Math.abs(c.x - c.ax) <= S.SCURRY_RANGE + 1e-9 && Math.abs(c.z - c.az) <= S.SCURRY_RANGE + 1e-9);
  }
});

test('the same seed gives the same floor and the same scurries', () => {
  const a = make(fakeRun({ coins: 0 }), 99);
  const b = make(fakeRun({ coins: 0 }), 99);
  a.tick(0.1); b.tick(0.1);
  ticks(a, 3); ticks(b, 3);
  assert.deepEqual(a.state().critters, b.state().critters);
});

test('catching: within 1 m takes the critter, further away does not', () => {
  const run = fakeRun({ coins: 0 });
  const sc = make(run);
  sc.tick(0.1);
  const c = sc.state().critters[0];
  const far = sc.catchNear(c.x + 5, c.z + 5);
  assert.deepEqual(far, { ok: false, reason: 'none' });
  const near = sc.catchNear(c.x + 0.5, c.z);
  assert.equal(near.ok, true);
  assert.equal(near.kind, c.kind);
  assert.equal(near.value, S.CRITTER_VALUE[c.kind]);
  assert.equal(sc.state().carried.total, 1);
  assert.equal(sc.state().critters.some((o) => o.id === c.id), false, 'a caught critter leaves the floor');
});

test('catch values: a cockroach is worth 1 coin, a rat 2', () => {
  assert.equal(S.CRITTER_VALUE.roach, 1);
  assert.equal(S.CRITTER_VALUE.rat, 2);
});

test('carry is capped at 6, a seventh catch is refused', () => {
  const run = fakeRun({ coins: 0 });
  const sc = make(run);
  sc.tick(0.1);
  let caught = 0;
  for (let round = 0; round < 6; round++) {
    // Put the floor back to a full batch so there is always something to catch.
    if (sc.state().critters.length === 0) { ticks(sc, 40); }
    const list = sc.state().critters;
    for (const c of list) {
      if (sc.state().carried.total >= S.SCROUNGE_CARRY_MAX) break;
      if (sc.catchById(c.id).ok) caught++;
    }
  }
  assert.equal(sc.state().carried.total, S.SCROUNGE_CARRY_MAX);
  assert.equal(caught, S.SCROUNGE_CARRY_MAX);
  const list = sc.state().critters;
  if (list.length) assert.deepEqual(sc.catchById(list[0].id), { ok: false, reason: 'full' });
});

test('selling pays coins at once and empties the carry', () => {
  const run = fakeRun({ coins: 0 });
  const sc = make(run);
  sc.tick(0.1);
  const cs = sc.state().critters.slice(0, 3);
  for (const c of cs) sc.catchById(c.id);
  const want = sc.state().carried.rat * 2 + sc.state().carried.roach * 1;
  const r = sc.sell();
  assert.equal(r.ok, true);
  assert.equal(r.n, cs.length);
  assert.equal(r.coins, want);
  assert.equal(run.coins, want, 'the pocket got the coins');
  assert.equal(sc.state().carried.total, 0);
  assert.deepEqual(sc.sell(), { ok: false, reason: 'none' });
});

test('bug coins stop at 12 per Night, and a new Night resets the cap', () => {
  const run = fakeRun({ coins: 0, night: 1 });
  const sc = make(run);
  sc.tick(0.1);
  // Force six rats into the carry: the cap is 12, so six rats exactly fill it.
  sc.restore({ v: 1, night: 1, earned: 0, carry: { rat: 6, roach: 0 }, watchOwned: true, watchSold: false, critters: [], nextId: 1, respawnIn: 0, wasBroke: true, rng: sc.snapshot().rng });
  assert.equal(sc.sell().coins, 12);
  // Now carry more: nothing more can be paid tonight.
  sc.restore({ v: 1, night: 1, earned: 12, carry: { rat: 2, roach: 0 }, watchOwned: true, watchSold: false, critters: [], nextId: 1, respawnIn: 0, wasBroke: true, rng: sc.snapshot().rng });
  assert.deepEqual(sc.sell(), { ok: false, reason: 'capped' });
  assert.equal(sc.state().carried.total, 2, 'a capped sale keeps the bugs');
  // A new Night resets the cap.
  run.night = () => 2;
  sc.tick(0.1);
  assert.equal(sc.state().nightEarned, 0);
  const r = sc.sell();
  assert.equal(r.ok, true);
  assert.equal(r.coins, 4);
});

test('a partial cap pays only what is left and sells the lot', () => {
  const run = fakeRun({ coins: 0 });
  const sc = make(run);
  sc.restore({ v: 1, night: 1, earned: 10, carry: { rat: 3, roach: 0 }, watchOwned: true, watchSold: false, critters: [], nextId: 1, respawnIn: 0, wasBroke: false, rng: sc.snapshot().rng });
  const r = sc.sell();
  assert.deepEqual(r, { ok: true, n: 3, coins: 2 });
});

test('critters leave once the pocket covers a minimum bet again, the carry stays', () => {
  const run = fakeRun({ coins: 0 });
  const sc = make(run);
  sc.tick(0.1);
  const c = sc.state().critters[0];
  sc.catchById(c.id);
  run.coins = 5; // the pocket can play again
  sc.tick(0.1);
  assert.equal(sc.state().critters.length, 0);
  assert.equal(sc.state().carried.total, 1, 'what was caught can still be sold');
});

test('a batch comes back after the last critter is caught, while still broke', () => {
  const run = fakeRun({ coins: 0 });
  const sc = make(run);
  sc.tick(0.1);
  for (const c of sc.state().critters) sc.catchById(c.id);
  sc.sell();
  run.coins = 0; // the sale paid, the player spent it: still broke
  assert.equal(sc.state().critters.length, 0);
  ticks(sc, 45);
  assert.ok(sc.state().critters.length >= S.SCROUNGE_MIN_SPAWN, 'a new batch shows up');
});

test('the watch sells once per run, only while broke, for 8 coins', () => {
  const run = fakeRun({ coins: 20, bet: 5 });
  const sc = make(run);
  sc.tick(0.1);
  assert.equal(sc.state().canSellWatch, false, 'not broke');
  assert.deepEqual(sc.sellWatch(), { ok: false, reason: 'not-broke' });
  run.coins = 0;
  sc.tick(0.1);
  assert.equal(sc.state().canSellWatch, true);
  assert.deepEqual(sc.sellWatch(), { ok: true, coins: 8 });
  assert.equal(run.coins, 8);
  assert.equal(sc.state().watchOwned, false);
  assert.equal(sc.state().watchSold, true);
  run.coins = 0;
  assert.deepEqual(sc.sellWatch(), { ok: false, reason: 'gone' }, 'once per run');
  assert.equal(sc.state().canSellWatch, false);
});

test('the watch starts on the wrist', () => {
  const sc = make(fakeRun());
  assert.equal(sc.state().watchOwned, true);
  assert.equal(sc.state().watchSold, false);
});

test('save and restore keep the carry, the cap, the watch and the floor', () => {
  const run = fakeRun({ coins: 0 });
  const sc = make(run);
  sc.tick(0.1);
  const c = sc.state().critters[0];
  sc.catchById(c.id);
  sc.sell();
  sc.catchNear(-100, -100); // no-op, keeps the state live
  ticks(sc, 2);
  const save = JSON.parse(JSON.stringify(sc.snapshot()));

  const run2 = fakeRun({ coins: 0 });
  const back = make(run2, 1234);
  back.restore(save);
  assert.deepEqual(back.state().carried, sc.state().carried);
  assert.equal(back.state().nightEarned, sc.state().nightEarned);
  assert.deepEqual(back.state().critters, sc.state().critters);

  // The rng stream carries on from the same point: both scurry the same from here.
  ticks(sc, 5);
  ticks(back, 5);
  assert.deepEqual(back.state().critters, sc.state().critters);
});

test('a restored sold watch stays sold', () => {
  const sc = make(fakeRun());
  sc.restore({ v: 1, night: 1, earned: 0, carry: { rat: 0, roach: 0 }, watchOwned: true, watchSold: true, critters: [], nextId: 1, respawnIn: 0, wasBroke: false, rng: sc.snapshot().rng });
  assert.equal(sc.state().watchOwned, false);
  assert.equal(sc.state().watchSold, true);
});

test('restore ignores junk without throwing', () => {
  const sc = make(fakeRun());
  sc.restore(null);
  sc.restore('nope');
  assert.equal(sc.state().critters.length, 0);
  assert.equal(sc.state().carried.total, 0);
});
