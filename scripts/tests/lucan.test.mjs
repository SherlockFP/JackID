// LUCAN'S TABLE (Rock, Paper, Promise as the Night 3 boss duel, src/game/duels/promise/lucan.ts, STORY_BIBLE S4): the registry,
// Lucan's calls (kept early, broken at the winning throw), the watch mirror (always answers right), the three clues in order, the
// call, both counter-cheats (the photo and the late switch), the rewards, the engine run (no plan leak, exact replay), balance and strings.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let L, R, E, P, RNG, REG, RIV, GK, STR, PSTR;
before(async () => {
  REG = await load('src/game/duels/registry.ts');
  await load('src/game/duels/ghostshell/index.ts');
  L = await load('src/game/duels/promise/lucan.ts');
  await load('src/game/duels/promise/index.ts');
  R = L.lucanDuel;
  E = await load('src/game/duels/engine.ts');
  P = await load('src/game/duels/plan.ts');
  RNG = await load('src/core/rng.ts');
  RIV = await load('src/game/story/duels/rivals.ts');
  GK = await load('src/game/duels/gamekit.ts');
  STR = (await load('src/game/duels/promise/lucan.strings.ts')).default;
  PSTR = (await load('src/machines/tallytable/strings.ts')).STRINGS;
});

const HANDS = ['rock', 'paper', 'scissors'];
const counter = { rock: 'paper', paper: 'scissors', scissors: 'rock' };
const loser = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
const plan = (seed = 5) => R.makePlan(seed);
const fresh = (seed = 11) => R.init(seed, plan(), 100);
const player = (s, a) => R.step(s, 'player', a, plan());
const rival = (s) => R.step(s, 'rival', R.rivalAct(s), plan());
/** The state with the player to call (as if Lucan's round was over). */
const myCall = (seed) => { const s = fresh(seed); return { ...s, phase: 'promise', turn: 'player', m: { ...s.m, caller: 'a' } }; };

/** One round the player calls: promise, throw, Lucan answers. Returns the state after the answer (a late phase may be open). */
function ownRound(s, promise, thrown, acc = { clues: [], ev: [] }) {
  let o = player(s, { k: 'promise', hand: promise }); acc.ev.push(...o.publicEvents);
  o = player(o.state, { k: 'throw', hand: thrown }); acc.ev.push(...o.publicEvents);
  o = rival(o.state); acc.clues.push(...o.clues); acc.ev.push(...o.publicEvents);
  return o.state;
}
/** One round Lucan calls: he announces, the player answers with `pick(state)` or a hand. */
function hisRound(s, pick, acc = { clues: [], ev: [] }) {
  let o = rival(s); acc.ev.push(...o.publicEvents);
  o = player(o.state, { k: 'throw', hand: typeof pick === 'function' ? pick(o.state) : pick }); acc.ev.push(...o.publicEvents);
  return o.state;
}
const holdIfLate = (s) => (s.phase === 'late' ? player(s, { k: 'hold' }).state : s);

/** Plays rounds (answering his calls with the counter, holding in the late phase) until `n` throws were answered. */
function playUntilAnswered(seed, n, acc) {
  let s = fresh(seed);
  let guard = 0;
  while (!s.done && s.ans < n && guard++ < 40) {
    s = s.phase === 'lcall' ? hisRound(s, (x) => counter[x.promise], acc) : holdIfLate(ownRound(s, 'rock', 'rock', acc));
  }
  return s;
}

test('registry: Lucan plays Promise, Ghost Shell stays registered, the story data points at it', () => {
  assert.equal(REG.duelForRival('lucan').id, 'promise');
  assert.ok(REG.getDuel('ghostshell'), 'ghost shell is untouched');
  assert.equal(RIV.RIVALS.lucan.duel, 'promise');
  assert.equal(REG.getDuel('promise').rival, 'lucan');
});

test('the match: first to 4, Lucan calls first, callers alternate, his promise is public and his throw is not', () => {
  let s = fresh();
  assert.equal(s.m.goal, 4);
  assert.equal(s.turn, 'rival');
  assert.deepEqual(R.legal(s), []);
  const o = rival(s);
  assert.equal(o.publicEvents[0].k, 'say');
  assert.equal(o.state.turn, 'player');
  assert.deepEqual(R.legal(o.state).map((a) => a.k), ['throw', 'throw', 'throw']);
  assert.ok(!JSON.stringify(o.publicEvents).includes('"his"'));
  s = hisRound(s, 'rock');
  assert.equal(s.m.caller, 'a');
  assert.deepEqual(R.legal(s).map((a) => a.k), ['promise', 'promise', 'promise']);
});

