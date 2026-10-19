// ROCK, PAPER, PROMISE (src/game/duels/promise): the pure rules, the AI profiles with their seeded replay, the headless balance
// runs, and the kitchen-table flow (Ada) driven without a DOM.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

const R = await load('src/game/duels/promise/rules.ts');
const F = await load('src/game/duels/promise/flow.ts');
const S = (await load('src/game/duels/promise/promise.strings.ts')).default;

const round = (s, promise, callerThrow, answerThrow) => R.playRound(s, { promise, callerThrow, answerThrow });

test('hands: the cycle, counters and the third hand', () => {
  assert.ok(R.beats('rock', 'scissors') && R.beats('paper', 'rock') && R.beats('scissors', 'paper'));
  for (const h of R.HANDS) {
    assert.ok(R.beats(R.counterOf(h), h));
    assert.ok(R.beats(h, R.loserTo(h)));
    assert.equal(new Set([h, R.counterOf(h), R.loserTo(h)]).size, 3);
  }
});

test('scoring: a kept-word win is 2, any other win is 1, a tie is 0', () => {
  const s = R.createMatch({ first: 'a' });
  let r = round(s, 'rock', 'rock', 'scissors');             // kept, caller wins
  assert.equal(r.entry.points, 2); assert.equal(r.state.seats.a.points, 2); assert.equal(r.state.seats.a.cracks, 0);
  r = round(s, 'rock', 'rock', 'paper');                    // kept, answerer wins
  assert.equal(r.entry.points, 1); assert.equal(r.state.seats.b.points, 1);
  r = round(s, 'rock', 'paper', 'rock');                    // broke and won
  assert.equal(r.entry.points, 1); assert.equal(r.state.seats.a.points, 1); assert.equal(r.state.seats.a.cracks, 1);
  r = round(s, 'rock', 'rock', 'rock');                     // tie
  assert.equal(r.entry.points, 0); assert.equal(r.entry.winner, null);
  r = round(s, 'rock', 'scissors', 'scissors');             // broke into a tie: still a crack
  assert.equal(r.entry.winner, null); assert.equal(r.state.seats.a.cracks, 1);
  assert.equal(s.round, 1, 'the old state is untouched');
});

test('callers alternate and the first caller is chosen', () => {
  let s = R.createMatch({ first: 'b' });
  assert.equal(s.caller, 'b');
  s = round(s, 'rock', 'rock', 'rock').state; assert.equal(s.caller, 'a');
  s = round(s, 'rock', 'rock', 'rock').state; assert.equal(s.caller, 'b');
  assert.equal(s.round, 3);
});

test('first to 3 wins; a kept 2 then a 1 gets there', () => {
  let s = R.createMatch({ first: 'a' });
  s = round(s, 'rock', 'rock', 'scissors').state;           // a: 2
  assert.equal(s.done, false);
  s = round(s, 'paper', 'rock', 'paper').state;             // b calls paper, breaks to rock; a answers paper? rock vs paper: paper wins (a) +1
  assert.equal(s.seats.a.points, 3);
  assert.equal(s.done, true); assert.equal(s.winner, 'a'); assert.equal(s.end, 'points');
  assert.throws(() => round(s, 'rock', 'rock', 'rock'));
});

test('three cracks lose, even with the points ahead', () => {
  let s = R.createMatch({ goal: 9, first: 'a' });
  const breakAndWin = (st) => round(st, 'rock', 'paper', 'rock').state;   // a calls rock, throws paper, wins 1, cracks
  s = breakAndWin(s);
  s = round(s, 'rock', 'rock', 'rock').state;               // b calls (tie)
  s = breakAndWin(s);
  s = round(s, 'rock', 'rock', 'rock').state;
  assert.equal(s.seats.a.cracks, 2); assert.equal(s.seats.a.points, 2);
  s = breakAndWin(s);
  assert.equal(s.done, true); assert.equal(s.winner, 'b'); assert.equal(s.end, 'cracks'); assert.equal(s.seats.a.points, 3);
});

test('the third crack beats the winning point in the same throw', () => {
  let s = R.createMatch({ goal: 3, first: 'a' });
  s = { ...s, seats: { a: { points: 2, cracks: 2 }, b: { points: 0, cracks: 0 } } };
  s = round(s, 'rock', 'paper', 'rock').state;              // a breaks into the 3rd point and the 3rd crack
  assert.equal(s.winner, 'b'); assert.equal(s.end, 'cracks');
});

