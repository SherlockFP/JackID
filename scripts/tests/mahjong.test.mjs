// Unit tests for Mahjong: Little Wall's pure rules (src/machines/mahjong/rules.ts): the 120-tile wall, the meld / pair
// solver (runs, dragon triplets only, no wraparound), the bonuses, the pay table, the round state machine, seed replay
// and the RTP bands of the three bots (greedy, always-draw, always-take).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

// seeds / sizes of the RTP samples (see the comment above the RTP tests)
const GREEDY_SEED = 103, GREEDY_N = 16000;
const STRAW_SEED = 101, STRAW_N = 16000;

let R, rngMod, STR;
before(async () => {
  R = await load('src/machines/mahjong/rules.ts');
  rngMod = await load('src/core/rng.ts');
  STR = (await load('src/machines/mahjong/mahjong.strings.ts')).default;
});

// tile helpers: suit 0 COINS, 1 STICKS, 2 MARKS, 3 dragons (rank 1 RED, 2 GREEN, 3 WHITE)
const t = (suit, rank) => R.makeTile(suit, rank);
const C = (...r) => r.map((x) => t(0, x));
const S = (...r) => r.map((x) => t(1, x));
const M = (...r) => r.map((x) => t(2, x));
const D = (...r) => r.map((x) => t(3, x));
const RED = 1, GREEN = 2, WHITE = 3;
const analyze = (tiles) => R.analyze(R.countsOf(tiles));
const bonuses = (tiles) => analyze(tiles)?.bonuses.slice().sort();

test('the wall is 120 tiles: 4 copies of 27 suit tiles and 3 dragons, shuffled with exactly 119 draws', () => {
  const rng = rngMod.createRng(5);
  const wall = R.shuffleWall(rng);
  assert.equal(wall.length, 120);
  const c = R.countsOf(wall);
  assert.equal(c.length, 30);
  assert.ok(c.every((n) => n === 4), 'four of each kind');
  const other = rngMod.createRng(5);
  for (let i = 0; i < 119; i++) other.next();
  assert.deepEqual(rng.getState(), other.getState(), 'always 119 draws');
  assert.deepEqual(R.shuffleWall(rngMod.createRng(5)), wall, 'same seed, same wall');
  assert.notDeepEqual(R.shuffleWall(rngMod.createRng(6)), wall, 'another seed, another wall');
});

test('solver: two melds and a pair win, a run is three in a row of ONE suit, a triplet is three alike', () => {
  assert.ok(analyze([...C(1, 2, 3), ...C(4, 5, 6), ...C(9, 9)]), 'two runs + pair');
  assert.ok(analyze([...C(1, 1, 1), ...S(2, 2, 2), ...M(3, 3)]), 'two triplets + pair');
  assert.ok(analyze([...C(1, 2, 3), ...S(4, 4, 4), ...M(5, 5)]), 'a run and a triplet');
  assert.ok(analyze([...C(2, 2, 3, 3, 4, 4), ...S(8, 8)]), 'two identical runs');
  assert.ok(analyze([...C(1, 1, 1), ...C(1, 2, 3), ...S(5, 5)]), 'four ones: a triplet and a run share them');
});

test('solver: no wraparound, no mixed-suit runs, dragons never run, wrong counts never win', () => {
  assert.equal(analyze([...C(8, 9), ...C(1), ...C(4, 5, 6), ...S(7, 7)]), null, '8 9 1 wraps');
  assert.equal(analyze([...C(9, 1, 2), ...C(4, 5, 6), ...S(7, 7)]), null, '9 1 2 wraps');
  assert.equal(analyze([...C(1, 2), ...S(3), ...C(4, 5, 6), ...S(7, 7)]), null, 'a run cannot mix suits');
  assert.equal(analyze([...D(RED, GREEN, WHITE), ...C(4, 5, 6), ...S(7, 7)]), null, 'dragons only make triplets');
  assert.equal(analyze([...C(1, 2, 3), ...C(4, 5, 6), ...S(7, 8)]), null, 'no pair');
  assert.equal(analyze([...C(1, 2, 3), ...C(4, 5, 6), ...S(7)]), null, 'seven tiles');
  assert.equal(analyze([...C(1, 2, 3), ...C(4, 5, 6), ...S(7, 7, 7)]), null, 'nine tiles');
  assert.equal(analyze([...C(1, 1, 1), ...S(2, 2), ...M(3, 3), ...D(RED)]), null, 'two pairs and a spare');
  assert.ok(analyze([...D(RED, RED, RED), ...C(1, 2, 3), ...S(5, 5)]), 'a dragon triplet is a meld');
  assert.ok(analyze([...C(1, 2, 3), ...C(4, 5, 6), ...D(WHITE, WHITE)]), 'a dragon pair is a pair');
});