test('Lucan keeps early promises and breaks at the winning throw (readable, but not certain)', () => {
  let keptEarly = 0, brokeWin = 0;
  for (let i = 1; i <= 400; i++) {
    const early = L.lucanCall(L.init(i, plan(), 1).m, i);
    if (early.throw === early.promise) keptEarly++;
    const m = { ...L.init(i, plan(), 1).m, seats: { a: { points: 0, cracks: 0 }, b: { points: 3, cracks: 0 } } };
    const win = L.lucanCall(m, i);
    assert.equal(win.winning, true);
    if (win.throw !== win.promise) { brokeWin++; assert.equal(win.throw, loser[win.promise], 'the break is the hand that beats a believer'); }
  }
  assert.ok(keptEarly / 400 > 0.8, `kept early ${keptEarly}`);
  assert.ok(brokeWin / 400 > 0.75, `broke at the winning throw ${brokeWin}`);
  // on his last crack he keeps his word, even at the winning throw
  const edge = { ...L.init(1, plan(), 1).m, seats: { a: { points: 0, cracks: 0 }, b: { points: 3, cracks: 2 } } };
  for (let i = 1; i <= 50; i++) { const c = L.lucanCall(edge, i); assert.equal(c.throw, c.promise); }
});

test('the winning-throw call carries the Eye cut flag, an early one does not', () => {
  let o = rival(fresh(3));
  assert.equal(R.describeEvent(o.publicEvents[0]).data, undefined);
  const s = { ...fresh(3), m: { ...fresh(3).m, seats: { a: { points: 0, cracks: 0 }, b: { points: 3, cracks: 0 } } } };
  o = rival(s);
  assert.equal(R.describeEvent(o.publicEvents[0]).data?.eye, 1);
});

test('the watch mirror: every throw he answers is answered right, and the clues come TELL, TABLE, MATH', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const thrown = HANDS[seed % 3];
    let o = player(player(myCall(seed), { k: 'promise', hand: thrown }).state, { k: 'throw', hand: thrown });
    const out = rival(o.state);
    const hands = out.publicEvents.find((e) => e.k === 'hands');
    assert.equal(hands.him, counter[thrown], 'he counters the hand he saw');
  }
  const acc = { clues: [], ev: [] };
  const s = playUntilAnswered(2, 3, acc);
  assert.ok(s.ans >= 3 || s.done);
  const main = acc.clues.filter((c) => c.key !== 'duel.pr.tell.look').map((c) => c.channel);
  assert.deepEqual(main.slice(0, 3), ['tell', 'table', 'math']);
});

test('clue data: the TELL and the TABLE carry the Gambler\'s Eye, the MATH is a Tally line with the numbers', () => {
  const acc = { clues: [], ev: [] };
  playUntilAnswered(2, 3, acc);
  const by = (k) => acc.clues.find((c) => c.key === k);
  assert.equal(by('duel.pr.tell.glance').channel, 'tell');
  assert.equal(by('duel.pr.tell.glance').data.eye, 'watch');
  assert.equal(by('duel.pr.table.glass').channel, 'table');
  assert.equal(by('duel.pr.table.glass').data.eye, 'glass');
  assert.equal(by('duel.pr.table.glass').data.hand, 'rock');
  const math = by('duel.pr.math.answered');
  assert.equal(math.channel, 'math');
  assert.equal(math.data.n, 3);
  assert.equal(math.data.won, 3);
});

test('he glances only when he answers: no tell on his own calls', () => {
  const o = rival(fresh(9));
  assert.deepEqual(o.clues, []);
  const t = player(o.state, { k: 'throw', hand: 'rock' });
  assert.deepEqual(t.clues, []);
});

test('the call: MIRROR is right once he has answered a throw with the mirror live, wrong before, and the verdict follows', () => {
  let s = fresh(4);
  assert.equal(R.call(s, plan(), 'MIRROR').correct, false);
  assert.equal(R.verdict(s, plan()), 'FAIR');
  s = ownRound(myCall(4), 'rock', 'rock');
  assert.equal(s.cheated, true);
  assert.equal(R.call(s, plan(), 'MIRROR').correct, true);
  assert.equal(R.call(s, plan(), 'CHEAT').correct, false);
  assert.equal(R.verdict(s, plan()), 'CHEAT');
  assert.equal(R.callTargets(s)[0].target, 'MIRROR');
});

