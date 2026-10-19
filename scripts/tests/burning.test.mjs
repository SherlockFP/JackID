// THE BURNING WAGER (src/game/duels/promise/champion.ts, flow.ts with a foe, src/game/story/wager.ts, run.ts): the Champion's habits and
// his seeded play, the balance (a reader of the hints wins, random play does not), the flow with him in Ada's chair, the friends' help,
// the outcome through run.burningWager to the endings, the Night 8 gate (opens once, restarts on a resume), Loki's free whispers and his
// word, and the story's Watch beats (the Night 7 Audit and the Night 8 reveal land on a real second Watch, never on the end of a Dawn).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let C, R, F, S, B, J, CH;
before(async () => {
  C = await load('src/game/duels/promise/champion.ts');
  R = await load('src/game/duels/promise/rules.ts');
  F = await load('src/game/duels/promise/flow.ts');
  S = (await load('src/game/duels/promise/promise.strings.ts')).default;
  B = await load('src/game/bonds.ts');
  J = await load('src/game/joker/joker.ts');
  CH = await load('src/game/story/chapter.ts');
});

const N = 300;
const rate = (bot, pred, steady = false) => {
  let n = 0;
  for (let i = 0; i < N; i++) if (pred(C.playWager(5000 + i, bot, steady))) n++;
  return n / N;
};
const won = (s) => s.winner === 'a';
const clean = (s) => s.winner === 'a' && s.seats.a.cracks === 0;

// ── the Champion ─────────────────────────────────────────────────────────────────────────────────────

test('his habits: he opens with paper and keeps it; at match point he calls paper, goes quiet and throws rock', () => {
  const s = C.createWager();
  assert.deepEqual([s.goal, s.caller, s.crackLoses], [5, 'b', true]);
  assert.deepEqual(C.champCall(s, 1), { promise: 'paper', throw: 'paper', tell: false });
  for (const pts of [[4, 0], [0, 4], [4, 4]]) {
    const m = { ...s, seats: { a: { points: pts[0], cracks: 0 }, b: { points: pts[1], cracks: 0 } }, log: [{ caller: 'b' }], round: 7 };
    assert.equal(C.matchPoint(m), true);
    assert.deepEqual(C.champCall(m, 2), { promise: 'paper', throw: 'rock', tell: true }, `match point ${pts}`);
  }
});

test('his play is seeded: the same seed plays the same match, another seed another one', () => {
  const a = C.playWager(77, 'reader'), b = C.playWager(77, 'reader'), c = C.playWager(78, 'reader');
  assert.deepEqual(a.log, b.log);
  assert.notDeepEqual(a.log, c.log);
  const m = { ...C.createWager(), log: [{ caller: 'b' }], round: 3 };
  assert.deepEqual(C.champCall(m, 9), C.champCall(m, 9));
});

test('balance: a reader of the hints beats him clean; a believer mostly loses; random play almost never wins clean', () => {
  const reader = rate('reader', clean), believer = rate('believer', won), random = rate('random', won), randomClean = rate('random', clean);
  assert.ok(reader >= 0.85, `reader wins clean ${reader}`);
  assert.ok(believer <= 0.45, `believer wins ${believer}`);
  assert.ok(random <= 0.25, `random wins ${random}`);
  assert.ok(randomClean <= 0.05, `random wins clean ${randomClean}`);
});

test('the tremble: at your match point on your own call he reads the hand you hold, unless Selim\'s water steadied it', () => {
  const m = { ...C.createWager(), caller: 'a', seats: { a: { points: 4, cracks: 0 }, b: { points: 1, cracks: 0 } }, round: 6 };
  assert.equal(C.trembles(m, false), true);
  assert.equal(C.trembles(m, true), false);
  for (const h of R.HANDS) assert.equal(C.champAnswer(m, 3, h, h, false), R.counterOf(h));
  const steadySeen = new Set();
  for (let seed = 0; seed < 60; seed++) steadySeen.add(C.champAnswer(m, seed, 'rock', 'rock', true));
  assert.ok(steadySeen.size > 1, 'steady: he plays the odds');
  assert.ok(rate('believer', won, true) > rate('believer', won, false), 'the water helps');
});

// ── the flow with the Champion in Ada's chair ──────────────────────────────────────────────────────

