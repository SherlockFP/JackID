// Unit tests for wave 8 items 3, 4 and 6: the ten engine charms (src/game/charms/engines.ts, data/charmsEngines.ts),
// Boss Nights (src/game/bosses.ts, data/bosses.ts) and starting kits (data/kits.ts). Engine maxima are asserted against
// the plan's Max column, not against the code's own constants.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let E, D, B, BD, K, C, M;
before(async () => {
  E = await load('src/game/charms/engines.ts');
  D = await load('src/game/data/charmsEngines.ts');
  B = await load('src/game/bosses.ts');
  BD = await load('src/game/data/bosses.ts');
  K = await load('src/game/data/kits.ts');
  C = await load('src/game/data/charms.ts');
  M = await load('src/game/modifiers.types.ts');
});

// ── fakes ───────────────────────────────────────────────────────────────────────────────────────
/** A run facade with only what the engine charms read. `circuit` is the Circuit view (null = Circuit off). */
function fakeRun(o = {}) {
  return {
    shift: {
      state: () => ({ phase: o.phase ?? 'play', segment: o.segment }),
      quota: () => ({ met: o.met ?? false, ratio: o.ratio ?? 0 }),
    },
    balance: (cur) => (cur === 'ticket' ? (o.tickets ?? 0) : 0),
    charms: () => o.charms ?? [],
    earn: (cur, n, reason) => { (o.earned ??= []).push([cur, n, reason]); },
    grantCharm: () => true,
    circuit: o.circuit ?? null,
  };
}
const live = (data = {}, o = {}) => ({ data, run: fakeRun(o), pid: 0 });
const ctx = (data, o = {}) => ({ data, run: fakeRun(o), pid: 0, stacks: 1, rng: null, proc() { (o.procs ??= []).push(1); } });
/** A Circuit view: `tilts` maps instance id → TiltView, `hot`/`cold` are instance ids. */
function circuit({ tilts = {}, hot = [], cold = [] } = {}) {
  return {
    active: () => true,
    tilt: (mid) => tilts[mid] ?? null,
    lamps: () => ({ hot: hot.map((mid) => ({ mid, machineId: 'bigone' })), cold: cold.map((mid) => ({ mid, machineId: 'blackjack' })) }),
  };
}
const tilt = (o) => ({ plays: 0, lit: 4, step: 0, factor: 1, hot: false, cold: false, lamp: 1, ...o });
const play = (o) => ({ mid: 'm1', machineId: 'bigone', pid: 0, bet: 10, gross: 0, credited: 0, tier: 'none', tags: [], ...o });

/** Product of the M (mult) effects on payout.mult, and sum of the A (inc) effects. */
function payoutOf(effects) {
  let m = 1, a = 0;
  for (const e of effects) {
    if (e.hook !== 'payout.mult') continue;
    if (e.op === 'mult') m *= e.value;
    if (e.op === 'inc') a += e.value;
  }
  return { m, a };
}
const near = (x, y) => assert.ok(Math.abs(x - y) < 1e-9, `expected ${y}, got ${x}`);

// ── item 3: data ────────────────────────────────────────────────────────────────────────────────
test('engine data: ten charms, unique ids, none clashing with the base catalogue', () => {
  const ids = D.CHARM_ENGINE_DATA.map((d) => d.id);
  assert.equal(ids.length, 10);
  assert.equal(new Set(ids).size, 10);
  const base = new Set(C.CHARM_DATA.map((d) => d.id));
  for (const id of ids) assert.ok(!base.has(id), `${id} clashes with data/charms.ts`);
});

test('engine data: rarity, price and unlock match the plan table', () => {
  const want = {
    suit_ladder: ['rare', 42, 'N3'], pressure_valve: ['uncommon', 20, 'N2'], capacitor: ['rare', 42, 'N4'],
    lampwick: ['uncommon', 22, 'N3'], ticket_press: ['uncommon', 18, 'N2'], last_gasp: ['rare', 40, 'N3'],
    understudy: ['legendary', 95, 'N5'], false_ceiling: ['legendary', 100, 'N6'], gilded_chip: ['uncommon', 20, 'N2'],
    snowball_ledger: ['uncommon', 20, 'N2'],
  };
  for (const d of D.CHARM_ENGINE_DATA) assert.deepEqual([d.rarity, d.price, d.unlock], want[d.id], d.id);
});