test('settlement: a right call is +3S, no call is the match result, a wrong call is a fine', () => {
  const s = ownRound(myCall(4), 'rock', 'rock');
  assert.equal(R.settle(s, true, 100).playerNet, 300);
  assert.equal(R.settle(s, false, 100).playerNet, -200);
  assert.equal(R.settle({ ...s, done: true, winner: 'player', pay: GK.POT }, null, 100).playerNet, 90);
  assert.equal(R.settle({ ...s, done: true, winner: 'rival', pay: 0 }, null, 100).playerNet, -100);
});

test('counter-cheat PHOTO: offered only with the keepsake, blinds the mirror for good, makes a call wrong and the verdict fair', () => {
  const off = L.setPhotoSource(() => false);
  const s0 = hisRound(fresh(6), 'rock');
  assert.ok(!R.legal(s0).some((a) => a.k === 'photo'), 'no photo without the keepsake');
  off();
  const dispose = L.setPhotoSource(() => true);
  try {
    assert.ok(R.legal(s0).some((a) => a.k === 'photo'));
    const o = player(s0, { k: 'photo' });
    assert.equal(o.state.mirror, false);
    assert.equal(o.state.photo, true);
    assert.equal(R.describeEvent(o.publicEvents[0]).key, 'duel.pr.ev.photo');
    assert.ok(!R.legal(o.state).some((a) => a.k === 'photo'), 'only once');
    // he now answers by nerve alone: not right every time, and no clue rings
    let theirs = 0, clues = 0;
    const n = 150;
    for (let seed = 1; seed <= n; seed++) {
      let t = player(myCall(seed), { k: 'photo' }).state;
      t = player(t, { k: 'promise', hand: 'rock' }).state;
      t = player(t, { k: 'throw', hand: 'rock' }).state;
      const out = rival(t);
      clues += out.clues.length;
      if (out.publicEvents.some((e) => e.k === 'out' && e.who === 'him')) theirs++;
      assert.equal(out.state.cheated, false);
    }
    assert.equal(clues, 0);
    assert.ok(theirs < n * 0.8, `the blind mirror does not always win (${theirs}/${n})`);
    assert.equal(R.call(o.state, plan(), 'MIRROR').correct, false);
    assert.equal(R.verdict(o.state, plan()), 'FAIR');
  } finally { dispose(); }
});

/** A state in the late phase (mirror live, third answer), with `looks` as wanted. */
function lateState(wantLook) {
  for (let k = 1; k <= 500; k++) {
    const seed = 1 + k * 101;
    let s = playUntilAnswered(seed, 1, { clues: [], ev: [] });
    if (!s.done && s.phase === 'lcall') s = hisRound(s, 'rock');
    if (s.done || s.phase !== 'promise') continue;
    let o = player(s, { k: 'promise', hand: 'rock' }); o = player(o.state, { k: 'throw', hand: 'rock' });
    o = rival(o.state);
    if (o.state.phase === 'late' && o.state.looks === wantLook) return { late: o.state, clues: o.clues };
  }
  throw new Error('no late state found');
}

test('counter-cheat SWITCH: offered from his second answered throw; if he looks it is a FOUL (his point, your crack); if not, it stands', () => {
  const looked = lateState(true);
  assert.deepEqual(R.legal(looked.late).map((a) => a.k), ['hold', 'switch', 'switch']);
  assert.ok(looked.clues.some((c) => c.key === 'duel.pr.tell.look' && c.channel === 'tell' && c.data.eye === 'watch'), 'his glance is a TELL');
  const pointsBefore = looked.late.m.seats.b.points, cracksBefore = looked.late.m.seats.a.cracks;
  const foul = player(looked.late, R.legal(looked.late).find((a) => a.k === 'switch'));
  assert.ok(foul.publicEvents.some((e) => e.k === 'foul'));
  assert.equal(foul.state.m.seats.b.points, pointsBefore + 1);
  assert.equal(foul.state.m.seats.a.cracks, cracksBefore + 1);
  assert.equal(foul.state.fouls, 1);

  const quiet = lateState(false);
  assert.ok(!quiet.clues.some((c) => c.key === 'duel.pr.tell.look'), 'he did not look: no tell');
  // I threw rock, he answered paper; scissors beats paper
  const win = player(quiet.late, { k: 'switch', hand: 'scissors' });
  assert.ok(win.publicEvents.some((e) => e.k === 'switchok'));
  assert.ok(win.publicEvents.some((e) => e.k === 'out' && e.who === 'you'));
  assert.equal(win.state.m.seats.a.cracks, quiet.late.m.seats.a.cracks + 1, 'switching away from the promise breaks it');
  assert.equal(win.state.switched, true);
  const hold = player(quiet.late, { k: 'hold' });
  assert.ok(hold.publicEvents.some((e) => e.k === 'out' && e.who === 'him'));
  // one switch a duel
  const next = win.state.done ? null : win.state;
  if (next && next.turn === 'player') assert.ok(!R.legal(next).some((a) => a.k === 'switch'));
});

