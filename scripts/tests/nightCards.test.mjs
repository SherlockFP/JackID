// Night Cards (director): the two-card Dawn offer is seeded and deterministic, one card per Night, the 20 s timer auto-picks, each
// card's effect folds through the modifier pipeline (or its switch reaches the run), and the offer survives a save.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let NC, MOD, RUN, REG, EV, SCH, STR, IDS;
before(async () => {
  NC = await load('src/game/nightCards.ts');
  IDS = NC.NIGHT_CARDS.map((d) => d.id);
  MOD = await load('src/game/modifiers.types.ts');
  STR = await load('src/game/nightCards.strings.ts');
  RUN = await load('src/game/run.ts');
  REG = await load('src/machines/_base/registry.ts');
  EV = await load('src/core/events.ts');
  SCH = await load('src/game/data/schedule.ts');
  REG.load();
});

const SEEDS = Array.from({ length: 300 }, (_, i) => i + 1);
const NIGHTS = Array.from({ length: 12 }, (_, i) => i + 1);

/** Fold the effects of one hook over a base, the way the pipeline does (unscoped run-level effects only). */
function foldHook(cards, hook, base) {
  const effs = cards.flatMap((d) => d.effects.filter((e) => e.hook === hook));
  return MOD.foldEffects(hook, base, effs);
}
const card = (id) => NC.nightCardDef(id);

test('the deck holds ten cards with distinct ids, one tone each, and strings in EN and TR', () => {
  assert.equal(NC.NIGHT_CARDS.length, 10);
  assert.equal(new Set(IDS).size, IDS.length, 'ids are distinct');
  for (const d of NC.NIGHT_CARDS) {
    assert.ok(['risk', 'boon', 'mixed'].includes(d.tone), `${d.id} tone`);
    for (const lang of ['en', 'tr']) {
      const s = STR.default[lang];
      assert.ok(s[`${d.id}.name`], `${lang} ${d.id}.name`);
      assert.ok(s[`${d.id}.desc`], `${lang} ${d.id}.desc`);
    }
  }
  for (const lang of ['en', 'tr']) {
    for (const tone of ['risk', 'boon', 'mixed']) assert.ok(STR.default[lang][`tone.${tone}`], `${lang} tone.${tone}`);
  }
});

test('the card face shows the concrete result for its Night (N2 quota 36): RUSH 36 -> 27 and 3 -> 2 Watches, DOUBLE DOWN 36 -> 54 and x1.3', () => {
  // A stub exact reader (the ladder quota x the card's multiplier): this test checks the line formats; the parity test below
  // checks the numbers against a real run.
  const pv = (id, idx = 1) => NC.nightCardPreview(card(id), idx, (m) => Math.round(SCH.quotaFor(idx) * m));
  assert.deepEqual(pv('rush_night'), [{ key: 'quota', vars: { from: 36, to: 27 } }, { key: 'watches', vars: { from: 3, to: 2 } }]);
  assert.deepEqual(pv('double_down'), [{ key: 'quota', vars: { from: 36, to: 54 } }, { key: 'payout', vars: { x: 1.3 } }]);
  assert.deepEqual(pv('lean_night'), [{ key: 'pulls', vars: { from: 7, to: 5 } }, { key: 'payout', vars: { x: 1.2 } }, { key: 'net', vars: { pct: -14 } }]);
  assert.deepEqual(pv('high_table'), [{ key: 'payout', vars: { x: 1.25 } }, { key: 'minBet', vars: { x: 2 } }]);
  assert.deepEqual(pv('quiet_night'), [{ key: 'payout', vars: { x: 0.95 } }, { key: 'interest', vars: { from: 50, to: 55 } }, { key: 'noFloor', vars: {} }]);
  assert.deepEqual(pv('bankers_night'), [{ key: 'payout', vars: { x: 0.9 } }, { key: 'interest', vars: { from: 50, to: 55 } }, { key: 'pawnShut', vars: {} }]);
  assert.deepEqual(pv('payday_night'), [{ key: 'quota', vars: { from: 36, to: 41 } }, { key: 'flat', vars: { n: 10 } }]);
  assert.deepEqual(pv('grace'), [{ key: 'grace', vars: { from: 4, to: 7 } }, { key: 'hot', vars: { from: 1, to: 0 } }]);
  assert.deepEqual(pv('charm_fair'), [{ key: 'quota', vars: { from: 36, to: 40 } }, { key: 'shelves', vars: { n: 2 } }, { key: 'discount', vars: { pct: 20 } }]);
  assert.deepEqual(pv('lamp_festival'), [{ key: 'quota', vars: { from: 36, to: 40 } }, { key: 'hot', vars: { from: 1, to: 2 } }, { key: 'cold', vars: { from: 1, to: 0 } }]);
  assert.deepEqual(pv('lamp_festival', 0), [{ key: 'quota', vars: { from: 24, to: 26 } }, { key: 'hot', vars: { from: 1, to: 2 } }], 'no COLD lamp to remove on Night 1');
  for (const d of NC.NIGHT_CARDS) {
    for (let idx = 0; idx < 8; idx++) {
      const lines = pv(d.id, idx);
      assert.ok(lines.length >= 1, `${d.id} shows at least one line on Night ${idx + 1}`);
      for (const p of lines) for (const lang of ['en', 'tr']) assert.ok(STR.default[lang][`prev.${p.key}`], `${lang} prev.${p.key}`);
    }
  }
});

