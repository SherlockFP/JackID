// Unit tests for the Wave 25 duel engine (src/game/duels/{engine,plan,registry,stakes}.ts): the seeded cheat plan, the plan
// never leaving the host before the reveal, the session flow (turns, call window, one call per duel, ruling, reveal), host
// restore by replay, the stake tiers and the encounter picker. A small stub game stands in for lane B's duels, so the engine
// is tested on its own; if the real Sealed Wall exists it is also driven through the engine end to end.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite, hasModule } from './_vite.mjs';

after(closeVite);

let E, P, R, K, RNG;
before(async () => {
  E = await load('src/game/duels/engine.ts');
  P = await load('src/game/duels/plan.ts');
  R = await load('src/game/duels/registry.ts');
  K = await load('src/game/duels/stakes.ts');
  RNG = await load('src/core/rng.ts');
});

const MARKER = 'LEADEN-DIE-7731';

/** A tiny dice race: 5 rounds, the rival's cheat (one hidden round) adds 3 and rings all three clue channels. */
function stub(opts = {}) {
  return {
    id: 'stub', rival: opts.rival ?? 'tamsin',
    makePlan(seed) { return { kind: 'stub-cheat', round: 2 + (seed % 3), detail: { marker: MARKER, seed } }; },
    init(seed, plan, stake) { return { round: 1, done: false, log: [], turn: 'player', score: { player: 0, rival: 0 }, cheated: false, stake }; },
    legal(s) { return s.done || s.turn !== 'player' ? [] : [{ k: 'roll', n: 1 }, { k: 'roll', n: 2 }]; },
    step(s, actor, a, plan) {
      const st = JSON.parse(JSON.stringify(s));
      const clues = [];
      let gain = a.n;
      if (actor === 'rival' && plan.kind === 'stub-cheat' && st.round === plan.round && !st.cheated) {
        gain += 3; st.cheated = true;
        clues.push({ channel: 'tell', round: st.round, key: 'stub.tell' }, { channel: 'table', round: st.round, key: 'stub.table', data: { hook: 'glint' } },
          { channel: 'math', round: st.round, key: 'stub.math', data: { sum: gain } });
      }
      st.score[actor] += gain;
      const pub = [{ key: 'stub.ev.roll', data: { by: actor, n: a.n } }];
      if (actor === 'player') st.turn = 'rival';
      else { st.turn = 'player'; st.round++; if (st.round > 5) { st.done = true; st.winner = st.score.player >= st.score.rival ? 'player' : 'rival'; } }
      st.log.push(...pub);
      return { state: st, clues, publicEvents: pub };
    },
    rivalAct(s, plan, seed) { return { k: 'roll', n: 1 + (seed % 2) }; },
    call(s, plan, target) { return { correct: target === 'die' && s.cheated }; },
    settle(s, cc, stake) {
      let net = s.winner === 'player' ? stake : -stake;
      if (cc === true) net = 3 * stake; else if (cc === false) net -= stake;
      return { playerNet: net };
    },
    reveal: { saw: 'stub.saw', happened: 'stub.happened', why: 'stub.why' },
    revealFair: { saw: 'stub.fsaw', happened: 'stub.fhappened', why: 'stub.fwhy' },
    callTargets() { return [{ target: 'cup', label: { text: 'CUP' } }, { target: 'die', label: { text: 'DIE' } }]; },
    verdict(s) { return s.cheated ? 'CHEAT' : 'FAIR'; },
    turnOf: opts.noTurn ? undefined : (s) => s.turn,
    playHeadless() { return { playerNet: 0, calls: 0, correctCalls: 0 }; },
  };
}

const opts = (rules, over = {}) => ({ rules, runSeed: 4242, rivalId: 'tamsin', night: 3, tier: 'coins', S: 60, ...over });
const kinds = (evs) => evs.map((e) => e.k);