/** Drives the real flow with a policy; returns the result, the calls he made and the lines shown. */
function drive(seed, policy, steady = false) {
  let result = null, call = null;
  const calls = [], keys = [];
  const flow = F.createFlow({ seed, stake: 'dishes', goal: C.WAGER_GOAL, foe: C.championFoe(steady) }, {
    render: (v) => { for (const l of v.lines) keys.push(l.key); if (v.head) keys.push(v.head.key); },
    inner: (k) => keys.push(k), playHand: () => {}, done: (r) => { result = r; },
    called: (c) => { call = c; calls.push(c); },
  });
  for (let i = 0; i < 4000 && !result; i++) {
    flow.update(0.5);
    const v = flow.view(), st = flow.state();
    if (v.finish) flow.confirm();
    else if (v.pick) flow.press(1 + R.HANDS.indexOf(policy(st, v.phase, call)));
  }
  return { result, calls, keys };
}
const reader = (st, phase, call) => (st.caller === 'b' ? (call.tell ? call.promise : R.counterOf(call.promise)) : R.HANDS[st.round % 3]);

test('flow: the Champion calls first, first to 5, three cracks lose, no "me too", stake the card, his lines under promise.champ', () => {
  const { result, calls, keys } = drive(41, reader);
  assert.ok(result && !result.left);
  assert.equal(result.stake, 'card');
  assert.equal(calls[0].promise, 'paper');
  assert.equal(result.pairs, 0);
  assert.ok(Math.max(result.points.you, result.points.ada) >= 5 || result.cracks.you >= 3 || result.cracks.ada >= 3);
  for (const k of keys) {
    assert.ok(!k.includes('promise.ada.'), `an Ada line at the Wager: ${k}`);
    const bare = k.replace(/^promise\./, '');
    if (k.startsWith('promise.')) assert.ok(bare in S.en && bare in S.tr, `missing string ${k}`);
  }
  assert.ok(keys.some((k) => k === 'promise.champ.promise' || k === 'promise.champ.quiet'));
});

test('flow: the reader wins through the real flow most of the time, and the outcome is what the run reads', () => {
  let wins = 0;
  for (let i = 0; i < 40; i++) {
    const { result } = drive(9000 + i, reader);
    const o = C.wagerOutcome(result, false);
    assert.equal(o.wager, result.winner === 'you' ? 'win' : 'lose');
    assert.equal(o.cracks, result.cracks.you);
    if (o.wager === 'win' && o.cracks === 0) wins++;
  }
  assert.ok(wins >= 30, `reader clean wins through the flow: ${wins}/40`);
});

test('strings: every Burning Wager key in EN and TR, no dashes, same placeholders', () => {
  const champ = Object.keys(S.en).filter((k) => /champ|card|eye|word|final|burn|tremble|who\.|help\./.test(k));
  assert.ok(champ.length >= 30);
  const ph = (s) => (s.match(/\{\w+\}/g) ?? []).sort().join();
  for (const k of champ) {
    assert.ok(S.tr[k], `tr ${k}`);
    assert.equal(ph(S.en[k]), ph(S.tr[k]), `${k} placeholders`);
    for (const v of [S.en[k], S.tr[k]]) assert.ok(!/[–—]/.test(v), `${k}: no dash`);
  }
});

// ── the friends (§10 wiring plan) ────────────────────────────────────────────────────────────────