test('no exact quota read means no quota line: the card never shows a ladder guess', () => {
  const lines = NC.nightCardPreview(card('double_down'), 1);
  assert.equal(lines.some((p) => p.key === 'quota'), false, 'no reader, no quota line');
  assert.deepEqual(lines, [{ key: 'payout', vars: { x: 1.3 } }]);
  assert.equal(NC.nightCardPreview(card('double_down'), 1, () => null).some((p) => p.key === 'quota'), false, 'a null read, no quota line');
});

/** A run at the Dawn that opens Night index `idx + 1`: Nights 1..idx paid at `over` x their quota (their first card settles). */
function dawnRun(seed, idx, over) {
  const run = RUN.createRun({ seed, mode: 'debt' });
  for (let i = 0; i <= idx; i++) {
    run.debtPaid = Math.ceil(run.quota.due * over);
    run.syncQuota();
    run.phase = 'collection';
    run.dawn();
    if (i < idx) assert.equal(run.openFloor(), true, `Night ${i + 1} opens`);
  }
  return run;
}

/** One real offer per card: the first (seed, Night 1-7) whose seeded offer holds it. */
function offerCasePerCard() {
  const found = new Map();
  for (let seed = 1; seed <= 300 && found.size < IDS.length; seed++) {
    for (const night of NIGHTS.slice(0, 7)) {
      for (const id of NC.nightCardOffer(seed, night)) if (!found.has(id)) found.set(id, { seed, night });
    }
  }
  return found;
}

test('preview parity: each card preview quota is the quota its Night opens with (real Dawns and offers, paid 1x and 1.6x)', () => {
  const cases = offerCasePerCard();
  assert.equal(cases.size, IDS.length, 'every card is offered on Nights 1-7 of some seed');
  for (const [id, { seed, night }] of cases) {
    for (const over of [1, 1.6, 2.2]) {   // 2.2 takes the golden overshoot (-5 % next quota)
      const where = `${id} seed ${seed} Night ${night} paid x${over}`;
      const r = dawnRun(seed, night - 1, over);
      const o = r.nightCardOffer();
      assert.ok(o && o.night === night && o.candidates.some((d) => d.id === id), `${where}: on offer`);
      const lines = NC.nightCardPreview(card(id), o.night, (m) => r.nextQuotaPreview(m)?.due ?? null);
      const q = lines.find((p) => p.key === 'quota');
      const baseline = r.nextQuotaPreview(1)?.due;
      assert.ok(Number.isFinite(baseline) && baseline > 0, `${where}: a plain quota read`);
      if (q) assert.equal(q.vars.from, baseline, `${where}: the card's from is the plain quota`);
      assert.equal(r.pickNightCard(id), true, `${where}: picked`);
      assert.equal(r.openFloor(), true, `${where}: the floor opens`);
      assert.equal(r.quota.due, q ? q.vars.to : baseline, `${where}: the quota the Night opens with`);
      r.dispose();
    }
  }
});