test('crackLoses false (the kitchen): cracks only count', () => {
  let s = R.createMatch({ goal: 9, first: 'a', crackLoses: false });
  for (let i = 0; i < 4; i++) {
    s = round(s, 'rock', 'paper', 'rock').state;            // a cracks and wins 1
    s = round(s, 'rock', 'rock', 'rock').state;
  }
  assert.equal(s.seats.a.cracks, 4); assert.equal(s.done, false);
});

test('a promise has three answers: believe, doubt, deeper', () => {
  const P = 'rock';
  assert.equal(R.answerKind(P, 'paper'), 'believe');
  assert.equal(R.answerKind(P, 'rock'), 'doubt');
  assert.equal(R.answerKind(P, 'scissors'), 'deeper');
  for (const k of ['believe', 'doubt', 'deeper']) assert.equal(R.answerKind(P, R.answerFor(P, k)), k);
  const s = R.createMatch({ first: 'a' });
  const out = (callerThrow, answer) => round(s, P, callerThrow, answer).entry.winner;
  // believe (paper) beats the kept word, loses to the smart break (scissors)
  assert.equal(out('rock', 'paper'), 'b'); assert.equal(out('scissors', 'paper'), 'a');
  // doubt (rock) ties the kept word, beats the smart break
  assert.equal(out('rock', 'rock'), null); assert.equal(out('scissors', 'rock'), 'b');
  // deeper (scissors) beats a break to paper, loses to the kept word
  assert.equal(out('paper', 'scissors'), 'b'); assert.equal(out('rock', 'scissors'), 'a');
  // the break to paper beats doubt
  assert.equal(out('paper', 'rock'), 'a');
});

test('AI: same seed, same match; different seeds differ', () => {
  const a = R.playHeadless(12345, R.ADA, R.STEADY);
  const b = R.playHeadless(12345, R.ADA, R.STEADY);
  assert.deepEqual(a.state.log, b.state.log);
  const logs = new Set();
  for (let s = 1; s <= 12; s++) logs.add(JSON.stringify(R.playHeadless(s, R.ADA, R.STEADY).state.log));
  assert.ok(logs.size > 6);
});

test('AI decisions do not depend on call order', () => {
  const s = R.createMatch({ first: 'b' });
  const c1 = R.aiCall(s, 'b', R.ADA, 77);
  R.aiAnswer(s, 'a', R.STEADY, 'rock', 77);
  const c2 = R.aiCall(s, 'b', R.ADA, 77);
  assert.deepEqual(c1, c2);
});

test('Ada: opens with paper, keeps her word about 4 times in 5, the tell follows the break', () => {
  const s = R.createMatch({ first: 'b' });
  let kept = 0, calls = 0, tellOnBreak = 0, breaks = 0, tellOnKeep = 0;
  for (let seed = 0; seed < 2000; seed++) {
    const c = R.aiCall(s, 'b', R.ADA, seed);
    assert.equal(c.promise, 'paper', 'round 1 opens with paper');
    calls++;
    if (c.throw === c.promise) { kept++; if (c.tell) tellOnKeep++; } else { breaks++; if (c.tell) tellOnBreak++; }
  }
  const rate = kept / calls;
  assert.ok(rate > 0.76 && rate < 0.84, `keep rate ${rate}`);
  assert.ok(tellOnBreak / breaks > 0.85, 'she laughs before she breaks');
  assert.ok(tellOnKeep / kept < 0.1, 'and rarely when she means it');
});

test('a caller on the last crack keeps the word', () => {
  let s = R.createMatch({ first: 'a', goal: 9 });
  s = { ...s, seats: { ...s.seats, a: { points: 0, cracks: 2 } } };
  for (let seed = 0; seed < 300; seed++) {
    const c = R.aiCall(s, 'a', R.LIAR, seed);
    assert.equal(c.throw, c.promise);
  }
});

test('headless: matches finish, and the numbers stay in range', () => {
  const N = 600;
  let honestWins = 0, adaWinsVsSteady = 0, stalls = 0, kept = 0, adaCracks = 0;
  for (let seed = 1; seed <= N; seed++) {
    const r1 = R.playHeadless(seed, R.HONEST, R.LIAR, { first: seed % 2 ? 'a' : 'b' });
    if (r1.end === 'stall') stalls++;
    if (r1.winner === 'a') honestWins++;
    const r2 = R.playHeadless(seed, R.STEADY, R.ADA, { first: 'b', crackLoses: false });
    if (r2.winner === 'b') adaWinsVsSteady++;
    assert.ok(r2.rounds >= 2 && r2.rounds < R.MAX_ROUNDS);
    kept += r2.keptRate.b; adaCracks += r2.cracks.b;
  }
  assert.equal(stalls, 0);
  assert.ok(honestWins / N > 0.3 && honestWins / N < 0.7, `honest vs liar ${honestWins / N}`);
  const ada = adaWinsVsSteady / N;
  assert.ok(ada > 0.25 && ada < 0.65, `Ada vs steady ${ada}`);
  assert.ok(kept / N > 0.7 && kept / N < 0.9, `Ada kept rate ${kept / N}`);
  assert.ok(adaCracks / N < 1.5, 'her card is not in danger');
});