test('engine data: every charm has one archetype and all six archetypes are used', () => {
  const tags = D.CHARM_ENGINE_DATA.map((d) => d.tags);
  for (const t of tags) assert.equal(t.length, 1);
  assert.deepEqual([...new Set(tags.map((t) => t[0]))].sort(), [...D.ENGINE_ARCHETYPES].sort());
});

test('engine data: every charm has EN and TR names and descriptions', () => {
  for (const d of D.CHARM_ENGINE_DATA) {
    for (const lang of ['en', 'tr']) {
      assert.ok(d.strings[lang].name.length > 0, `${d.id} ${lang} name`);
      assert.ok(d.strings[lang].desc.length > 0, `${d.id} ${lang} desc`);
    }
  }
});

// ── item 3: maximum multipliers (plan Max column) ───────────────────────────────────────────────
test('max: Suit Ladder is ×1.72 at six Rungs and never more', () => {
  const dyn = E.ENGINE_DYNAMIC_EFFECTS.suit_ladder;
  near(payoutOf(dyn(live({ rungs: 6 }))).m, 1.72);
  const h = E.ENGINE_BEHAVIOURS.suit_ladder.on['machine:result'];
  const c = ctx({});
  for (let i = 0; i < 12; i++) h(play({ tags: [['reels', 'cards', 'dice', 'wheels', 'drops', 'curios'][i % 6]] }), c);
  assert.equal(c.data.rungs, 6);
});

test('max: Pressure Valve is ×1.8 at eight Pressure and never more', () => {
  near(payoutOf(E.ENGINE_DYNAMIC_EFFECTS.pressure_valve(live({ pressure: 8 }))).m, 1.8);
  const h = E.ENGINE_BEHAVIOURS.pressure_valve.on['machine:result'];
  const c = ctx({});
  for (let i = 0; i < 12; i++) h(play({ gross: 0 }), c);
  assert.equal(c.data.pressure, 8);
});

test('max: Capacitor is ×2.5 at six charge, only on Hot instances', () => {
  const dyn = E.ENGINE_DYNAMIC_EFFECTS.capacitor;
  const eff = dyn(live({ charge: 6 }, { circuit: circuit({ hot: ['hot1'] }) }));
  near(payoutOf(eff).m, 2.5);
  assert.deepEqual(eff[0].scope, { instances: ['hot1'] });
  assert.equal(M.scopeMatches(eff[0].scope, { machineId: 'bigone', instance: 'hot1' }), true);
  assert.equal(M.scopeMatches(eff[0].scope, { machineId: 'bigone', instance: 'cold1' }), false);
});

test('max: Capacitor charges on Cold or tilted plays and caps at six', () => {
  const h = E.ENGINE_BEHAVIOURS.capacitor.on['machine:result'];
  const c = ctx({}, { circuit: circuit({ tilts: { c1: tilt({ cold: true, factor: 0.75 }), t1: tilt({ factor: 0.6, step: 2 }), h1: tilt({ hot: true }) } }) });
  h(play({ mid: 'c1' }), c);
  h(play({ mid: 't1' }), c);
  h(play({ mid: 'h1' }), c);
  assert.equal(c.data.charge, 2);
  for (let i = 0; i < 10; i++) h(play({ mid: 'c1' }), c);
  assert.equal(c.data.charge, 6);
});

test('max: Capacitor pays on the next Hot win and then resets', () => {
  const h = E.ENGINE_BEHAVIOURS.capacitor.on['machine:result'];
  const c = ctx({ charge: 4 }, { circuit: circuit({ tilts: { h1: tilt({ hot: true }) } }) });
  h(play({ mid: 'h1', gross: 0 }), c);
  assert.equal(c.data.charge, 4, 'a loss on Hot does not spend the charge');
  h(play({ mid: 'h1', gross: 30 }), c);
  assert.equal(c.data.charge, 0);
});

test('max: Lampwick adds +0.08 per wick, +0.48 at six, and only on Hot wins', () => {
  near(E.ENGINE_DYNAMIC_EFFECTS.lampwick(live({ wicks: 6 })).find((e) => e.hook === 'x.lamp.hotMult').value, 0.48);
  assert.deepEqual(E.ENGINE_DYNAMIC_EFFECTS.lampwick(live({ wicks: 0 })), []);
  const h = E.ENGINE_BEHAVIOURS.lampwick.on['machine:result'];
  const c = ctx({}, { circuit: circuit({ hot: ['h1'] }) });
  for (let i = 0; i < 9; i++) h(play({ mid: 'h1', gross: 50 }), c);
  h(play({ mid: 'cold1', gross: 50 }), c);
  assert.equal(c.data.wicks, 6);
});