test('the offer is deterministic: the same seed and Night give the same two distinct cards in the same order', () => {
  for (const seed of SEEDS) {
    for (const night of NIGHTS) {
      const a = NC.nightCardOffer(seed, night);
      assert.deepEqual(a, NC.nightCardOffer(seed, night), `seed ${seed} night ${night}`);
      assert.equal(a.length, NC.NIGHT_CARD_OFFER_SIZE);
      assert.equal(new Set(a).size, a.length, `seed ${seed} night ${night}: distinct`);
      for (const id of a) assert.ok(NC.nightCardDef(id), `${id} is a known card`);
    }
  }
});

test('the offer varies by Night and by seed, and every card can be offered', () => {
  const seen = new Set();
  let differsByNight = 0;
  for (const seed of SEEDS) {
    for (const night of NIGHTS) {
      const a = NC.nightCardOffer(seed, night);
      a.forEach((id) => seen.add(id));
      if (night > 1 && a.join() !== NC.nightCardOffer(seed, night - 1).join()) differsByNight += 1;
    }
  }
  assert.equal(seen.size, IDS.length, 'every card appears in some offer');
  assert.ok(differsByNight > SEEDS.length * 5, 'consecutive Nights usually differ');
});

test('each card folds its declared effect through the pipeline', () => {
  assert.equal(foldHook([card('rush_night')], 'quota.mult', 1), 0.75);
  assert.equal(foldHook([card('double_down')], 'quota.mult', 1), 1.5);
  assert.equal(foldHook([card('double_down')], 'payout.mult', 1), 1.3);
  assert.equal(foldHook([card('lean_night')], 'payout.mult', 1), 1.2);
  assert.equal(foldHook([card('lean_night')], 'x.run.pullsAdd', 7), 5, 'LEAN: 2 fewer pulls');
  assert.equal(foldHook([card('high_table')], 'payout.mult', 1), 1.25);
  assert.equal(foldHook([card('quiet_night')], 'x.econ.interestAdd', 0), 0.05, 'QUIET: +5 points');
  assert.equal(foldHook([card('quiet_night')], 'payout.mult', 1), 0.95, 'QUIET: payouts x0.95 (its cost)');
  assert.equal(foldHook([card('bankers_night')], 'x.econ.interestAdd', 0), 0.05, 'BANKER: +5 points (director: not +10)');
  assert.equal(foldHook([card('bankers_night')], 'payout.mult', 1), 0.9, 'BANKER: payouts x0.9 (its cost)');
  assert.equal(foldHook([card('charm_fair')], 'quota.mult', 1), 1.1, 'CHARM FAIR: quota x1.1 (its cost)');
  assert.equal(foldHook([card('lamp_festival')], 'quota.mult', 1), 1.1, 'LAMP FESTIVAL: quota x1.1 (its cost)');
  assert.equal(foldHook([card('grace')], 'payout.mult', 1), 1, 'GRACE: no payout cut (its cost is the HOT lamp)');
  assert.equal(foldHook([card('charm_fair')], 'x.pawn.slots', 0), 2, 'CHARM FAIR: +2 shelves');
  assert.equal(foldHook([card('charm_fair')], 'shop.discount', 0), 0.2, 'CHARM FAIR: -20 % prices');
  assert.equal(foldHook([card('payday_night')], 'payout.flat', 0), 10);
  assert.equal(foldHook([card('payday_night')], 'quota.mult', 1), 1.15);
  assert.equal(foldHook([card('grace')], 'x.tilt.grace', 0), 3, 'GRACE: +3 tilt grace');
});

test('every card has a real cost beside its boon: a quota or payout up, a payout down, a Watch, pull or bet floor cost, interest down or the Pawn shut', () => {
  const costOf = (d) => {
    const fx = NC.nightCardFx(d.id);
    return d.effects.some((e) => (e.hook === 'quota.mult' && e.value > 1) || (e.hook === 'payout.mult' && e.value < 1)
      || (e.hook === 'payout.mult' && e.value > 1) || (e.hook === 'x.run.pullsAdd' && e.value < 0)
      || (e.hook === 'x.econ.interestAdd' && e.value < 0))
      || fx.watchAdd < 0 || fx.minBetMult > 1 || fx.pawnClosed || fx.hotLamps === 0 || fx.noColdLamps || fx.noFloorEvents;
  };
  for (const d of NC.NIGHT_CARDS) assert.ok(costOf(d), `${d.id} has a cost`);
});