// ── the kitchen flow ───────────────────────────────────────────────────────────────────────────────────────────
function makeFlow(seed = 5) {
  const io = { views: [], inner: [], hands: [], result: null };
  const flow = F.createFlow({ seed, stake: 'dishes' }, {
    render: (v) => io.views.push(v), inner: (k) => io.inner.push(k), playHand: (h) => io.hands.push(h), done: (r) => { io.result = r; },
  });
  return { flow, io };
}
const run = (flow, sec) => { for (let t = 0; t < sec; t += 0.1) flow.update(0.1); };

test('flow: Ada calls first, the player throws, the round resolves on sim time only', () => {
  const { flow, io } = makeFlow();
  assert.equal(flow.phase(), 'intro');
  flow.press(1);                                            // ignored in the intro
  assert.equal(flow.phase(), 'intro');
  run(flow, F.INTRO_SEC + 0.2);
  assert.equal(flow.phase(), 'throw');
  assert.equal(flow.state().caller, 'b');
  flow.press(2);
  assert.deepEqual(io.hands, ['paper']);
  assert.equal(flow.phase(), 'reveal');
  run(flow, F.REVEAL_SEC + 0.2);
  assert.equal(flow.phase(), 'between');
  assert.equal(flow.state().log.length, 1);
  run(flow, F.BETWEEN_SEC + 0.2);
  assert.equal(flow.phase(), 'promise', 'now the player calls');
  flow.press(1); assert.equal(flow.phase(), 'throw');
  flow.press(1); run(flow, F.REVEAL_SEC + 0.2);
  assert.equal(flow.state().log.length, 2);
  assert.equal(flow.state().log[1].caller, 'a');
});

test('flow: Ada\'s tell shows as an inner line only when the tell is on', () => {
  let shown = 0, tells = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const { flow, io } = makeFlow(seed);
    run(flow, F.INTRO_SEC + 0.2);
    const c = R.aiCall(flow.state(), 'b', R.ADA, seed);
    if (c.tell) tells++;
    run(flow, F.TELL_SEC + 0.3);
    if (io.inner.length) { shown++; assert.match(io.inner[0], /^promise\.tell\.[12]$/); }
    assert.equal(io.inner.length, c.tell ? 1 : 0);
  }
  assert.equal(shown, tells);
  assert.ok(tells > 0 && tells < 60);
});

function playOut(seed, pickPromise, pickThrow) {
  const { flow, io } = makeFlow(seed);
  let guard = 0;
  while (flow.phase() !== 'closed' && guard++ < 4000) {
    flow.update(0.1);
    if (flow.phase() === 'promise') flow.press(pickPromise(flow, guard));
    else if (flow.phase() === 'throw') flow.press(pickThrow(flow, guard));
    else if (flow.phase() === 'end') flow.confirm();
  }
  return io;
}

test('flow: a full match ends, cracks do not end it, E closes with a result; same seed same game', () => {
  const pp = (_f, g) => 1 + (g % 3);
  const pt = (_f, g) => 1 + ((g >> 1) % 3);
  const a = playOut(9, pp, pt).result, b = playOut(9, pp, pt).result;
  assert.deepEqual(a, b);
  assert.equal(a.left, false);
  assert.ok(a.points.you >= 3 || a.points.ada >= 3);
});

test('flow: keeping every promise counts as kept; a breaker does not; Esc earns nothing', () => {
  // he promises rock and throws rock when he calls
  const keeper = playOut(3, () => 1, (f) => (f.state().caller === 'a' ? 1 : 2)).result;
  assert.equal(keeper.kept, true); assert.equal(keeper.cracks.you, 0);
  const breaker = playOut(3, () => 1, (f) => (f.state().caller === 'a' ? 2 : 1)).result;
  assert.equal(breaker.kept, false); assert.ok(breaker.cracks.you > 0);
  const c = makeFlow(3);
  run(c.flow, 2);
  c.flow.leave();
  assert.equal(c.io.result.left, true);
  assert.equal(c.flow.phase(), 'closed');
});