test('max: Lampwick wicks clear at Dawn', () => {
  const w = E.ENGINE_BEHAVIOURS.lampwick.on['run:window'];
  const c = ctx({ wicks: 5 });
  w({ window: 'watch', night: 2 }, c);
  assert.equal(c.data.wicks, 5);
  w({ window: 'dawn', night: 2 }, c);
  assert.equal(c.data.wicks, 0);
});

test('max: Ticket Press is +20 % at 30 Tickets and never more', () => {
  const dyn = E.ENGINE_DYNAMIC_EFFECTS.ticket_press;
  near(payoutOf(dyn(live({}, { tickets: 30 }))).a, 0.2);
  near(payoutOf(dyn(live({}, { tickets: 300 }))).a, 0.2);
  near(payoutOf(dyn(live({}, { tickets: 6 }))).a, 0.04);
  assert.deepEqual(dyn(live({}, { tickets: 2 })), []);
});

test('max: Ticket Press prints a Ticket on a win of ×5 or more', () => {
  const h = E.ENGINE_BEHAVIOURS.ticket_press.on['machine:result'];
  const o = { earned: [] };
  const c = ctx({}, o);
  h(play({ bet: 10, gross: 49 }), c);
  assert.equal(o.earned.length, 0);
  h(play({ bet: 10, gross: 50 }), c);
  assert.deepEqual(o.earned, [['ticket', 1, 'charm:ticket_press']]);
});

test('max: Last Gasp is ×1.4 in the last Watch Last Call while the quota is unmet', () => {
  const dyn = E.ENGINE_DYNAMIC_EFFECTS.last_gasp;
  near(payoutOf(dyn(live({}, { phase: 'lastCall', met: false }))).m, 1.4);
  assert.deepEqual(dyn(live({}, { phase: 'lastCall', met: true })), []);
  assert.deepEqual(dyn(live({}, { phase: 'play', met: false })), []);
  assert.deepEqual(dyn(live({}, { phase: 'lastCall', met: false, segment: { index: 0, count: 3 } })), []);
  near(payoutOf(dyn(live({}, { phase: 'lastCall', met: false, segment: { index: 2, count: 3 } }))).m, 1.4);
});

test('max: Gilded Chip is ×1.25 at max bet, ×0.9 below half, neutral between', () => {
  const dyn = E.ENGINE_DYNAMIC_EFFECTS.gilded_chip;
  // The bet fraction arrives on the query (`q.ctx.betFrac`), as win() passes it.
  assert.equal(payoutOf(dyn(live(), { ctx: { betFrac: 1 } })).m, 1.25);
  assert.equal(payoutOf(dyn(live(), { ctx: { betFrac: 0.25 } })).m, 0.9);
  assert.equal(payoutOf(dyn(live(), { ctx: { betFrac: 0.75 } })).m, 1);
  assert.equal(payoutOf(dyn(live())).m, 1, 'no query context: no effect');
});

test('max: Snowball Ledger is +3 % interest at three Watches and never more', () => {
  const dyn = E.ENGINE_DYNAMIC_EFFECTS.snowball_ledger;
  const e = dyn(live({ watches: 3 }));
  assert.deepEqual(e.map((x) => [x.hook, x.op]), [['x.econ.interestAdd', 'add']]);
  near(e[0].value, 0.03);
  const h = E.ENGINE_BEHAVIOURS.snowball_ledger.on['shift:phase'];
  const c = ctx({}, { ratio: 0.25 });
  for (let i = 0; i < 6; i++) h({ phase: 'settle', index: i }, c);
  assert.equal(c.data.watches, 3);
});

test('max: Snowball Ledger counts only Watches settled at 25 % or more, and resets at Dawn', () => {
  const h = E.ENGINE_BEHAVIOURS.snowball_ledger.on['shift:phase'];
  const low = ctx({}, { ratio: 0.24 });
  h({ phase: 'settle', index: 0 }, low);
  assert.equal(low.data.watches, undefined);
  const ok = ctx({ watches: 2 }, { ratio: 0.9 });
  h({ phase: 'play', index: 0 }, ok);
  assert.equal(ok.data.watches, 2, 'only the settle phase counts');
  const dawn = E.ENGINE_BEHAVIOURS.snowball_ledger.on['run:window'];
  dawn({ window: 'dawn', night: 1 }, ok);
  assert.equal(ok.data.watches, 0);
});