test('bond help: Tamsin names the silence, Lucan says how Ada won and the tell, Selim\'s water, Mimosa\'s Eye; a betrayed Lucan costs an Eye', () => {
  const book = (levels, burned = []) => {
    const b = new B.Bonds(1);
    const rec = (v) => ({ v, last: 1, up: 1, burned: false });
    b.restore({ v: 1, b: Object.fromEntries(B.BOND_IDS.map((w) => [w, burned.includes(w) ? { ...rec(0), burned: true } : rec(levels[w] ?? 0)])), loans: [], taken: 0, forgot: false });
    return b;
  };
  const none = C.wagerHelps(book({}), false);
  assert.deepEqual([none.silence, none.howAda, none.tell, none.water, none.mimosa, none.lucanAgainst, none.eyes, none.ada], [false, false, false, false, false, false, 1, false]);
  const two = C.wagerHelps(book({ tamsin: 2, lucan: 2 }), false);
  assert.deepEqual([two.silence, two.howAda, two.tell], [true, true, false]);
  const three = C.wagerHelps(book({ tamsin: 3, lucan: 3, selim: 3, mimosa: 3 }), true);
  assert.deepEqual([three.silence, three.howAda, three.tell, three.water, three.mimosa, three.eyes, three.ada], [true, true, true, true, true, 2, true]);
  const betrayed = C.wagerHelps(book({ mimosa: 3 }, ['lucan']), false);
  assert.deepEqual([betrayed.lucanAgainst, betrayed.eyes], [true, 1]);
  assert.equal(C.wagerHelps(book({}, ['lucan']), false).eyes, 0);
  // the ids the help reads are the bond book's own
  for (const id of ['tamsin.silence', 'lucan.howAda', 'lucan.tell', 'selim.water', 'mimosa.eye']) assert.ok(B.UNLOCKS.some((u) => u.id === id), id);
});

// ── Loki at the Wager ──────────────────────────────────────────────────────────────────────────────

test('Loki before every throw: wager whispers are free (no Watch cap); his word is the true line "He\'ll break", once', () => {
  const j = new J.Joker(5); j.beginNight(8); j.beginWatch(1);
  for (let i = 0; i < 12; i++) assert.ok(j.whisper({ ctx: 'wager', fact: ['opens', 'quiet', 'left'][i % 3], free: true }), `whisper ${i}`);
  assert.equal(j.tipsLeft, J.tipsPerWatch(j.ink), 'no tip spent');
  j.trust = 3; j.dawn();
  assert.equal(j.wordReady, true);
  const w = j.whisper({ ctx: 'wager', fact: 'word', onHisWord: true, free: true });
  assert.deepEqual([w.truth, w.we, w.onHisWord, w.keys[0]], [true, false, true, 'joker.w.word.t']);
  assert.equal(j.wordReady, false);
});

// ── the run: the gate, the outcome, the endings, the restart rule ───────────────────────────────────