test('the switches of each card are the ones the run reads', () => {
  assert.equal(NC.nightCardFx('rush_night').watchAdd, -1);
  assert.equal(NC.nightCardFx('quiet_night').noFloorEvents, true);
  const lamp = NC.nightCardFx('lamp_festival');
  assert.equal(lamp.hotLamps, 2);
  assert.equal(lamp.noColdLamps, true);
  assert.equal(NC.nightCardFx('high_table').minBetMult, 2);
  assert.equal(NC.nightCardFx('bankers_night').pawnClosed, true);
  assert.deepEqual(NC.nightCardFx(null), NC.NEUTRAL_NIGHT_CARD_FX, 'no card is neutral');
  assert.equal(NC.nightCardFx('grace').hotLamps, 0, 'GRACE: no HOT lamp this Night');
  assert.deepEqual(NC.nightCardFx('double_down'), NC.NEUTRAL_NIGHT_CARD_FX, 'a card with no switch is neutral');
});

test('LEAN NIGHT net is the payout times the pull ratio, and it is a loss on every base Night', () => {
  for (let idx = 0; idx < 8; idx++) {
    const nd = SCH.nightDef(idx);
    const lines = NC.nightCardPreview(card('lean_night'), idx);
    const net = lines.find((p) => p.key === 'net');
    const to = Math.max(1, nd.pulls - 2);
    assert.equal(net?.vars.pct, Math.round((1.2 * to / nd.pulls - 1) * 100), `Night ${idx + 1} net`);
    assert.ok(net.vars.pct < 0, `Night ${idx + 1}: LEAN is a net loss`);
  }
  assert.equal(NC.nightCardPreview(card('double_down'), 1).some((p) => p.key === 'net'), false, 'no pulls change, no net line');
});

test('every card has its own profile, and no offer ever holds two with the same profile', () => {
  const profiles = NC.NIGHT_CARDS.map((d) => NC.nightCardProfile(d));
  assert.equal(new Set(profiles).size, profiles.length, 'the deck has no two same-profile cards');
  assert.notEqual(NC.nightCardProfile(card('quiet_night')), NC.nightCardProfile(card('grace')), 'QUIET and GRACE differ');
  for (const seed of SEEDS) {
    for (const night of NIGHTS) {
      const ids = NC.nightCardOffer(seed, night);
      const ps = ids.map((id) => NC.nightCardProfile(card(id)));
      assert.equal(new Set(ps).size, ps.length, `seed ${seed} night ${night}: one profile each`);
    }
  }
});

test('HIGH TABLE moves no quota: its Night opens at the plain read, which already carries the golden overshoot discount', () => {
  let checked = 0;
  let discounted = 0;
  for (const seed of SEEDS.slice(0, 80)) {
    const r = dawnRun(seed, 0, 2.2);
    const o = r.nightCardOffer();
    if (o?.candidates.some((d) => d.id === 'high_table')) {
      const plain = r.nextQuotaPreview(1)?.due;
      const lines = NC.nightCardPreview(card('high_table'), o.night, (m) => r.nextQuotaPreview(m)?.due ?? null);
      assert.equal(lines.some((p) => p.key === 'quota'), false, `seed ${seed}: no quota line on HIGH TABLE`);
      if (plain < SCH.quotaFor(o.night)) discounted += 1;   // the -2 the QA bench showed: its ladder base ignored this discount
      assert.equal(r.pickNightCard('high_table'), true);
      assert.equal(r.openFloor(), true);
      assert.equal(r.quota.due, plain, `seed ${seed}: the Night opens at the plain read`);
      checked += 1;
    }
    r.dispose();
  }
  assert.ok(checked > 0, 'a HIGH TABLE offer exists in the sample');
  assert.ok(discounted > 0, 'the golden discount lowers some plain reads below the ladder');
});

