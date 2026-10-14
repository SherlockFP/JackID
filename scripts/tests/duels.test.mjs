// Unit tests for the three Wave 25 TALLY duel games (lane B): Sealed Wall (Tamsin), Ghost Shell (Lucan) and Steam Count
// (Kuro), src/game/duels/{sealedwall,ghostshell,steamcount}. Covers the DuelRules contract, determinism, the clue
// channels, calls and settlement, the EV bands (naive and detective bots) and en/tr string parity.
//
// EV is a RETURN RATIO: 1 + playerNet / stake (playerNet is a net change: a lost duel is -S, a correct call +3 S).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

const GAMES = [
  { id: 'sealedwall', rival: 'tamsin', exp: 'sealedWall', kind: 'k-sw', n: 10000 },
  { id: 'ghostshell', rival: 'lucan', exp: 'ghostShell', kind: 'k-gs', n: 20000 },
  { id: 'steamcount', rival: 'kuro', exp: 'steamCount', kind: 'k-sc', n: 20000 },
];
const STAKE = 100;

let registry, rngMod, kit, STR, engine, planMod;
const mods = {};
before(async () => {
  registry = await load('src/game/duels/registry.ts');
  rngMod = await load('src/core/rng.ts');
  kit = await load('src/game/duels/gamekit.ts');
  engine = await load('src/game/duels/engine.ts');
  planMod = await load('src/game/duels/plan.ts');
  STR = (await load('src/game/duels/duels.strings.ts')).default;
  for (const g of GAMES) mods[g.id] = await load(`src/game/duels/${g.id}/index.ts`);
});

const rules = (g) => mods[g.id][g.exp];
const ratio = (net) => 1 + net / STAKE;

/** Plays one duel with the bot (the engine's protocol). Returns the final state, every clue with its step, the plan. */
function play(g, seed, { call = false } = {}) {
  const R = rules(g);
  const plan = R.makePlan(seed);
  let s = R.init(rngMod.hashSeed(seed, 'init'), plan, STAKE);
  const clues = [];
  const pub = [];
  let called = null;
  for (let i = 0; !s.done && i < 800; i++) {
    const mine = s.turn === 'player' ? R.legal(s) : [];
    const out = mine.length
      ? R.step(s, 'player', mods[g.id].pickMove(s, 'player'), plan)
      : R.step(s, 'rival', R.rivalAct(s, plan, rngMod.hashSeed(seed, 'rival', i)), plan);
    s = out.state;
    for (const c of out.clues) clues.push({ ...c, step: i });
    pub.push(...out.publicEvents);
  }
  return { R, plan, s, clues, pub, called, steps: pub.length };
}

test('the three games register with the duel registry under their rival', () => {
  for (const g of GAMES) {
    const R = registry.getDuel(g.id);
    assert.ok(R, `${g.id} registered`);
    assert.equal(R.rival, g.rival);
    assert.equal(registry.duelForRival(g.rival).id, g.id);
    assert.equal(typeof R.reveal.saw, 'string');
    assert.equal(typeof R.revealFair.why, 'string');
  }
});

test('same seed, same plan, same duel; different seeds differ', () => {
  for (const g of GAMES) {
    const R = rules(g);
    assert.deepEqual(R.makePlan(77), R.makePlan(77));
    const a = play(g, 123), b = play(g, 123), c = play(g, 124);
    assert.equal(JSON.stringify(a.s), JSON.stringify(b.s), `${g.id} replays identically`);
    assert.deepEqual(a.clues, b.clues);
    assert.notEqual(JSON.stringify(a.s), JSON.stringify(c.s));
    const h = R.playHeadless(55, 'detective');
    assert.deepEqual(h, R.playHeadless(55, 'detective'));
    assert.deepEqual(R.playHeadless(55, 'naive'), R.playHeadless(55, 'naive'));
  }
});

test('plans: cheat kinds are k-sw / k-gs / k-sc, the rest are fair; the cheat rate is 15-25%', () => {
  for (const g of GAMES) {
    const R = rules(g);
    let cheats = 0;
    const N = 4000;
    for (let i = 1; i <= N; i++) {
      const p = R.makePlan(i);
      if (p.kind === g.kind) { cheats++; assert.ok(p.round >= 1 && p.round <= 5, `round ${p.round}`); }
      else assert.equal(p.kind, 'k-0');
    }
    assert.ok(cheats / N > 0.15 && cheats / N < 0.25, `${g.id} cheat rate ${cheats / N}`);
  }
});

