// Unit tests for the six Wave 25 TALLY duel games (lane B): Sealed Wall (Tamsin), Ghost Shell (Lucan) and Steam Count
// (Kuro), plus the phase 2 games Locker Shuffle (Mimosa), The Question (Orrin) and The Last Count (Vell, who throws the
// match: always a cheat, never punishes, EV bands do not apply), src/game/duels/<game>. Covers the DuelRules contract, determinism, the clue
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
  { id: 'lockershuffle', rival: 'mimosa', exp: 'lockerShuffle', kind: 'k-ls', n: 20000 },
  { id: 'thequestion', rival: 'orrin', exp: 'theQuestion', kind: 'k-tq', n: 20000 },
  { id: 'lastcount', rival: 'vell', exp: 'lastCount', kind: 'k-lc', n: 4000, always: true },
];
/** The games whose rival cheats at a rate (Vell always throws: no fair duels, no EV band). */
const RATED = GAMES.filter((g) => !g.always);
const STAKE = 100;
const TARGET = { ghostshell: 'GHOST', steamcount: 'LOADED DICE', lockershuffle: 'SPARE KEY', thequestion: 'MARKED DECK', lastcount: 'THROWN MATCH' };

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

test('the six games register with the duel registry under their rival', () => {
  for (const g of GAMES) {
    const R = registry.getDuel(g.id);
    assert.ok(R, `${g.id} registered`);
    assert.equal(R.rival, g.rival);
    // Lucan plays Rock, Paper, Promise now (src/game/duels/promise, loaded by the engine and its tests): Ghost Shell stays registered behind it
    assert.equal(registry.duelForRival(g.rival).id, g.rival === 'lucan' && registry.getDuel('promise') ? 'promise' : g.id);
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

test('plans: cheat kinds are k-sw / k-gs / k-sc / k-ls / k-tq, the rest are fair; the cheat rate is 15-25%; Vell always throws', () => {
  for (let i = 1; i <= 200; i++) assert.equal(rules(GAMES[5]).makePlan(i).kind, 'k-lc');
  for (const g of RATED) {
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
    if (g.always) assert.ok(cheated === 1500 && fair === 0, `${g.id}: ${cheated} cheats, ${fair} fair`);
    else assert.ok(cheated > 100 && fair > 800, `${g.id}: ${cheated} cheats, ${fair} fair`);
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
        const target = g.id === 'sealedwall' ? { tile: s.sleeve } : TARGET[g.id];
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
    assert.ok(sawRight > 20 && sawEarly > 20 && sawWrongTarget > 20 && (g.always ? sawFair === 0 : sawFair > 100), `${g.id}: ${sawRight}/${sawEarly}/${sawFair}`);
    // settlement (net coins)
    const plan = R.makePlan(9);
    const s = R.init(9, plan, STAKE);
    assert.equal(R.settle(s, true, STAKE).playerNet, 3 * STAKE, 'a correct call pays 3 S, even mid-duel');
    assert.equal(R.settle({ ...s, done: true, pay: 1.9 }, null, STAKE).playerNet, 90);
    assert.equal(R.settle({ ...s, done: true, pay: 0 }, null, STAKE).playerNet, -STAKE);
    if (g.always) {
      assert.equal(R.settle({ ...s, done: true, pay: 1.9 }, false, STAKE).playerNet, 90, 'a wrong call on Vell is never fined');
      assert.equal(R.settle({ ...s, done: true, pay: 0 }, false, STAKE).playerNet, -STAKE);
    } else {
      assert.equal(R.settle({ ...s, done: true, pay: 0 }, false, STAKE).playerNet, -2 * STAKE, 'a wrong call fines one more stake');
      assert.equal(R.settle({ ...s, done: true, pay: 1.9 }, false, STAKE).playerNet, -10);
    }
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
  for (const g of RATED) {
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

// ── phase 2: Locker Shuffle (Mimosa), The Question (Orrin), The Last Count (Vell) ─────────────────────────────────
const stepper = (g, seed) => {
  const R = rules(g), m = mods[g.id];
  const plan = R.makePlan(seed);
  let s = R.init(rngMod.hashSeed(seed, 'init'), plan, STAKE);
  let i = 0;
  const next = () => {
    const mine = s.turn === 'player' ? R.legal(s) : [];
    const actor = mine.length ? 'player' : 'rival';
    const out = mine.length ? R.step(s, 'player', m.pickMove(s, 'player'), plan) : R.step(s, 'rival', R.rivalAct(s, plan, rngMod.hashSeed(seed, 'rival', i++)), plan);
    s = out.state;
    return { ...out, actor };
  };
  return { R, plan, get s() { return s; }, next };
};

test('Locker Shuffle: she announces N swaps and makes N (N + 1 under the spare key); the prize is never under a picked locker once the key is in play', () => {
  const g = GAMES[3];
  let cheats = 0, fairRounds = 0;
  for (let seed = 1; seed <= 1500; seed++) {
    const t = stepper(g, seed);
    let announced = 0, swaps = 0;
    while (!t.s.done) {
      const round = t.s.round;
      const { publicEvents: ev, actor } = t.next();
      for (const e of ev) {
        if (e.k === 'announce') { announced = e.n; swaps = 0; }
        if (e.k === 'swap') swaps++;
      }
      if (actor === 'rival') {
        const armed = t.plan.kind === 'k-ls' && round >= t.plan.round;
        assert.equal(swaps, announced + (armed ? 1 : 0), `seed ${seed} round ${round}: swaps ${swaps} vs announced ${announced}`);
        if (armed) cheats++; else fairRounds++;
      } else {
        const open = ev.find((e) => e.k === 'open');
        if (t.plan.kind === 'k-ls' && round >= t.plan.round) assert.equal(open.found, false, 'the prize is never under the locker you pick');
      }
    }
  }
  assert.ok(cheats > 200 && fairRounds > 3000, `${cheats} ${fairRounds}`);
});

test('Locker Shuffle: the clues arrive tell (the shuffle), then table and math (the pick) and name the numbers', () => {
  const g = GAMES[3];
  let seen = 0;
  for (let seed = 1; seed <= 600 && seen < 60; seed++) {
    const t = stepper(g, seed);
    if (t.plan.kind !== 'k-ls') continue;
    const order = [];
    while (!t.s.done) for (const c of t.next().clues) { order.push(c.channel); if (c.channel === 'math') assert.equal(c.data.counted, c.data.announced + 1); }
    assert.deepEqual(order, ['tell', 'table', 'math']);
    seen++;
  }
  assert.ok(seen >= 60);
});

test('The Question: the deck holds 40 (stock + pile + 4 in hand) until the marked deck adds a card; Orrin only raises ahead when it is marked', () => {
  const g = GAMES[4];
  let cheats = 0, readsRight = 0, honestRaises = 0;
  for (let seed = 1; seed <= 1200; seed++) {
    const t = stepper(g, seed);
    const marked = t.plan.kind === 'k-tq';
    while (!t.s.done) {
      const before = t.s, roundBefore = before.round;
      const armed = marked && roundBefore >= t.plan.round;
      const { publicEvents: ev, actor } = t.next();
      for (const e of ev) if (e.k === 'deal') {
        const total = e.stock + e.pile + 4;
        assert.equal(total, marked && e.round >= t.plan.round ? 41 : 40, `seed ${seed} round ${e.round}`);
      }
      if (actor === 'rival' && ev.some((e) => e.k === 'raise')) {
        if (armed) { assert.ok(before.stand.rival > before.stand.player, 'a marked raise is only made when ahead'); readsRight++; }
        else honestRaises++;
      }
      if (actor === 'rival' && armed) cheats++;
    }
  }
  assert.ok(cheats > 300 && readsRight > 50 && honestRaises > 200, `${cheats} ${readsRight} ${honestRaises}`);
});

test('The Question: points, folds and the push are scored right; a match ends at 5 points or after 7 rounds', () => {
  const g = GAMES[4];
  let ended5 = 0, endedRounds = 0, draws = 0;
  for (let seed = 1; seed <= 2000; seed++) {
    const t = stepper(g, seed);
    while (!t.s.done) t.next();
    const s = t.s;
    assert.ok(s.round <= 7);
    assert.ok(s.pts.player <= 6 && s.pts.rival <= 6);
    if (s.pts.player >= 5 || s.pts.rival >= 5) ended5++; else { endedRounds++; assert.equal(s.round, 7); }
    if (s.winner === undefined) { draws++; assert.equal(s.pay, kit.POT / 2); assert.equal(s.pts.player, s.pts.rival); }
    else assert.equal(s.pay, s.winner === 'player' ? kit.POT : 0);
  }
  assert.ok(ended5 > 500 && endedRounds > 20 && draws >= 1, `${ended5} ${endedRounds} ${draws}`);
});

test('The Last Count: Vell guesses 3 of the 7 cards, misses every one, never wins; the guest takes the pot unless he calls it', () => {
  const g = GAMES[5];
  for (let seed = 1; seed <= 600; seed++) {
    const t = stepper(g, seed);
    assert.equal(t.s.tape.length, 8);
    let throws = 0;
    while (!t.s.done) {
      const { publicEvents: ev, actor } = t.next();
      if (actor === 'rival') { throws++; assert.ok(ev.some((e) => e.k === 'result' && e.hit === false), `seed ${seed}: Vell must miss`); }
    }
    assert.equal(throws, 3);
    assert.equal(t.s.pts.rival, 0);
    assert.equal(t.s.winner, 'player');
    assert.equal(t.s.pay, kit.POT);
    assert.equal(t.R.settle(t.s, null, STAKE).playerNet, 90);
  }
  const R = rules(g);
  for (const policy of ['naive', 'detective']) {
    let calls = 0, ok = 0;
    for (let seed = 1; seed <= 500; seed++) {
      const r = R.playHeadless(seed, policy);
      calls += r.calls; ok += r.correctCalls;
      assert.equal(r.playerNet, policy === 'naive' ? 90 : 3 * STAKE);
    }
    if (policy === 'naive') assert.equal(calls, 0);
    else { assert.equal(ok, 500); assert.equal(calls, 500); }
  }
});

test('The Last Count: onVellCalled fires once per duel, only on a correct call; a wrong or early call is never fined', () => {
  const m = mods.lastcount, R = m.lastCount;
  m.resetVellCalled();
  const got = [];
  const off = m.onVellCalled((i) => got.push(i.seed));
  const plan = R.makePlan(5);
  let s = R.init(rngMod.hashSeed(5, 'init'), plan, STAKE);
  assert.equal(R.call(s, plan, 'THROWN MATCH').correct, false, 'nothing has been thrown yet');
  assert.equal(R.call(s, plan, 'NOTHING').correct, false);
  assert.deepEqual(got, []);
  s = R.step(s, 'player', m.pickMove(s), plan).state;
  s = R.step(s, 'rival', R.rivalAct(s, plan, 1), plan).state;
  assert.equal(R.call(s, plan, 'NOTHING').correct, false);
  assert.deepEqual(got, []);
  assert.equal(R.call(s, plan, 'THROWN MATCH').correct, true);
  assert.equal(R.call(s, plan, { call: 'THROWN MATCH' }).correct, true);
  assert.deepEqual(got, [s.seed], 'one duel, one event');
  assert.equal(R.settle(s, false, STAKE).playerNet, R.settle(s, null, STAKE).playerNet, 'a wrong call costs nothing');
  off();
  m.resetVellCalled();
  R.call(s, plan, 'THROWN MATCH');
  assert.deepEqual(got, [s.seed], 'unsubscribed');
});

test('The Last Count: through the engine a correct call ends the duel peacefully at once, and the hook fires', () => {
  const m = mods.lastcount;
  m.resetVellCalled();
  let fired = 0;
  const off = m.onVellCalled(() => { fired++; });
  const sess = new engine.DuelSession({ rules: registry.getDuel('lastcount'), runSeed: 777, rivalId: 'vell', night: 8, boss: true, tier: 'soul', S: STAKE });
  const ev = engine.playOut(sess, (actions, s) => (s.state.round >= 3 ? { act: 0, call: 0 } : { act: 0 }));
  off();
  assert.equal(sess.done, true);
  assert.equal(sess.result.calledCorrect, true);
  assert.equal(sess.result.net, 3 * STAKE);
  assert.equal(sess.result.won, true);
  assert.equal(fired, 1);
  const ruling = ev.find((e) => e.k === 'ruling');
  assert.equal(ruling.verdict, 'CHEAT');
  assert.equal(ruling.byCall, true);
});

test('story data: every rival points at a registered duel, phase 2 is live, the scenes and strings exist', async () => {
  const RIV = await load('src/game/story/duels/rivals.ts');
  const SC = await load('src/game/story/duels/scenes.ts');
  const ST = (await load('src/game/story/duels/rivals.strings.ts')).default;
  const END = await load('src/game/story/duels/ending.ts');
  for (const r of Object.values(RIV.RIVALS)) {
    const d = registry.getDuel(r.duel);
    assert.ok(d, `${r.id}: duel ${r.duel} is registered`);
    assert.equal(d.rival, r.id);
    assert.equal(registry.duelForRival(r.id).id, r.duel);
    for (const k of ['catch', 'intro', 'taunt', 'called', 'loss']) assert.ok(r.lines[k], `${r.id}.${k}`);
  }
  assert.equal(RIV.bossRivalFor(6)?.id, 'orrin');
  assert.equal(RIV.bossRivalFor(8)?.id, 'vell');
  assert.equal(RIV.bossRivalFor(6, { phase2: false }), null);
  assert.deepEqual(RIV.rivalsForNight(4).map((s) => s.rival.id), ['tamsin', 'mimosa']);
  assert.deepEqual(RIV.rivalsForNight(4, { phase2: false }).map((s) => s.rival.id), ['tamsin']);
  assert.equal(RIV.RIVALS.orrin.drops[0], 'manager_key');
  // scenes: ids and subtitle keys
  const en = Object.fromEntries(Object.entries(ST.en).map(([k, v]) => [ST.prefix + k, v]));
  assert.deepEqual(Object.keys(ST.en).sort(), Object.keys(ST.tr).sort());
  const ph = (x) => (x.match(/\{\w+\}/g) ?? []).sort().join();
  for (const k of Object.keys(ST.en)) assert.equal(ph(ST.en[k]), ph(ST.tr[k]), k);
  const scenes = [];
  for (const id of SC.phase2SceneIds()) {
    const mod = await load(`src/game/story/duels/cutscenes/${id}.cutscene.ts`);
    assert.equal(mod.default.id, id);
    scenes.push(mod.default);
  }
  assert.equal(scenes.length, 10);
  for (const sc of scenes) for (const tr of sc.tracks) if (tr.kind === 'subtitle') for (const c of tr.cues) assert.ok(en[c.key], `${sc.id}: ${c.key}`);
  const orrin = scenes.find((x) => x.id === 'duel_orrin_intro');
  const keys = orrin.tracks.find((tr) => tr.kind === 'subtitle').cues.map((c) => c.key);
  assert.ok(keys.includes('story.duel.terms.intro') && keys.includes('story.duel.line.clerk.ledger'), 'Orrin announces the Terms and the Clerk speaks');
  // the ending hook
  assert.equal(END.isVellRelease({ rivalId: 'vell', calledCorrect: true }), true);
  assert.equal(END.isVellRelease({ rivalId: 'vell', calledCorrect: null }), false);
  assert.equal(END.isVellRelease({ rivalId: 'orrin', calledCorrect: true }), false);
  assert.equal(END.onVellCalled, mods.lastcount.onVellCalled, 'the story hook is the duel hook');
});