test('a card stacks with other effects on its Night (boss rules still apply): folds are order-free', () => {
  const boss = { hook: 'quota.mult', op: 'mult', value: 0.8 };
  const rush = card('rush_night').effects.find((e) => e.hook === 'quota.mult');
  assert.equal(MOD.foldEffects('quota.mult', 1, [rush, boss]), MOD.foldEffects('quota.mult', 1, [boss, rush]));
  assert.ok(Math.abs(MOD.foldEffects('quota.mult', 1, [rush, boss]) - 0.6) < 1e-9);
});

test('the class keeps one card per Night: an offer opens once, a pick closes it, a second pick is refused', () => {
  let idx = 0;
  let touches = 0;
  const nc = new NC.NightCards(() => idx, 42, () => { touches += 1; });
  assert.equal(nc.pending(), false);
  assert.equal(nc.openOffer(1), true);
  assert.equal(nc.openOffer(1), false, 'an open offer does not reopen');
  assert.equal(nc.pending(), true);
  const view = nc.offerView();
  assert.equal(view.candidates.length, 2);
  assert.equal(view.night, 1);
  assert.equal(nc.pick('not_a_card'), false, 'an id not on offer is refused');
  const notOffered = IDS.find((id) => !view.candidates.some((d) => d.id === id));
  assert.equal(nc.pick(notOffered), false);
  const first = view.candidates[0].id;
  assert.equal(nc.pick(first), true);
  assert.equal(nc.pending(), false);
  assert.equal(nc.pick(view.candidates[1].id), false, 'the offer is closed after one pick');
  assert.equal(nc.openOffer(1), false, 'a Night offered once is never offered again');
  assert.equal(nc.openOffer(2), true, 'the next Dawn offers the next Night');
  assert.ok(touches >= 1, 'a pick invalidates the mod cache');
});

test('the card applies to its Night only: provider effects and the current card follow the index', () => {
  let idx = 0;
  const nc = new NC.NightCards(() => idx, 7, () => {});
  nc.openOffer(1);
  const first = nc.offerView().candidates[0].id;
  nc.pick(first);
  const out = [];
  nc.collect({}, out);
  assert.equal(out.length, 0, 'not yet: the Night still runs its previous index');
  assert.equal(nc.current(), null);
  idx = 1;
  const started = nc.started();
  assert.equal(started?.id, first);
  assert.equal(nc.fx().watchAdd, NC.nightCardFx(first).watchAdd);
  nc.collect({}, out);
  if (card(first).effects.length > 0) {
    assert.equal(out.length, 1);
    assert.equal(out[0].kind, 'event');
    assert.deepEqual(out[0].effects, card(first).effects);
  } else {
    assert.equal(out.length, 0, 'a switch-only card adds no pipeline effect');
  }
  idx = 2;
  assert.equal(nc.current(), null, 'the next Night has no card');
  assert.deepEqual(nc.fx(), NC.NEUTRAL_NIGHT_CARD_FX);
});

test('the 20 s timer auto-picks the first card when the player does not', () => {
  let idx = 0;
  const nc = new NC.NightCards(() => idx, 99, () => {});
  nc.openOffer(1);
  const ids = nc.offerView().candidates.map((d) => d.id);
  assert.equal(nc.tick(NC.NIGHT_CARD_TIMEOUT_SEC - 1), null, 'still open');
  assert.equal(nc.offerView().left > 0, true);
  assert.equal(nc.tick(2), ids[0], 'the first card is kept when the timer runs out');
  assert.equal(nc.pending(), false);
  idx = 1;
  assert.equal(nc.current()?.id, ids[0]);
});

test('the offer and the kept card survive a save and a reload', () => {
  let idx = 0;
  const a = new NC.NightCards(() => idx, 5, () => {});
  assert.equal(a.snapshot(), null, 'nothing to save before a Dawn');
  a.openOffer(1);
  a.tick(7);
  const ids = a.offerView().candidates.map((d) => d.id);
  const save = JSON.parse(JSON.stringify(a.snapshot()));
  const b = new NC.NightCards(() => idx, 5, () => {});
  b.restore(save);
  assert.deepEqual(b.offerView().candidates.map((d) => d.id), ids);
  assert.ok(Math.abs(b.offerView().left - (NC.NIGHT_CARD_TIMEOUT_SEC - 7)) < 1e-9, 'the timer resumes where it stopped');
  assert.equal(b.openOffer(1), false, 'a reload cannot reopen the same Dawn');
  assert.equal(b.pick(ids[1]), true);
  const c = new NC.NightCards(() => 1, 5, () => {});
  c.restore(JSON.parse(JSON.stringify(b.snapshot())));
  assert.equal(c.pending(), false);
  idx = 1;
  assert.equal(c.current()?.id, ids[1], 'the kept card is still on the Night after a reload');
  const junk = new NC.NightCards(() => 0, 5, () => {});
  junk.restore({ offer: { night: 1, ids: ['nope'], left: 3 }, kept: { night: 1, id: 'nope' } });
  assert.equal(junk.pending(), false, 'unknown ids are dropped');
  assert.equal(junk.current(), null);
});