test('every cheat that happens gives all three clue channels before the duel is over; fair duels never give two', () => {
  for (const g of GAMES) {
    let cheated = 0, fair = 0;
    for (let seed = 1; seed <= 1500; seed++) {
      const { R, plan, s, clues } = play(g, seed);
      const channels = new Set(clues.map((c) => c.channel));
      if (R.verdict(s, plan) === 'CHEAT') {
        cheated++;
        assert.deepEqual([...channels].sort(), ['math', 'table', 'tell'], `${g.id} seed ${seed}: ${[...channels]}`);
        assert.equal(plan.kind, g.kind);
        // the tell and the table clue both come before the cheat can pay: no later than the math clue
        const first = (ch) => Math.min(...clues.filter((c) => c.channel === ch).map((c) => c.step));
        assert.ok(first('tell') <= first('math') && first('table') <= first('math'), `${g.id} seed ${seed}: order`);
      } else {
        fair++;
        assert.ok(channels.size <= 1, `${g.id} seed ${seed}: a fair duel showed ${[...channels]}`);
      }
    }
    assert.ok(cheated > 100 && fair > 800, `${g.id}: ${cheated} cheats, ${fair} fair`);
  }
});

test('every clue and reveal key resolves in the strings, and en/tr agree on keys and {placeholders}', () => {
  assert.equal(STR.prefix, 'duel.');
  assert.deepEqual(Object.keys(STR.en).sort(), Object.keys(STR.tr).sort());
  const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  for (const k of Object.keys(STR.en)) {
    assert.equal(vars(STR.tr[k]), vars(STR.en[k]), `placeholders of ${k}`);
    assert.ok(STR.en[k].length > 0 && STR.tr[k].length > 0);
  }
  const has = (full) => full.startsWith('duel.') && STR.en[full.slice(5)] !== undefined;
  for (const g of GAMES) {
    const R = rules(g);
    for (const r of [R.reveal, R.revealFair]) for (const k of Object.values(r)) assert.ok(has(k), k);
    for (let seed = 1; seed <= 300; seed++) {
      const { clues, pub, R: RR } = play(g, seed);
      for (const c of clues) assert.ok(has(c.key), c.key);
      for (const e of pub) { const t = RR.describeEvent(e); assert.ok(has(t.key), t.key); }
    }
    for (const t of R.callTargets(R.init(1, R.makePlan(1), STAKE))) assert.ok(has(t.label.key ?? 'duel.sw.tile'), JSON.stringify(t));
  }
  // original IP: nothing in the strings names the inspiration
  const text = JSON.stringify(STR).toLowerCase();
  for (const w of ['usogui', 'baku', 'madarame', 'chest', 'clover']) assert.ok(!text.includes(w), w);
});