test('flow: the stake is stable for a Night and comes from the three words-only stakes', () => {
  assert.equal(F.stakeFor(11, 2), F.stakeFor(11, 2));
  const seen = new Set();
  for (let n = 1; n < 40; n++) seen.add(F.stakeFor(7, n));
  assert.deepEqual([...seen].sort(), ['dishes', 'kiss', 'truth']);
});

test('strings: EN and TR match, and every key the flow can show exists', () => {
  assert.deepEqual(Object.keys(S.en).sort(), Object.keys(S.tr).sort());
  const src = readFileSync('src/game/duels/promise/flow.ts', 'utf8');
  for (const m of src.matchAll(/'promise\.([a-z.]+)'/g)) {
    if (m[1].endsWith('.')) continue;
    assert.ok(m[1] in S.en, `promise.${m[1]}`);
  }
  for (const stake of F.STAKES) for (const side of ['win', 'lose']) assert.ok(`end.${stake}.${side}` in S.en);
  for (const n of [1, 2]) for (const k of ['beat', 'beaten', 'tell']) assert.ok(k === 'tell' ? `tell.${n}` in S.en : `ada.${k}.${n}` in S.en);
});

// ── me too, kept pairs, the wager (wave A3) ──────────────────────────────────────────────────────────────────────
const pairRound = (s, hand = 'rock') => R.playRound(s, { promise: hand, callerThrow: hand, answerThrow: hand, meToo: true });

test('a kept pair: both throw the promised hand, a tie with no points and no cracks', () => {
  const { state, entry } = pairRound(R.createMatch({ first: 'a' }));
  assert.equal(entry.pair, true); assert.equal(entry.winner, null); assert.equal(entry.points, 0);
  assert.equal(state.pairs, 1); assert.equal(state.seats.a.cracks + state.seats.b.cracks, 0);
  // not a pair: no "me too", or the caller broke it, or the answerer did
  assert.equal(round(R.createMatch(), 'rock', 'rock', 'rock').entry.pair, false);
  assert.equal(R.playRound(R.createMatch(), { promise: 'rock', callerThrow: 'paper', answerThrow: 'paper', meToo: true }).entry.pair, false);
  const x = R.playRound(R.createMatch(), { promise: 'rock', callerThrow: 'rock', answerThrow: 'paper', meToo: true });
  assert.equal(x.entry.pair, false); assert.equal(x.entry.echoBroke, true);
  assert.equal(x.state.seats.b.cracks, 1, 'a broken me-too cracks the answerer');
});

test('three kept pairs: no loser, nothing for the House to collect', () => {
  let s = R.createMatch({ first: 'a', crackLoses: true });
  for (let i = 0; i < 3; i++) { assert.equal(s.done, false); s = pairRound(s, R.HANDS[i]).state; s = s.done ? s : round(s, 'rock', 'rock', 'rock').state; }
  assert.equal(s.done, true); assert.equal(s.end, 'pairs'); assert.equal(s.winner, null);
  assert.equal(R.collectible(s), false);
  assert.equal(R.collectible({ ...s, winner: 'a' }), true);
});

test('a broken promise breaks the chain', () => {
  let s = pairRound(R.createMatch({ first: 'a', goal: 9 })).state;
  s = round(s, 'rock', 'rock', 'rock').state;               // an honest tie does not reset it
  s = pairRound(s).state;
  assert.equal(s.pairs, 2);
  s = round(s, 'rock', 'rock', 'rock').state;
  s = round(s, 'rock', 'paper', 'rock').state;              // a calls rock and breaks
  assert.equal(s.pairs, 0);
  s = pairRound(s).state; assert.equal(s.pairs, 1); assert.equal(s.done, false);
});

test('Ada\'s echo: free at the kitchen table about 1 in 3, only for a caller with a clean card', () => {
  const s = R.createMatch({ first: 'a' });
  let n = 0;
  for (let seed = 0; seed < 1500; seed++) if (R.aiEcho(s, 'b', R.ADA, seed)) n++;
  assert.ok(n / 1500 > 0.28 && n / 1500 < 0.38, `echo ${n / 1500}`);
  const cracked = { ...s, seats: { ...s.seats, a: { points: 0, cracks: 1 } } };
  for (let seed = 0; seed < 200; seed++) assert.equal(R.aiEcho(cracked, 'b', R.ADA, seed), false);
  assert.equal(R.aiEcho(s, 'b', R.STEADY, 1), false);
});