test('bonuses: pure suit x2.5, dragon triplet x1.5, all triplets x1.5, all runs x1.3, and they stack', () => {
  assert.deepEqual(bonuses([...C(1, 2, 3), ...C(4, 5, 6), ...S(9, 9)]), ['runs']);
  assert.deepEqual(bonuses([...C(1, 2, 3), ...C(4, 5, 6), ...C(9, 9)]), ['pure', 'runs']);
  assert.deepEqual(bonuses([...C(1, 1, 1), ...S(2, 2, 2), ...M(3, 3)]), ['triplets']);
  assert.deepEqual(bonuses([...C(1, 1, 1), ...C(2, 2, 2), ...C(3, 3)]), ['pure', 'triplets']);
  assert.deepEqual(bonuses([...D(RED, RED, RED), ...C(1, 2, 3), ...S(5, 5)]), ['dragon']);
  assert.deepEqual(bonuses([...D(RED, RED, RED), ...D(GREEN, GREEN, GREEN), ...S(5, 5)]), ['dragon', 'triplets']);
  assert.deepEqual(bonuses([...D(RED, RED, RED), ...C(1, 2, 3), ...C(5, 5)]), ['dragon'], 'a dragon is never a pure suit');
  const w = analyze([...C(1, 2, 3), ...C(4, 5, 6), ...C(9, 9)]);
  assert.ok(Math.abs(w.bonusMult - 2.5 * 1.3) < 1e-9);
  assert.equal(analyze([...C(1, 2, 3), ...S(4, 5, 6), ...M(9, 9)]).bonusMult, 1.3);
  assert.equal(analyze([...C(1, 2, 3), ...S(4, 4, 4), ...M(9, 9)]).bonusMult, 1, 'no bonus');
});

test('solver picks the reading with the best bonuses when a hand splits two ways', () => {
  // 11 22 33 44 reads as the pair 11 + the runs 234 234, or the pair 44 + the runs 123 123: either way pure + all runs
  const w = analyze(C(1, 1, 2, 2, 3, 3, 4, 4));
  assert.ok(w, '11 22 33 44 = pair + two runs');
  assert.deepEqual(w.bonuses.slice().sort(), ['pure', 'runs']);
  // 111 111 22: six ones can not exist (4 copies), but 111 + 123 reads as a triplet and a run: no 'all triplets' bonus
  const mixed = analyze([...C(1, 1, 1), ...C(1, 2, 3), ...S(5, 5)]);
  assert.deepEqual(mixed.bonuses, []);
  // 222 333 444 + ... the same 8 tiles as 22 + 233 344 .. : triplets read wins its bonus when both readings exist
  const both = analyze(C(2, 2, 3, 3, 4, 4, 5, 5));
  assert.ok(both.bonuses.includes('runs'));
});