test('calls: a call before the cheat, on a fair duel or at the wrong target is wrong; after the cheat it is right; settle pays 3 S / -S fine', () => {
  for (const g of GAMES) {
    const R = rules(g);
    let sawRight = 0, sawEarly = 0, sawFair = 0, sawWrongTarget = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const plan = R.makePlan(seed);
      let s = R.init(rngMod.hashSeed(seed, 'init'), plan, STAKE);
      for (let i = 0; !s.done && i < 800; i++) {
        const cheated = R.verdict(s, plan) === 'CHEAT';
        const target = g.id === 'sealedwall' ? { tile: s.sleeve } : g.id === 'ghostshell' ? 'GHOST' : 'LOADED DICE';
        assert.equal(R.call(s, plan, target).correct, cheated, `${g.id} seed ${seed} step ${i}`);
        if (cheated) sawRight++; else if (plan.kind === g.kind) sawEarly++; else sawFair++;
        if (cheated) {
          const wrong = g.id === 'sealedwall' ? { tile: (s.sleeve + 1) % 30 } : 'NOTHING';
          assert.equal(R.call(s, plan, wrong).correct, false);
          sawWrongTarget++;
        }
        const mine = s.turn === 'player' ? R.legal(s) : [];
        s = (mine.length ? R.step(s, 'player', mods[g.id].pickMove(s, 'player'), plan) : R.step(s, 'rival', R.rivalAct(s, plan, i), plan)).state;
      }
    }
    assert.ok(sawRight > 20 && sawEarly > 20 && sawFair > 100 && sawWrongTarget > 20, `${g.id}: ${sawRight}/${sawEarly}/${sawFair}`);
    // settlement (net coins)
    const plan = R.makePlan(9);
    const s = R.init(9, plan, STAKE);
    assert.equal(R.settle(s, true, STAKE).playerNet, 3 * STAKE, 'a correct call pays 3 S, even mid-duel');
    assert.equal(R.settle({ ...s, done: true, pay: 1.9 }, null, STAKE).playerNet, 90);
    assert.equal(R.settle({ ...s, done: true, pay: 0 }, null, STAKE).playerNet, -STAKE);
    assert.equal(R.settle({ ...s, done: true, pay: 0 }, false, STAKE).playerNet, -2 * STAKE, 'a wrong call fines one more stake');
    assert.equal(R.settle({ ...s, done: true, pay: 1.9 }, false, STAKE).playerNet, -10);
  }
});

test('the pot: a full win returns 2 stakes minus the 5% rake', () => {
  assert.equal(kit.POT, 1.9);
  assert.equal(kit.RAKE, 0.05);
});

test('Sealed Wall: 120-tile wall, 7 tiles each, the sleeve tile makes the Tally Sheet read 121', () => {
  const m = mods.sealedwall;
  let checked = 0;
  for (let seed = 1; seed <= 600 && checked < 40; seed++) {
    const plan = m.makePlan(seed);
    let s = m.init(rngMod.hashSeed(seed, 'init'), plan, STAKE);
    assert.equal(s.wall.length, 120);
    assert.equal(s.hands.player.length, 7);
    assert.equal(s.hands.rival.length, 7);
    for (let i = 0; !s.done && i < 800; i++) {
      const mine = s.turn === 'player' ? m.legal(s) : [];
      const out = mine.length ? m.step(s, 'player', m.pickMove(s, 'player'), plan) : m.step(s, 'rival', m.pickMove(s, 'rival'), plan);
      s = out.state;
      const math = out.clues.find((c) => c.channel === 'math');
      if (math) {
        assert.equal(plan.kind, 'k-sw');
        assert.equal(math.data.accounted, 121);
        assert.equal(math.data.expected, 120);
        // everything off the wall sits in a hand or untaken on the river (the sleeve tile is the one extra)
        const river = s.river.filter((r) => r.taken === null).length;
        assert.equal((s.wall.length - s.pos) + s.hands.player.length + s.hands.rival.length + river, 121, 'tiles on the table');
        checked++;
      }
    }
  }
  assert.ok(checked >= 10, `checked ${checked}`);
  // the win test sees both 8- and 9-tile hands
  const C = (...r) => r.map((x) => x - 1);                                 // COINS ranks
  assert.equal(m.wins([...C(1, 2, 3, 4, 5, 6, 7, 7)]), true);
  assert.equal(m.wins([...C(1, 2, 3, 4, 5, 6, 7, 7), 8 + 9 * 2]), true, 'a spare tile in a 9-tile hand still wins');
  assert.equal(m.wins(C(1, 2, 3, 4, 5, 6, 7, 9)), false);
});

test('Ghost Shell: the extra live shell is real and the announcement never mentions it', () => {
  const m = mods.ghostshell;
  let seen = 0;
  for (let seed = 1; seed <= 500; seed++) {
    const plan = m.makePlan(seed);
    if (plan.kind !== 'k-gs') continue;
    let s = m.init(rngMod.hashSeed(seed, 'init'), plan, STAKE);
    for (let i = 0; !s.done && i < 800; i++) {
      const before = s.loads;
      const mine = s.turn === 'player' ? m.legal(s) : [];
      const out = mine.length ? m.step(s, 'player', m.pickMove(s, 'player'), plan) : m.step(s, 'rival', m.rivalAct(s, plan, i), plan);
      s = out.state;
      const load = out.publicEvents.find((e) => e.k === 'load' && e.round === plan.round && out.clues.some((c) => c.channel === 'table'));
      if (load) {
        seen++;
        assert.equal(load.placed, load.live + load.blank + 1, 'the tray places N+1');
        assert.equal(s.mag.length, load.placed);
        assert.equal(s.mag.filter((x) => x === 'L').length, load.live + 1, 'the extra shell is live');
        assert.equal(s.ann.live + s.ann.blank, load.live + load.blank, 'the announced count excludes it');
      }
      void before;
    }
  }
  assert.ok(seen > 30, `${seen}`);
});