test('max: False Ceiling is House Limit ×2.4 (5× to 12×) and Dread +10', () => {
  const d = D.CHARM_ENGINE_DATA.find((x) => x.id === 'false_ceiling');
  const lim = d.effects.find((e) => e.hook === 'x.house.limitMult');
  assert.deepEqual([lim.op, lim.value], ['mult', 2.4]);
  near(5 * lim.value, 12);
  const dread = d.effects.find((e) => e.hook === 'dread.add');
  assert.deepEqual([dread.op, dread.value], ['add', 10]);
});

test('Understudy copies the most expensive non-Legendary, non-Cursed charm (effects and per-instant)', () => {
  const dyn = E.ENGINE_DYNAMIC_EFFECTS.understudy;
  const charms = [
    { id: 'ticket_press', stacks: 1 },
    { id: 'suit_ladder', stacks: 1, data: { rungs: 6 } },
    { id: 'crown_of_coins', stacks: 1 },
    { id: 'glass_heart', stacks: 1 },
  ];
  // crown_of_coins (Legendary, 100) and glass_heart (Cursed, 20) are skipped; suit_ladder (42) beats ticket_press (18).
  near(payoutOf(dyn(live({}, { charms }))).m, 1.72);
});

test('Understudy with only Legendary or Cursed charms copies nothing; it never copies itself or triggers', () => {
  const dyn = E.ENGINE_DYNAMIC_EFFECTS.understudy;
  assert.deepEqual(dyn(live({}, { charms: [{ id: 'crown_of_coins', stacks: 1 }, { id: 'glass_heart', stacks: 1 }] })), []);
  assert.deepEqual(dyn(live({}, { charms: [{ id: 'understudy', stacks: 1 }] })), []);
  assert.equal(E.ENGINE_BEHAVIOURS.understudy, undefined, 'no `on` triggers for Understudy');
});

test('Understudy copies the target\'s declarative effects (Greased Axle: WHEELS inc 0.10, scope kept)', () => {
  const dyn = E.ENGINE_DYNAMIC_EFFECTS.understudy;
  const eff = dyn(live({}, { charms: [{ id: 'greased_axle', stacks: 1 }] }));
  assert.deepEqual(eff.map((e) => [e.hook, e.op, e.value]), [['payout.mult', 'inc', 0.1]]);
  assert.deepEqual(eff[0].scope, { tags: ['wheels'] });
});

// ── item 3: triggers wired to the Circuit ───────────────────────────────────────────────────────
test('Suit Ladder: a new suit gains a Rung, the same suit again costs 3, and the first play counts for nothing', () => {
  const h = E.ENGINE_BEHAVIOURS.suit_ladder.on['machine:result'];
  const c = ctx({});
  h(play({ tags: ['reels'] }), c);
  assert.equal(c.data.rungs, undefined, 'first play sets the suit only');
  h(play({ tags: ['cards'] }), c);
  assert.equal(c.data.rungs, 1);
  h(play({ tags: ['dice'] }), c);
  h(play({ tags: ['dice'] }), c);
  assert.equal(c.data.rungs, 0, 'same suit twice in a row costs 3 (clamped at 0)');
  h(play({ tags: ['table'], machineId: 'cashier' }), c);
  assert.equal(c.data.rungs, 0, 'a play with no suit family does not move the ladder');
  // no suit in the play tags: the machine id decides (wave 8 integrator wiring, suits.ts)
  const c2 = ctx({});
  h(play({ machineId: 'bandit' }), c2);
  h(play({ machineId: 'blackjack' }), c2);
  assert.equal(c2.data.rungs, 1, 'bandit (REELS) then blackjack (CARDS) climbs one Rung');
});

test('Suit Ladder: roulette tag "wheel" counts as the wheels family', () => {
  assert.equal(E.suitOfTags(['wheel']), 'wheels');
  assert.equal(E.suitOfTags(['reels', 'wheel']), 'reels');
  assert.equal(E.suitOfTags(['table']), null);
});

test('Pressure Valve: losses build Pressure, the next win spends it and the win pays ×(1 + 0.10·P)', () => {
  const h = E.ENGINE_BEHAVIOURS.pressure_valve.on['machine:result'];
  const c = ctx({});
  for (let i = 0; i < 3; i++) h(play({ gross: 0 }), c);
  assert.equal(c.data.pressure, 3);
  near(payoutOf(E.ENGINE_DYNAMIC_EFFECTS.pressure_valve(c)).m, 1.3);
  h(play({ gross: 40 }), c);
  assert.equal(c.data.pressure, 0);
});