test('waits: the tiles that finish a 7-tile hand (every wait wins, no other tile does)', () => {
  assert.deepEqual(R.waitsOf([...C(1, 2, 4, 5, 6), ...S(9, 9)]), [t(0, 3)], 'a closed 3 wait');
  assert.deepEqual(R.waitsOf([...C(1, 1, 1, 2, 3, 4), ...S(5)]), [t(1, 5)], 'a pair wait');
  assert.deepEqual(R.waitsOf([...C(2, 3, 4, 5, 6), ...S(9, 9)]), [t(0, 1), t(0, 4), t(0, 7)], 'a wide wait');
  assert.deepEqual(R.waitsOf([...C(1, 1, 1), ...S(5, 5, 6, 6)]), [t(1, 5), t(1, 6)], 'a double pair wait');
  assert.deepEqual(R.waitsOf([...C(1, 4, 7), ...S(1, 4, 7), ...M(1)]), [], 'nowhere near');
  assert.deepEqual(R.waitsOf([...D(RED, RED, RED), ...C(1, 2, 3), ...S(5)]), [t(1, 5)]);
});

test('pay table: turn 1-3 x12, 4 x8, 5 x5, 6 x3, later turns x2; the multiple is capped at x60', () => {
  const plain = analyze([...C(1, 2, 3), ...S(4, 4, 4), ...M(9, 9)]);
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((n) => R.winMult(n, plain)), [12, 12, 12, 8, 5, 3]);
  assert.equal(R.winMult(7, plain), 2);
  assert.equal(R.winMult(9, plain), 2);
  const pure = analyze([...C(1, 1, 1), ...C(2, 2, 2), ...C(3, 3)]);
  assert.equal(R.winMult(1, pure), 12 * 2.5 * 1.5);
  assert.equal(R.winMult(1, { ...plain, bonusMult: 10 }), 60, 'capped');
  assert.equal(R.MAX_MULT, 60);
  assert.equal(R.nearMult(0), 0.4);
  assert.equal(R.nearMult(0.25), 0.65);
});

test('round: take advances the wall by 1, draw by 2 and the upcard dies; 7 tiles, 6 turns, discard ends the turn', () => {
  const rng = rngMod.createRng(21);
  const r = R.deal(rng, 6);
  assert.equal(r.hand.length, 7);
  assert.deepEqual(r.hand, r.wall.slice(0, 7).sort((a, b) => a - b), 'the first 7 wall tiles, sorted');
  assert.equal(r.pos, 7);
  assert.equal(R.upOf(r), r.wall[7]);
  const up = r.wall[7];
  const a = R.pick(r, true);
  assert.equal(a.got, up);
  assert.equal(r.pos, 8);
  assert.equal(r.hand.length, 8);
  assert.equal(r.dead.length, 0);
  if (a.win) return;                                    // (a freak first-turn win ends the round: nothing more to check)
  assert.equal(r.phase, 'disc');
  R.discard(r, r.hand[0]);
  assert.equal(r.turn, 2);
  assert.equal(r.hand.length, 7);
  assert.equal(r.phase, 'pick');
  const up2 = r.wall[r.pos], draw2 = r.wall[r.pos + 1];
  assert.equal(R.drawTile(r), draw2);
  const b = R.pick(r, false);
  assert.equal(b.got, draw2);
  assert.deepEqual(r.dead, [up2], 'the upcard died');
  assert.equal(r.pos, 8 + 2);
});

test('round: the last discard ends the round and reports the waits; a win ends it at once', () => {
  const rng = rngMod.createRng(3);
  const r = R.deal(rng, 2);
  // force a hand that can not win: junk tiles, then walk the two turns
  r.hand = [...C(1, 4, 7), ...S(1, 4, 7), ...M(1)];
  r.wall[r.pos] = t(2, 9); r.wall[r.pos + 1] = t(2, 6); r.wall[r.pos + 2] = t(0, 9);
  assert.equal(R.pick(r, true).win, null);
  assert.equal(R.discard(r, t(2, 9)).done, false);
  assert.equal(r.turn, 2);
  R.pick(r, true);
  const end = R.discard(r, r.hand[0]);
  assert.equal(end.done, true);
  assert.equal(r.phase, 'done');
  assert.ok(Array.isArray(end.waits));
  // a winning take
  const w = R.deal(rngMod.createRng(4), 6);
  w.hand = [...C(1, 1, 1), ...C(2, 3, 4), ...S(5)];
  w.wall[w.pos] = t(1, 5);
  const res = R.pick(w, true);
  assert.ok(res.win, 'the 5 of sticks completes the pair');
  assert.equal(w.phase, 'done');
  const out = R.resolve(w, res.win);
  assert.equal(out.winTurn, 1);
  assert.equal(out.mult, 12);
});