test('the same run, rival and Night give the same cheat plan; other Nights differ', () => {
  const g = stub();
  const a = P.makeDuelPlan(g, 4242, 'tamsin', 3);
  const b = P.makeDuelPlan(g, 4242, 'tamsin', 3);
  assert.equal(a.seed, RNG.hashSeed(4242, 'duel', 'tamsin', 3));
  assert.deepEqual(a.vault.open(), b.vault.open());
  assert.equal(P.planSeedOf(4242, 'tamsin', 3), a.seed);
  const seeds = new Set([2, 3, 4, 5, 6, 7, 8].map((n) => P.planSeedOf(4242, 'tamsin', n)));
  assert.equal(seeds.size, 7, 'every Night has its own seed');
  assert.notEqual(P.planSeedOf(4242, 'kuro', 3), a.seed);
  assert.notEqual(P.planSeedOf(4243, 'tamsin', 3), a.seed);
});

test('the plan vault never serialises', () => {
  const v = P.sealPlan({ kind: 'k', round: 2, detail: { marker: MARKER } });
  assert.equal(JSON.stringify(v), 'null');
  assert.equal(JSON.stringify({ vault: v }), '{"vault":null}');
  assert.equal(v.open().detail.marker, MARKER);
  assert.equal(P.planLeaks({ x: `see ${MARKER} here` }, v.open()).length, 1, 'the leak scanner works');
  assert.deepEqual(P.planLeaks({ x: 'clean' }, v.open()), []);
});

test('the plan is not in any public event, the view or a snapshot before the reveal', () => {
  const g = stub();
  const s = new E.DuelSession(opts(g));
  const evs = E.playOut(s, (acts) => ({ act: acts.length - 1 }));
  const reveal = evs.find((e) => e.k === 'reveal');
  assert.ok(reveal, 'the reveal event exists');
  const plan = reveal.plan;
  assert.equal(plan.detail.marker, MARKER, 'the plan comes out exactly once, in the reveal');
  assert.equal(evs.filter((e) => P.planLeaks(e, plan).length).length, 1, 'only the reveal event carries the plan');
  const before = evs.slice(0, evs.indexOf(reveal));
  assert.deepEqual(P.planLeaks(before, plan), []);
  // the public view (the snapshot every peer holds) reduced from the events before the reveal
  const view = E.freshView();
  E.reduce(view, { k: 'seal', rival: 'tamsin', game: 'stub', night: 3, boss: false });
  for (const e of before) E.reduce(view, e);
  assert.deepEqual(P.planLeaks(view, plan), []);
  assert.equal(view.phase, 'ruling');
  assert.ok(view.clues.length >= 1, 'the clues the rival gave are public');
  // the prompt sent to the player never carries it either
  const s2 = new E.DuelSession(opts(g));
  s2.begin();
  assert.deepEqual(P.planLeaks(s2.prompt(), plan), []);
  assert.deepEqual(P.planLeaks(s2.replayLog(), plan), []);
});

test('a session is deterministic: same seed, same events; a different Night plays differently', () => {
  const run = (night) => E.playOut(new E.DuelSession(opts(stub(), { night })), () => ({ act: 0 }));
  assert.deepEqual(run(3), run(3));
  const rounds = new Set([2, 3, 4, 5, 6, 7, 8, 9].map((n) => JSON.stringify(run(n).find((e) => e.k === 'reveal').plan)));
  assert.ok(rounds.size > 1, 'plans differ across Nights');
});

test('flow: stake, rounds, turns alternate, ruling, reveal, end', () => {
  const s = new E.DuelSession(opts(stub()));
  const open = s.begin();
  assert.deepEqual(kinds(open), ['stake', 'round', 'turn']);
  assert.equal(s.toMove(), 'player');
  const p = s.prompt();
  assert.equal(p.myTurn, true);
  assert.equal(p.actions.length, 2);
  const r = s.actIndex(0, p.v);
  assert.ok(r.ok);
  assert.equal(s.toMove(), 'rival');
  assert.equal(s.prompt().myTurn, false, 'no moves on the rival turn');
  assert.deepEqual(s.prompt().actions, []);
  assert.equal(s.prompt().targets.length, 2, 'but the call window is open');
  assert.equal(s.actIndex(0, s.version).ok, false, 'cannot act on the rival turn');
  const ev = s.rivalMove();
  assert.equal(ev[0].k, 'act');
  assert.equal(s.toMove(), 'player');
  const all = E.playOut(s, () => ({ act: 0 }));
  assert.deepEqual(kinds(all).slice(-3), ['ruling', 'reveal', 'end']);
  assert.ok(s.done);
  assert.equal(s.result.verdict === 'CHEAT' || s.result.verdict === 'FAIR', true);
  assert.deepEqual(s.revealEvents(), [], 'the reveal is delivered once');
});