// ── item 4: Boss Nights ─────────────────────────────────────────────────────────────────────────
test('bosses: Nights 3, 6 and 8 carry a boss; other Nights carry none', () => {
  assert.deepEqual([...BD.BOSS_NIGHTS], [3, 6, 8]);
  for (const n of [1, 2, 4, 5, 7, 9]) assert.equal(B.bossFor(123, n), null, `night ${n}`);
  for (const n of [3, 6, 8]) assert.ok(B.bossFor(123, n), `night ${n}`);
  assert.equal(B.isBossNight(6), true);
  assert.equal(B.isBossNight(5), false);
});

test('bosses: the same seed and Night always give the same boss (deterministic)', () => {
  for (const seed of [1, 42, 9001, 123456789]) {
    for (const n of [3, 6, 8]) {
      assert.deepEqual(B.bossFor(seed, n), B.bossFor(seed, n));
    }
  }
});

test('bosses: Night 8 is always Glass Night; Nights 3 and 6 draw from their pools', () => {
  for (let seed = 1; seed <= 100; seed++) {
    assert.equal(B.bossFor(seed, 8).boss, 'glass_night');
    assert.ok(BD.BOSS_POOLS[3].includes(B.bossFor(seed, 3).boss));
    assert.ok(BD.BOSS_POOLS[6].includes(B.bossFor(seed, 6).boss));
  }
});

test('bosses: over many seeds, Night 3 shows every boss in its pool', () => {
  const seen = new Set();
  for (let seed = 1; seed <= 300; seed++) seen.add(B.bossFor(seed, 3).boss);
  assert.deepEqual([...seen].sort(), [...BD.BOSS_POOLS[3]].sort());
});

test('bosses: every boss is a NightEventDef: shift duration, boss exclusive group, pinned to its Night, no random weight', () => {
  for (const n of [3, 6, 8]) {
    const b = B.bossFor(7, n);
    assert.equal(b.duration, 'shift');
    assert.equal(b.exclusive, 'boss');
    assert.equal(b.minShift, n);
    assert.equal(b.maxShift, n);
    assert.equal(b.weight, 0);
    assert.ok(Array.isArray(b.effects) && b.effects.length > 0);
    assert.ok(b.strings.en.name && b.strings.tr.name && b.strings.en.announce && b.strings.tr.announce);
  }
});

test('bosses: Embargo ×0.4 on the seed-picked suit and ×1.15 on each of the other five', () => {
  const families = ['reels', 'cards', 'dice', 'wheels', 'drops', 'curios'];
  let checked = 0;
  for (let seed = 1; seed <= 200 && checked < 3; seed++) {
    const b = B.bossFor(seed, 3);
    if (b.boss !== 'embargo') continue;
    checked++;
    const [hit, rest] = b.effects;
    assert.equal(hit.op, 'mult');
    assert.equal(hit.value, 0.4);
    assert.deepEqual(hit.scope.tags, [b.suit]);
    assert.equal(rest.value, 1.15);
    assert.deepEqual(rest.scope.tags.slice().sort(), families.filter((f) => f !== b.suit).sort());
    for (const f of families) {
      const tags = [f];
      const mHit = M.scopeMatches(hit.scope, { machineId: 'x', tags });
      const mRest = M.scopeMatches(rest.scope, { machineId: 'x', tags });
      assert.equal(mHit, f === b.suit);
      assert.equal(mRest, f !== b.suit);
    }
  }
  assert.ok(checked > 0, 'an Embargo seed was found');
});

test('bosses: Pennies, Short Fuse and Lamp Night carry their plan numbers', () => {
  const find = (boss, n) => { for (let s = 1; s < 500; s++) { const b = B.bossFor(s, n); if (b.boss === boss) return b; } return null; };
  const p = find('pennies', 3);
  assert.deepEqual(p.effects.map((e) => [e.hook, e.op, e.value]), [['bet.maxMult', 'mult', 0.35], ['x.run.pullsAdd', 'add', 3]]);
  const s = find('short_fuse', 6);
  assert.deepEqual(s.effects.map((e) => [e.hook, e.op, e.value]), [['x.run.clockAdd', 'add', -45], ['payout.mult', 'mult', 1.35]]);
  const l = find('lamp_night', 6);
  assert.deepEqual(l.effects.map((e) => [e.hook, e.op, e.value]), [['x.lamp.coldCount', 'add', 2], ['x.lamp.hotCount', 'add', 1], ['x.lamp.hotMult', 'set', 2]]);
});