test('rewards: a kept-word win is a ŞANS star (max 2), each crack of yours is one Heat', () => {
  assert.deepEqual(R.rewards(fresh(8)), { stars: 0, cracks: 0, kept: 0 });
  assert.equal(R.rewards({ ...fresh(8), kept: 5 }).stars, 2);
  assert.equal(R.rewards({ ...fresh(8), kept: 1 }).stars, 1);
  // a kept word that wins: blind mirror, search for a seed where his weighted answer loses to my rock
  let kept = null;
  for (let seed = 1; seed <= 200 && !kept; seed++) {
    let t = { ...myCall(seed), mirror: false };
    t = player(t, { k: 'promise', hand: 'rock' }).state;
    t = player(t, { k: 'throw', hand: 'rock' }).state;
    const o = rival(t);
    if (o.publicEvents.some((e) => e.k === 'kept' && e.who === 'you')) kept = o.state;
  }
  assert.ok(kept, 'a kept-word win exists');
  assert.equal(R.rewards(kept).kept, 1);
  assert.equal(R.rewards(kept).stars, 1);
  assert.equal(kept.m.seats.a.points, 2);
  // a broken word of yours cracks and costs a Heat
  const broke = holdIfLate(ownRound(myCall(21), 'rock', 'paper'));
  assert.equal(R.rewards(broke).cracks, 1);
});

test('the whole duel through the engine: ends, never leaks the plan or his hand, and replays exactly from the recorded input', () => {
  for (const seed of [3, 9, 27]) {
    const opts = { rules: R, runSeed: seed, rivalId: 'lucan', night: 3, boss: true, tier: 'coins', S: 60 };
    const s = new E.DuelSession(opts);
    const planNow = R.makePlan(P.planSeedOf(seed, 'lucan', 3));
    const evs = E.playOut(s, (actions) => ({ act: Math.min(1, actions.length - 1) }));
    assert.ok(s.done && s.result);
    const pre = evs.filter((e) => e.k !== 'reveal');
    assert.deepEqual(P.planLeaks(pre, planNow), [], 'no plan fragment before the reveal');
    assert.ok(!JSON.stringify(pre).includes('"his"'));
    const rev = evs.find((e) => e.k === 'reveal');
    assert.ok(rev && rev.plan.kind === 'k-pm');
    const again = E.DuelSession.restore(opts, s.replayLog(), s.version);
    assert.equal(JSON.stringify(again.state.m), JSON.stringify(s.state.m));
  }
});

test('a right call through the engine ends the duel at once in the player\'s favour', () => {
  const opts = { rules: R, runSeed: 41, rivalId: 'lucan', night: 3, boss: true, tier: 'coins', S: 50 };
  const s = new E.DuelSession(opts);
  s.begin();
  let guard = 0, called = false;
  while (!s.done && guard++ < 200) {
    if (s.toMove() === 'rival') { s.rivalMove(); continue; }
    const p = s.prompt();
    if (s.state.cheated && p.canCall) { assert.ok(s.call(0, p.v).ok); called = true; break; }
    s.actIndex(0, p.v);
  }
  assert.ok(called && s.done);
  assert.equal(s.result.net, 150);
  assert.equal(s.result.verdict, 'CHEAT');
});