test('Ada\'s echo at the wager needs Harmony 4+, no word broken, a hint seen', () => {
  const s = R.createMatch({ first: 'a' });
  const ok = { harmony: 4, broken: false, hints: 1 };
  assert.equal(R.aiEcho(s, 'b', R.ADA_WAGER, 1, ok), true);
  for (const c of [undefined, { ...ok, harmony: 3 }, { ...ok, broken: true }, { ...ok, hints: 0 }]) assert.equal(R.aiEcho(s, 'b', R.ADA_WAGER, 1, c), false);
});

test('headless: an honest player can reach three pairs (not every time); without the trust she never echoes (seeded)', () => {
  const ok = { harmony: 5, broken: false, hints: 2 };
  let pairs = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const r = R.playHeadless(seed, R.HONEST, R.ADA_WAGER, { goal: 3, first: 'b', crackLoses: true }, ok);
    if (r.end === 'pairs') { pairs++; assert.equal(R.collectible(r.state), false); }
    const again = R.playHeadless(seed, R.HONEST, R.ADA_WAGER, { goal: 3, first: 'b', crackLoses: true }, ok);
    assert.deepEqual(r.state.log, again.state.log);
    const cold = R.playHeadless(seed, R.HONEST, R.ADA_WAGER, { goal: 3, first: 'b', crackLoses: true });
    assert.notEqual(cold.end, 'pairs'); assert.ok(cold.state.log.every((e) => !e.meToo));
  }
  assert.ok(pairs >= 8 && pairs < 40, `pair matches ${pairs}/40`);
});

// ── the kitchen wager flow ─────────────────────────────────────────────────────────────────────────────────────
function wagerFlow(seed, wager) {
  const io = { result: null };
  const flow = F.createFlow({ seed, stake: 'dishes', wager }, { render() {}, inner() {}, playHand() {}, done: (r) => { io.result = r; } });
  return { flow, io };
}
function playWager(seed, wager, promiseOf, throwOf) {
  const { flow, io } = wagerFlow(seed, wager);
  for (let g = 0; flow.phase() !== 'closed' && g < 4000; g++) {
    flow.update(0.1);
    const ph = flow.phase();
    if (ph === 'promise') flow.press(promiseOf(flow));
    else if (ph === 'throw') flow.press(throwOf(flow));
    else if (ph === 'end') flow.confirm();
  }
  return io.result;
}
const TRUST = { harmony: 4, broken: false, hints: 1 };
const adaSays = (f, seed) => R.aiCall(f.state(), 'b', R.ADA_WAGER, seed).promise;
const idx = (h) => 1 + R.HANDS.indexOf(h);

test('wager: you keep every word and she echoes: three kept pairs, the true ending path', () => {
  // you promise and throw rock; when she calls you throw her promise, so nothing is ever broken
  const r = playWager(7, TRUST, () => 1, (f) => (f.state().caller === 'a' ? 1 : idx(adaSays(f, 7))));
  assert.equal(r.stake, 'name'); assert.equal(r.winner, 'none'); assert.equal(r.pairs, 3); assert.equal(r.wager, 'pair');
  assert.equal(r.cracks.you, 0);
});

test('wager: believing her promises beats her (door), doubting her loses it (kept); no trust, no pair; seeded', () => {
  const win = (seed) => playWager(seed, TRUST, () => 1, (f) => (f.state().caller === 'a' ? 1 : idx(R.counterOf(adaSays(f, seed)))));
  const lose = (seed) => playWager(seed, TRUST, () => 1, (f) => (f.state().caller === 'a' ? 1 : idx(R.loserTo(adaSays(f, seed)))));
  for (const seed of [1, 2, 3, 4]) { assert.equal(win(seed).wager, 'win'); assert.equal(lose(seed).wager, 'lose'); }
  assert.deepEqual(win(5), win(5));
  const cold = playWager(7, { harmony: 2, broken: false, hints: 0 }, () => 1, (f) => (f.state().caller === 'a' ? 1 : idx(adaSays(f, 7))));
  assert.equal(cold.pairs, 0); assert.notEqual(cold.wager, 'pair');
  assert.equal(playOut(9, () => 1, () => 1).result.wager, null, 'not the wager: no outcome');
});

test('me too at the table: key 4 on her call, a kept pair when you throw her hand and she kept it', () => {
  const { flow } = makeFlow(11);
  run(flow, F.INTRO_SEC + 0.2);
  flow.press(4);
  const say = R.aiCall(flow.state(), 'b', R.ADA, 11);
  flow.press(1 + R.HANDS.indexOf(say.promise));
  run(flow, F.REVEAL_SEC + 0.2);
  const e = flow.state().log[0];
  assert.equal(e.meToo, true); assert.equal(e.pair, say.throw === say.promise);
});