test('bosses: Glass Night is ×1.3 payouts, ×1.3 bet cost and tilt grace −2', () => {
  const g = B.bossFor(5, 8);
  assert.deepEqual(g.effects.map((e) => [e.hook, e.op, e.value]), [['payout.mult', 'mult', 1.3], ['bet.costMult', 'mult', 1.3], ['x.tilt.grace', 'add', -2]]);
});

test('bosses: reward is one pick of three Rare charms plus three Tickets', () => {
  assert.deepEqual({ ...BD.BOSS_REWARD }, { charmRarity: 'rare', charmChoices: 3, tickets: 3 });
});

// ── item 6: kits ────────────────────────────────────────────────────────────────────────────────
test('kits: Pauper is free and the rest cost 30 / 60 / 60 / 90 / 120 Obols', () => {
  assert.deepEqual(K.KITS.map((k) => k.unlockCost), [0, 30, 60, 60, 90, 120]);
  assert.deepEqual(K.KITS.map((k) => k.id), ['pauper', 'rotator', 'hot_hand', 'clutch', 'banker', 'heir']);
});

test('kits: starting values match the plan', () => {
  const k = (id) => K.kitById(id);
  assert.deepEqual([k('pauper').coins, k('pauper').tickets, k('pauper').charms], [50, 2, []]);
  assert.deepEqual([k('rotator').coins, k('rotator').charms], [35, ['suit_ladder']]);
  assert.deepEqual([k('hot_hand').coins, k('hot_hand').charms], [40, ['lampwick', 'cold_hands']]);
  assert.deepEqual([k('clutch').coins, k('clutch').charms], [30, ['last_gasp', 'night_owl']]);
  assert.deepEqual([k('banker').coins, k('banker').predeposit, k('banker').charms], [20, 40, ['piggy_tooth', 'wax_seal']]);
  assert.deepEqual([k('heir').coins, k('heir').charms], [200, ['glass_heart']]);
});

test('kits: every charm a kit names exists in the catalogue', () => {
  const known = new Set([...C.CHARM_DATA, ...D.CHARM_ENGINE_DATA].map((d) => d.id));
  for (const kit of K.KITS) for (const id of kit.charms) assert.ok(known.has(id), `${kit.id} → ${id}`);
});

test('kits: applyKit grants tickets and charms through the run and returns coins and pre-deposit', () => {
  const earned = [];
  const granted = [];
  const run = { earn: (cur, n, reason, pid) => earned.push([cur, n, reason, pid]), grantCharm: (id) => { granted.push(id); return true; } };
  const g = K.applyKit(run, 'banker', 0);
  assert.deepEqual(g, { coins: 20, predeposit: 40, charms: ['piggy_tooth', 'wax_seal'] });
  assert.deepEqual(earned, []);
  K.applyKit(run, 'pauper', 0);
  assert.deepEqual(earned, [['ticket', 2, 'kit:pauper', 0]]);
  assert.deepEqual(granted, ['piggy_tooth', 'wax_seal']);
});

test('kits: a charm the run refuses is left out of the grant; an unknown kit gives null', () => {
  const run = { earn() {}, grantCharm: (id) => id !== 'wax_seal' };
  assert.deepEqual(K.applyKit(run, 'banker').charms, ['piggy_tooth']);
  assert.equal(K.applyKit(run, 'nope'), null);
});

// ── wave 9: launch Rares per Night tier (charms-balance) ─────────────────────
test('launch Rares: at least 3 unlocked on every Night (boss and under-the-counter offers always have three)', () => {
  const rares = [...C.CHARM_DATA, ...D.CHARM_ENGINE_DATA].filter((d) => d.rarity === 'rare' && C.LAUNCH_CHARM_IDS.has(d.id));
  assert.ok(rares.length >= 12, `launch Rares: ${rares.length}`);
  for (let night = 1; night <= 8; night++) {
    const open = rares.filter((d) => !d.unlock || (/^N(\d+)$/.exec(d.unlock) ? Number(RegExp.$1) <= night : false));
    assert.ok(open.length >= 3, `Night ${night}: ${open.length} unlocked launch Rares`);
  }
});