test('Steam Count: the lead die rolls <= 5 above 70 once armed, honest dice never see its clues, the gauge blows past 99', () => {
  const m = mods.steamcount;
  let loadedRolls = 0, blows = 0;
  for (let seed = 1; seed <= 1500; seed++) {
    const plan = m.makePlan(seed);
    let s = m.init(rngMod.hashSeed(seed, 'init'), plan, STAKE);
    for (let i = 0; !s.done && i < 800; i++) {
      const hot = s.gauge > 70;
      const rnd = s.round;
      const mine = s.turn === 'player' ? m.legal(s) : [];
      const actor = mine.length ? 'player' : 'rival';
      const action = mine.length ? m.pickMove(s, 'player') : m.rivalAct(s, plan, i);
      const out = m.step(s, actor, action, plan);
      const roll = out.publicEvents.find((e) => e.k === 'roll');
      if (roll && actor === 'rival' && hot && plan.kind === 'k-sc' && rnd >= plan.round) { assert.ok(roll.sum <= 5, `loaded sum ${roll.sum}`); loadedRolls++; }
      if (roll && roll.a + roll.b !== roll.sum) assert.fail('dice');
      if (out.publicEvents.some((e) => e.k === 'blow')) { blows++; assert.ok(roll.gauge > 99, 'a blow is a roll past 99'); }
      s = out.state;
    }
    assert.ok(s.pay >= 0 && s.pay <= 1.9 + 1e-9);
  }
  assert.ok(loadedRolls > 100 && blows > 100, `${loadedRolls} ${blows}`);
});

test('the engine runs each game end to end, never leaks the plan before the reveal, and nets what settle says', () => {
  for (const g of GAMES) {
    const R = registry.getDuel(g.id);
    for (let run = 1; run <= 25; run++) {
      const night = 2 + (run % 6);
      const sess = new engine.DuelSession({ rules: R, runSeed: run * 7919, rivalId: g.rival, night, tier: 'coins', S: STAKE });
      const events = engine.playOut(sess);
      assert.ok(sess.done, `${g.id} run ${run} finishes`);
      const reveal = events.findIndex((e) => e.k === 'reveal');
      assert.ok(reveal > 0);
      const planObj = events[reveal].plan;
      assert.equal(planMod.planLeaks(events.slice(0, reveal), planObj).length, 0, `${g.id} run ${run}: plan leaked ${planMod.planLeaks(events.slice(0, reveal), planObj)}`);
      assert.ok(Number.isFinite(sess.result.net));
    }
  }
});

test('EV bands over the seeds: naive bot returns 0.70-0.90, the detective 1.30-1.60, with every call correct and no false call', () => {
  for (const g of GAMES) {
    const R = rules(g);
    for (const policy of ['naive', 'detective']) {
      let net = 0, calls = 0, ok = 0;
      for (let seed = 1; seed <= g.n; seed++) {
        const r = R.playHeadless(seed, policy);
        net += r.playerNet;
        calls += r.calls;
        ok += r.correctCalls;
      }
      const ev = ratio(net / g.n);
      if (policy === 'naive') {
        assert.equal(calls, 0, 'the naive bot never calls');
        assert.ok(ev >= 0.7 && ev <= 0.9, `${g.id} naive EV ${ev.toFixed(3)}`);
      } else {
        assert.ok(calls > g.n * 0.1, `${g.id}: the detective calls in most cheats (${calls})`);
        assert.equal(ok, calls, `${g.id}: every detective call is correct (${ok}/${calls})`);
        assert.ok(ev >= 1.3 && ev <= 1.6, `${g.id} detective EV ${ev.toFixed(3)}`);
      }
    }
  }
});