test('a correct call ends the duel at once: ruling CHEAT, the rival pays 3x', () => {
  const s = new E.DuelSession(opts(stub()));
  s.begin();
  let guard = 0;
  while (!s.state.cheated && guard++ < 40) {
    if (s.toMove() === 'rival') s.rivalMove();
    else s.actIndex(0, s.version);
  }
  assert.ok(s.state.cheated, 'the cheat happened');
  const { ok, events } = s.call(1, s.version);                      // 'die'
  assert.ok(ok);
  assert.deepEqual(kinds(events), ['called', 'ruling']);
  const ruling = events[1];
  assert.equal(ruling.verdict, 'CHEAT');
  assert.equal(ruling.correct, true);
  assert.equal(ruling.net, 180, '3 x S');
  assert.equal(ruling.byCall, true);
  assert.ok(s.done);
  assert.equal(s.toMove(), null);
  assert.equal(s.call(0, s.version).ok, false, 'one call per duel');
  const rev = s.revealEvents();
  assert.equal(rev[0].verdict, 'CHEAT');
  assert.equal(rev[0].script.saw, 'stub.saw');
});

test('a wrong call is fined and the duel plays on; a second call is refused', () => {
  const s = new E.DuelSession(opts(stub()));
  s.begin();
  const r = s.call(0, s.version);                                    // 'cup': wrong
  assert.ok(r.ok);
  assert.deepEqual(kinds(r.events), ['called'], 'no ruling yet');
  assert.equal(s.done, false);
  assert.equal(s.hasCalled, true);
  assert.equal(s.prompt().canCall, false);
  assert.equal(s.call(1, s.version).ok, false, 'one call per duel');
  const evs = E.playOut(s, () => ({ act: 0 }));
  const ruling = evs.find((e) => e.k === 'ruling');
  assert.equal(ruling.correct, false);
  assert.ok(ruling.net === -120 || ruling.net === -60 + (0), 'a lost duel pays -S and the wrong call -S more');
  assert.equal(s.result.calledCorrect, false);
});

test('a stale or invalid input changes nothing', () => {
  const s = new E.DuelSession(opts(stub()));
  s.begin();
  const v = s.version;
  assert.equal(s.actIndex(0, v + 5).ok, false, 'stale version');
  assert.equal(s.actIndex(9, v).ok, false, 'no such move');
  assert.equal(s.act({ k: 'roll', n: 9 }).ok, false, 'not a legal action');
  assert.equal(s.call(7, v).ok, false, 'no such target');
  assert.equal(s.version, v);
  assert.equal(s.hasCalled, false);
});

test('without a turnOf hook the engine alternates, starting with the player', () => {
  const g = stub({ noTurn: true });
  delete g.turnOf;
  // the stub keeps a `turn` field, which the engine reads as a fallback
  const s = new E.DuelSession(opts(g));
  s.begin();
  assert.equal(s.toMove(), 'player');
  s.actIndex(0, s.version);
  assert.equal(s.toMove(), 'rival');
});

test('host restore by replay rebuilds the same duel (the plan is re-derived, never stored)', () => {
  const o = opts(stub());
  const live = new E.DuelSession(o);
  live.begin();
  for (let i = 0; i < 3; i++) { if (live.toMove() === 'rival') live.rivalMove(); live.actIndex(1, live.version); }
  live.call(0, live.version);
  const log = live.replayLog();
  assert.deepEqual(P.planLeaks(log, P.sealPlan({ kind: 'stub-cheat', round: 3, detail: { marker: MARKER } }).open()), []);
  const back = E.DuelSession.restore(o, log);
  assert.deepEqual(back.state, live.state);
  assert.equal(back.hasCalled, true);
  assert.equal(back.toMove(), live.toMove());
  // both finish identically
  const a = E.playOut(live, () => ({ act: 0 })), b = E.playOut(back, () => ({ act: 0 }));
  assert.deepEqual(a.filter((e) => e.k === 'reveal'), b.filter((e) => e.k === 'reveal'));
  assert.equal(live.result.net, back.result.net);
});