describe('the run', () => {
  let RUN, EV;
  before(async () => {
    RUN = await load('src/game/run.ts');
    EV = await load('src/core/events.ts');
    (await load('src/machines/_base/registry.ts')).load();
  });
  const paidDawn = (run) => { run.debtPaid = run.quota.due; run.syncQuota(); run.phase = 'collection'; run.dawn(); };
  const at = (night, seed, home = true) => { const run = RUN.createRun({ seed, mode: 'debt', home }); run.index = night - 1; return run; };
  const game = (wager, pairs = 0) => ({ left: false, wager, pairs, cracks: { you: 0, ada: 0 } });

  test('the Wager is due only after the paid Night 8 Dawn of a story run, and only until its outcome', () => {
    const n7 = at(7, 701);
    paidDawn(n7);
    assert.equal(n7.wagerDue(), false, 'Night 7 Dawn: no Wager');
    n7.dispose();
    const online = at(8, 702, false);
    paidDawn(online);
    assert.equal(online.topsideOpen, true);
    assert.equal(online.wagerDue(), false, 'no story layer: the topside choice as before');
    online.dispose();
    const run = at(8, 703);
    assert.equal(run.wagerDue(), false, 'Night 8 before its Dawn');
    paidDawn(run);
    assert.equal(run.wagerDue(), true);
    const ends = [];
    const off = EV.bus.on('run:end', ({ summary }) => ends.push(summary));
    assert.equal(run.lastGameOpen(), false, 'the House machine waits for the Wager');
    run.burningWager({ wager: 'win', cracks: 0 });
    assert.equal(run.wagerDue(), false, 'played: never again');
    run.burningWager({ wager: 'lose', cracks: 2 });   // a second outcome changes nothing
    off();
    assert.equal(ends.length, 0, 'SON OYUN: a won Wager does not end the run');
    assert.equal(run.chapterRecord().wager, 'win');
    assert.equal(run.lastGameOpen(), true, 'the Champion gives up his seat: the House machine is lit');
    run.dispose();
  });

  test('the Champion\'s match then the House machine decide the ending: KEPT PAIR, COLD KITCHEN, THE CHAIR, and a cracked win is SON OYUN', () => {
    const play = (kitchen, seed, policy) => {
      const run = at(7, seed);
      run.kitchenDone(game(kitchen, kitchen === 'pair' ? 3 : 0));
      run.index = 7;
      paidDawn(run);
      const { result } = drive(seed, policy);
      run.burningWager(C.wagerOutcome(result, false));
      if (!run.over) { run.rng.chance = () => true; run.playLastGame(); run.endLastGame(); }   // a won Wager: the machine pays
      const rec = run.endingRecord();
      run.dispose();
      return { rec, result };
    };
    const seedWhere = (policy, want) => { for (let s = 100; s < 400; s++) if (want(drive(s, policy).result)) return s; throw new Error('no seed'); };
    const cleanSeed = seedWhere(reader, (r) => r.winner === 'you' && r.cracks.you === 0);
    assert.equal(play('pair', cleanSeed, reader).rec.id, 'kept_pair');
    const ck = play('win', cleanSeed, reader).rec;
    assert.equal(ck.id, 'cold_kitchen');
    assert.equal(ck.burned, true);
    // throws that lose to his word: he wins, and takes back what is his
    const loser = (st, phase, call) => (st.caller === 'b' ? R.loserTo(call.promise) : 'rock');
    const chair = play('win', seedWhere(loser, (r) => r.winner === 'ada'), loser);
    assert.equal(chair.result.winner, 'ada');
    assert.equal(chair.rec.id, 'chair');
    // a win with a broken word of yours on the way: the card stays, and the machine's win is SON OYUN
    const breaker = (st, phase, call) => (st.caller === 'b' ? (call.tell ? call.promise : R.counterOf(call.promise)) : phase === 'promise' ? 'rock' : st.round <= 2 ? 'paper' : 'rock');
    const cracked = seedWhere(breaker, (r) => r.winner === 'you' && r.cracks.you > 0);
    assert.equal(play('pair', cracked, breaker).rec.id, 'last_game');
  });

  test('restart rule: a save taken while the Wager is due resumes with it due again, and the same seed plays the same match', () => {
    const run = at(8, 704);
    paidDawn(run);
    assert.equal(run.wagerDue(), true);
    const snap = JSON.parse(JSON.stringify(run.snapshot()));
    const store = { data: { resume: snap }, update(fn) { fn(this.data); }, flush() {} };
    const back = RUN.resumeRun(store, { home: true });
    assert.equal(back.wagerDue(), true);
    assert.equal(back.seed, run.seed);
    assert.deepEqual(drive(back.seed, reader).calls, drive(run.seed, reader).calls);
    back.dispose();
    run.dispose();
  });

  test('story Watch beats: the Audit on Night 7\'s second Watch, the reveal on Night 8\'s, never on the end of a Dawn', () => {
    assert.equal(CH.watchBeat(7, 2), 'audit');
    assert.equal(CH.watchBeat(8, 2), 'reveal');
    for (const [n, w] of [[7, 1], [7, 3], [8, 1], [6, 2], [8, 3]]) assert.equal(CH.watchBeat(n, w), null, `${n}/${w}`);
    const run = at(7, 705, false);
    const beats = [], windows = [];
    const offs = [
      EV.bus.on('watch:begin', ({ night, watch }) => { const b = CH.watchBeat(night, watch); if (b) beats.push(`${b}@${night}/${watch}`); }),
      EV.bus.on('run:window', (e) => windows.push(e)),
    ];
    const endWatch = () => { run.tick(5); run.phase = 'closing'; run.watchPulls = 2; run.settleWatch(); run.tick(1.6); };
    const night = () => {
      run.recomputeQuota();
      run.coins = 60;
      for (let w = 0; w < 8 && run.shift.phase !== 'collection'; w++) { assert.equal(run.startWatch(), true, `watch ${w + 1}`); endWatch(); }
      paidDawn(run);
    };
    night();
    assert.ok(run.openFloor(), 'the lever opens Night 8');
    night();
    for (const off of offs) off();
    assert.deepEqual(beats, ['audit@7/2', 'reveal@8/2']);
    assert.ok(windows.some((w) => w.window === 'watch'), 'the end of a Dawn still sends run:window, and it beats nothing');
    run.dispose();
  });
});