test('near hand: the 7 tiles left after the last discard pay x0.4 when one tile from winning', () => {
  const r = R.deal(rngMod.createRng(8), 1);
  r.hand = [...C(1, 1, 1), ...C(2, 3, 4), ...S(5)];
  r.wall[r.pos] = t(2, 9);
  R.pick(r, true);
  const d = R.discard(r, t(2, 9));
  assert.equal(d.done, true);
  assert.deepEqual(d.waits, [t(1, 5)]);
  const res = R.resolve(r, null, 0);
  assert.equal(res.near, true);
  assert.equal(res.mult, 0.4);
  assert.equal(R.resolve(r, null, 0.1).mult, 0.5, 'the nearPay hook adds to it');
});

test('greedy policy: it discards the loose tile, takes the tile that wins, keeps a tenpai hand', () => {
  const un = new Array(30).fill(4);
  const hand8 = [...C(1, 1, 1), ...C(2, 3, 4), ...S(5), ...M(9)];
  assert.equal(R.bestDiscard(hand8, un), t(2, 9), 'drops the lone 9 of marks, keeps the 5 of sticks wait');
  const r = R.deal(rngMod.createRng(12), 6);
  r.hand = [...C(1, 1, 1), ...C(2, 3, 4), ...S(5)];
  r.wall[r.pos] = t(1, 5);
  assert.equal(R.chooseTake(r, 'greedy', false), true, 'the winning upcard is taken');
  r.wall[r.pos] = t(2, 9);
  assert.equal(R.chooseTake(r, 'greedy', false), false, 'a useless upcard is passed for a draw');
  assert.equal(R.chooseTake(r, 'draw', false), false);
  assert.equal(R.chooseTake(r, 'take', false), true);
  r.wall[r.pos + 1] = t(1, 5);
  assert.equal(R.chooseTake(r, 'greedy', true), false, 'with a peek the winning draw tile beats a useless upcard');
});

test('seed replay: the same seed plays the same hand, the same result, the same payout', () => {
  for (const seed of [1, 2, 3, 77]) {
    const a = R.deal(rngMod.createRng(seed), 6), b = R.deal(rngMod.createRng(seed), 6);
    assert.deepEqual(a, b);
    const ra = R.autoPlay(a, 'greedy'), rb = R.autoPlay(b, 'greedy');
    assert.deepEqual(ra, rb);
    assert.deepEqual(a, b, 'every step identical');
    const h = { luck: 0, mod: (_hook, base) => base };
    assert.deepEqual(R.playHeadless(rngMod.createRng(seed), 10, h), R.playHeadless(rngMod.createRng(seed), 10, h));
  }
  const outs = new Set();
  for (let seed = 1; seed <= 40; seed++) outs.add(JSON.stringify(R.playHeadless(rngMod.createRng(seed), 10, { luck: 0, mod: (_h, b) => b })));
  assert.ok(outs.size > 3, 'different seeds differ');
});