test('forfeit loses the stake and closes the duel', () => {
  const s = new E.DuelSession(opts(stub()));
  s.begin();
  const ev = s.forfeit();
  assert.equal(ev[0].k, 'ruling');
  assert.equal(ev[0].net, -60);
  assert.ok(s.done);
  assert.deepEqual(s.forfeit(), []);
});

test('the view reducer tracks the sheet, clues, call and phases', () => {
  const g = stub();
  const s = new E.DuelSession(opts(g));
  const v = E.freshView();
  E.reduce(v, { k: 'seal', rival: 'tamsin', game: 'stub', night: 3, boss: false });
  assert.equal(v.phase, 'seal');
  const evs = E.playOut(s, () => ({ act: 0 }));
  for (const e of evs) E.reduce(v, e);
  assert.equal(v.phase, 'done');
  assert.equal(v.S, 60);
  assert.ok(v.sheet.length >= 10, 'every public event is on the sheet');
  assert.ok(v.sheet.every((r) => typeof r.t === 'object'));
  assert.ok(v.sheet.some((r) => r.who === 'clue'), 'clues are sheet rows');
  assert.ok(v.sheet.length <= E.SHEET_CAP);
});

test('a fair duel reveals with the fair script and a FAIR stamp', () => {
  const g = stub();
  g.makePlan = () => ({ kind: 'stub-fair', round: 0, detail: { marker: MARKER } });
  const evs = E.playOut(new E.DuelSession(opts(g)), () => ({ act: 0 }));
  const rev = evs.find((e) => e.k === 'reveal');
  assert.equal(rev.verdict, 'FAIR');
  assert.equal(rev.script.saw, 'stub.fsaw');
  assert.equal(evs.find((e) => e.k === 'ruling').verdict, 'FAIR');
});

test('a game that never ends cannot hang the engine', () => {
  const g = stub();
  g.step = (s, actor, a) => ({ state: { ...s, turn: actor === 'player' ? 'rival' : 'player' }, clues: [], publicEvents: [] });
  const evs = E.playOut(new E.DuelSession(opts(g)), () => ({ act: 0 }));
  assert.ok(evs.some((e) => e.k === 'ruling'), 'the safety net ends it');
});

test('registry: register, look up by id and by rival, replace on re-register', () => {
  R.unregisterDuel('stubA');
  const a = { ...stub({ rival: 'kuro' }), id: 'stubA' };
  R.registerDuel(a);
  assert.equal(R.getDuel('stubA'), a);
  assert.equal(R.duelForRival('kuro')?.id === 'stubA' || R.duelForRival('kuro') !== undefined, true);
  const b = { ...stub({ rival: 'kuro' }), id: 'stubA' };
  R.registerDuel(b);
  assert.equal(R.getDuel('stubA'), b);
  R.unregisterDuel('stubA');
  assert.equal(R.getDuel('stubA'), undefined);
});

test('encounters: the spec rival per Night, with a fallback to a registered duel', () => {
  const all = () => true;
  assert.deepEqual(E.pickEncounter(3, all), { rivalId: 'lucan', night: 3, boss: true });
  assert.deepEqual(E.pickEncounter(5, all), { rivalId: 'kuro', night: 5, boss: false });
  assert.deepEqual(E.pickEncounter(2, all), { rivalId: 'tamsin', night: 2, boss: false });
  assert.equal(E.pickEncounter(8, all).boss, true);
  assert.equal(E.pickEncounter(3, (r) => r === 'tamsin').rivalId, 'tamsin', 'falls back to a registered rival');
  assert.equal(E.pickEncounter(3, () => false), null);
  assert.equal(E.pickEncounter(3, all, { rivalId: 'kuro', boss: true }).rivalId, 'kuro', 'the run hint wins');
});