test('the Dawn hook opens one offer per paid Dawn from Night 1 on; the pick applies to Night 2', () => {
  const run = RUN.createRun({ seed: 311, mode: 'debt' });
  const seen = [];
  const off = EV.bus.on('run:nightcard', (e) => { seen.push(e.state); });
  assert.equal(run.nightCardOffer(), null, 'no offer before the first Dawn');
  run.index = 0;
  run.debtPaid = run.quota.due;
  run.syncQuota();
  run.phase = 'collection';
  run.dawn();
  const offer = run.nightCardOffer();
  assert.ok(offer, 'the Dawn of Night 1 opens the offer for Night 2');
  assert.equal(offer.night, 1);
  assert.equal(offer.candidates.length, 2);
  assert.deepEqual(offer.candidates.map((d) => d.id), NC.nightCardOffer(311, 1).map((id) => NC.nightCardDef(id).id));
  assert.equal(run.pickNightCard('not_a_card'), false);
  const keep = offer.candidates[0].id;
  assert.equal(run.pickNightCard(keep), true);
  assert.equal(run.pickNightCard(offer.candidates[1].id), false, 'one card per Night');
  assert.equal(run.nightCardOffer(), null);
  assert.equal(run.nightCard(), null, 'the card is not in play before its Night');
  assert.equal(run.openFloor(), true, 'OPEN THE FLOOR works once the card is kept');
  assert.equal(run.index, 1);
  assert.equal(run.nightCard()?.id, keep);
  const fx = NC.nightCardFx(keep);
  assert.equal(run.watches, Math.max(1, SCH.nightDef(1).watches + fx.watchAdd), 'the switch reaches the Watch count');
  off();
  assert.ok(seen.includes('offer') && seen.includes('picked') && seen.includes('started'), `events ${seen.join(',')}`);
  run.dispose();
});

test('OPEN THE FLOOR with the offer still open settles it with the first card (the Night never waits on an answer)', () => {
  const run = RUN.createRun({ seed: 314, mode: 'debt' });
  run.index = 0;
  run.debtPaid = run.quota.due;
  run.syncQuota();
  run.phase = 'collection';
  run.dawn();
  const first = run.nightCardOffer().candidates[0].id;
  assert.equal(run.openFloor(), true, 'the floor opens');
  assert.equal(run.nightCardOffer(), null, 'the offer is closed');
  assert.equal(run.nightCard()?.id, first, 'the first card rides the Night');
  assert.equal(run.index, 1);
  run.dispose();
});

test('the Dawn offer auto-picks after its 20 s and the floor opens without the player', () => {
  const run = RUN.createRun({ seed: 312, mode: 'debt' });
  run.index = 0;
  run.debtPaid = run.quota.due;
  run.syncQuota();
  run.phase = 'collection';
  run.dawn();
  const first = run.nightCardOffer().candidates[0].id;
  run.tick(NC.NIGHT_CARD_TIMEOUT_SEC + 1);
  assert.equal(run.nightCardOffer(), null, 'the timer closed the offer');
  assert.equal(run.openFloor(), true);
  assert.equal(run.nightCard()?.id, first, 'the first card was kept');
  run.dispose();
});

test('a run with no Dawn offer has no card, and its mods are unchanged', () => {
  const plain = RUN.createRun({ seed: 313, mode: 'debt' });
  const base = plain.quota.due;
  assert.equal(plain.nightCard(), null);
  assert.equal(plain.nightCardOffer(), null);
  assert.equal(plain.getModifier('quota.mult', 'run', 1), 1);
  plain.dispose();
  assert.ok(base > 0);
});