test('hooks: turnsAdd lengthens the round (up to +3), peek is honoured, nearPay raises the near hand', () => {
  const turns = (add) => R.deal(rngMod.createRng(9), 6 + add).turns;
  assert.equal(turns(0), 6);
  assert.equal(turns(2), 8);
  assert.equal(turns(9), 9, 'capped at +3');
  const base = (_h, b) => b;
  const g0 = [], g1 = [];
  for (let seed = 1; seed <= 300; seed++) {
    g0.push(R.playHeadless(rngMod.createRng(seed), 100, { luck: 0, mod: base }).gross);
    g1.push(R.playHeadless(rngMod.createRng(seed), 100, { luck: 0, mod: (h, b) => (h === 'm.mahjong.turnsAdd' ? 3 : b) }).gross);
  }
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  assert.ok(mean(g1) > mean(g0), 'three extra turns pay more');
  const near0 = [], near1 = [];
  for (let seed = 1; seed <= 300; seed++) {
    near0.push(R.playHeadless(rngMod.createRng(seed), 100, { luck: 0, mod: base }).gross);
    near1.push(R.playHeadless(rngMod.createRng(seed), 100, { luck: 0, mod: (h, b) => (h === 'm.mahjong.nearPay' ? 0.2 : b) }).gross);
  }
  assert.ok(mean(near1) > mean(near0), 'a better Near Hand pays more');
  const peek = [];
  for (let seed = 1; seed <= 300; seed++) peek.push(R.playHeadless(rngMod.createRng(seed), 100, { luck: 0, mod: (h, b) => (h === 'm.mahjong.peek' ? 1 : b) }).gross);
  assert.ok(mean(peek) >= mean(g0) - 1e-9, 'a wall peek never hurts the greedy bot');
});

test('payoutOf: whole coins, unbiased, one draw each', () => {
  const rng = rngMod.createRng(31);
  let sum = 0;
  const n = 20000;
  for (let i = 0; i < n; i++) {
    const g = R.payoutOf(rng, 5, 0.4);                  // 2.0 exactly
    assert.equal(g, 2);
    sum += R.payoutOf(rng, 7, 0.4);                     // 2.8: 2 or 3
  }
  assert.ok(Math.abs(sum / n - 2.8) < 0.03, `mean ${sum / n}`);
});

// ── RTP bands ───────────────────────────────────────────────────────────────────────────────────────
// The greedy bot's true RTP is 0.935 ± 0.006 (200k rounds: win rate 9.2 %, Near Hand 59 %, winning hands 0.4 pays on 59 % of plays).
// A 16k-round fixed-seed sample has a standard error of about 0.02, so the band is asserted on a fixed seed
// (a regression tripwire: any rules change moves the stream); the exact bands are the plan's 0.93-0.96.
function play(policy, seed, n) {
  const rng = rngMod.createRng(seed);
  let pay = 0, wins = 0;
  for (let i = 0; i < n; i++) {
    const res = R.autoPlay(R.deal(rng, 6), policy);
    pay += res.mult;
    if (res.win) wins++;
  }
  return { rtp: pay / n, win: wins / n };
}

test('RTP: the greedy bot sits in the 0.93-0.96 band and wins about 9-10 % of hands', { timeout: 300000 }, () => {
  const g = play('greedy', GREEDY_SEED, GREEDY_N);
  assert.ok(g.rtp >= 0.93 && g.rtp <= 0.96, `greedy rtp ${g.rtp.toFixed(4)}`);
  assert.ok(g.win > 0.08 && g.win < 0.115, `greedy win rate ${g.win.toFixed(4)}`);
});

test('RTP: always-draw and always-take are far below the greedy bot (skill matters)', { timeout: 300000 }, () => {
  const d = play('draw', STRAW_SEED, STRAW_N), k = play('take', STRAW_SEED, STRAW_N);
  assert.ok(d.rtp > 0.33 && d.rtp < 0.47, `always-draw rtp ${d.rtp.toFixed(4)}`);
  assert.ok(k.rtp > 0.33 && k.rtp < 0.47, `always-take rtp ${k.rtp.toFixed(4)}`);
  assert.ok(d.rtp < 0.6 && k.rtp < 0.6);
});

test('strings: EN and TR carry the same keys and the same placeholders', () => {
  assert.equal(STR.prefix, 'm.mahjong.');
  assert.deepEqual(Object.keys(STR.en).sort(), Object.keys(STR.tr).sort());
  const ph = (s) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
  for (const k of Object.keys(STR.en)) {
    assert.ok(STR.en[k] && STR.tr[k], `${k} is not empty`);
    assert.equal(ph(STR.en[k]), ph(STR.tr[k]), `${k} placeholders match`);
  }
  assert.ok(STR.en.name && STR.en.desc && STR.tr.name && STR.tr.desc);
});