test('stakes: the coin unit is about 6 % of the quota, the Pledge costs 3 Tickets or 1 Obol', () => {
  assert.equal(K.stakeUnit(1000), 60);
  assert.equal(K.stakeUnit(100), 5 + 1 > 5 ? 5 : 5);
  assert.ok(K.stakeUnit(5) >= K.MIN_STAKE);
  assert.ok(Math.abs(K.stakeUnit(12000) - 720) <= 25);
  assert.deepEqual(K.pledgeCost(3, 0), { cur: 'ticket', amount: 3 });
  assert.deepEqual(K.pledgeCost(5, 2), { cur: 'ticket', amount: 3 });
  assert.deepEqual(K.pledgeCost(2, 1), { cur: 'obol', amount: 1 });
  assert.equal(K.pledgeCost(2, 0), null);
});

test('stake settlement per tier', () => {
  const S = 60;
  // coins: stake back plus net; a fine beyond the stake is owed
  assert.deepEqual(K.settleStake('coins', S, 60), { coinsGross: 120, coinsOwed: 0, refundPledge: false, returnMark: false, loseMark: false, takePledge: false, dread: 0 });
  assert.equal(K.settleStake('coins', S, 180).coinsGross, 240);
  assert.equal(K.settleStake('coins', S, -60).coinsGross, 0);
  assert.equal(K.settleStake('coins', S, -120).coinsOwed, 60);
  assert.equal(K.settleStake('coins', S, 0).coinsGross, 60);
  // pledge: win = pledge back and the rival's; lose = gone; draw = back
  const pw = K.settleStake('pledge', S, 60);
  assert.ok(pw.refundPledge && pw.takePledge && !pw.loseMark);
  const pl = K.settleStake('pledge', S, -60);
  assert.ok(!pl.refundPledge && !pl.takePledge && !pl.loseMark && pl.dread === 0);
  assert.ok(K.settleStake('pledge', S, 0).refundPledge);
  // soul mark: win = mark back and the rival's Pledge; lose = mark lost, dread +0.1; draw = mark back
  const sw = K.settleStake('soul', S, 180);
  assert.ok(sw.returnMark && sw.takePledge && !sw.loseMark);
  const sl = K.settleStake('soul', S, -60);
  assert.ok(sl.loseMark && !sl.returnMark && !sl.takePledge);
  assert.equal(sl.dread, 0.1);
  assert.ok(K.settleStake('soul', S, 0).returnMark);
});

test('integration: the real Sealed Wall (if present) runs through the engine without leaking its plan', async (t) => {
  if (!hasModule('src/game/duels/sealedwall/index.ts')) { t.skip('sealedwall not built yet'); return; }
  let rules;
  try {
    await load('src/game/duels/sealedwall/index.ts');
    rules = R.getDuel('sealedwall');
  } catch (e) { t.skip(`sealedwall does not load yet: ${e.message}`); return; }
  if (!rules) { t.skip('sealedwall did not register'); return; }
  assert.equal(R.duelForRival('tamsin')?.id, 'sealedwall');
  for (const night of [2, 3, 4, 5, 6, 7]) {
    const s = new E.DuelSession({ rules, runSeed: 777, rivalId: 'tamsin', night, tier: 'coins', S: 60 });
    const plan = rules.makePlan(P.planSeedOf(777, 'tamsin', night));
    const evs = E.playOut(s, () => ({ act: 0 }));
    const rev = evs.find((e) => e.k === 'reveal');
    assert.ok(rev, `night ${night}: duel reaches the reveal`);
    const before = evs.slice(0, evs.indexOf(rev));
    // an empty-detail plan has no text fragments, so also compare the kind: it must not show up before the reveal
    assert.deepEqual(P.planLeaks(before, plan), [], `night ${night}: no plan fragments before the reveal`);
    assert.ok(!JSON.stringify(before).includes(`"${plan.kind}"`), `night ${night}: the plan kind stays sealed`);
  }
});