test('balance: ignoring the clues loses most of the time, reading the table and calling wins, a careful player has a real chance', () => {
  const n = 1500;
  const run = (policy) => {
    let net = 0, correct = 0, calls = 0;
    for (let i = 1; i <= n; i++) { const r = R.playHeadless(i * 7919, policy); net += r.playerNet; correct += r.correctCalls; calls += r.calls; }
    return { ev: 1 + net / n / 100, correct, calls };
  };
  const naive = run('naive'), detective = run('detective');
  assert.ok(naive.ev > 0.02 && naive.ev < 0.6, `naive EV ${naive.ev}`);
  assert.ok(detective.ev > 2 && detective.ev < 4.2, `detective EV ${detective.ev}`);
  assert.equal(detective.correct, detective.calls, 'a call after two channels is never wrong');
  // careful: believes his early promises, doubts his winning throw, keeps its own word, never calls
  let w = 0;
  const m = 800;
  for (let i = 1; i <= m; i++) {
    const pl = plan(i);
    let s = R.init(RNG.hashSeed(i * 31, 'init'), pl, 100);
    let g = 0;
    while (!s.done && g++ < 400) {
      if (s.turn === 'rival') { s = R.step(s, 'rival', R.rivalAct(s), pl).state; continue; }
      let a;
      if (s.phase === 'promise') a = { k: 'promise', hand: HANDS[s.m.round % 3] };
      else if (s.phase === 'throw') a = { k: 'throw', hand: s.m.caller === 'a' ? s.promise : (s.m.seats.b.points + 1 >= s.m.goal ? s.promise : counter[s.promise]) };
      else a = R.legal(s)[0];
      s = R.step(s, 'player', a, pl).state;
    }
    if (s.winner === 'player') w++;
  }
  assert.ok(w / m > 0.4 && w / m < 0.8, `careful win rate ${w / m}`);
});

test('strings: EN and TR have the same keys, every key the duel can name exists, and the plain-text rules hold', () => {
  assert.deepEqual(Object.keys(STR.en).sort(), Object.keys(STR.tr).sort());
  const have = (k) => k.startsWith('duel.') && Object.prototype.hasOwnProperty.call(STR.en, k.slice(5));
  const need = new Set();
  for (const h of HANDS) {
    for (const a of [{ k: 'promise', hand: h }, { k: 'throw', hand: h }, { k: 'switch', hand: h }, { k: 'photo' }, { k: 'hold' }, { k: 'lcall' }]) need.add(R.describeAction(a).key);
    for (const by of ['you', 'him']) need.add(R.describeEvent({ k: 'say', by, hand: h }).key);
    for (const g of HANDS) need.add(R.describeEvent({ k: 'hands', you: h, him: g }).key);
    need.add(`duel.pr.line.you.${h}`); need.add(`duel.pr.line.him.${h}`);
  }
  for (const who of ['you', 'him', 'tie']) need.add(R.describeEvent({ k: 'out', who, n: 1 }).key);
  for (const who of ['you', 'him']) { need.add(R.describeEvent({ k: 'kept', who }).key); need.add(R.describeEvent({ k: 'crack', who }).key); need.add(R.describeEvent({ k: 'end', who }).key); }
  for (const k of ['photo', 'answered', 'foul', 'switchok']) need.add(R.describeEvent({ k }).key);
  for (const t of [R.reveal, R.revealFair]) for (const k of Object.values(t)) need.add(k);
  for (const k of ['duel.pr.tell.glance', 'duel.pr.tell.look', 'duel.pr.table.glass', 'duel.pr.math.answered', 'duel.pr.eye.watch', 'duel.pr.eye.look', 'duel.pr.eye.glass', 'duel.pr.eye.wide', 'duel.pr.call', 'duel.pr.line.score', 'duel.pr.line.late', 'duel.pr.line.photo']) need.add(k);
  for (const k of need) assert.ok(have(k), `missing string ${k}`);
  for (const k of ['goalPromise', 'prRule1', 'prRule2', 'prRule3', 'prRule4', 'prRule5', 'prStars', 'prHeat']) {
    assert.ok(PSTR.en[k] && PSTR.tr[k], `machine string ${k}`);
  }
  for (const k of Object.keys(STR.en).filter((x) => x.startsWith('pr.eye.'))) assert.ok(STR.en[k].split(/\s+/).length <= 9, `${k} is a short thought`);
  for (const l of ['en', 'tr']) for (const [k, v] of Object.entries(STR[l])) assert.ok(!/[—;]/.test(v), `${l}.${k} has a dash or semicolon`);
});
