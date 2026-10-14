// Unit tests for the special rooms and the Keyring (WAVE 24 §2): src/game/rooms.ts (contract API and pure rules), data/rooms.ts
// (tables), the WING_DEFS rewrite, the tycoon grille (doZone key flag, parlour auto-open, host grant), the Locksmith and Stoker
// hotline deals, and Old Lin's CARDS / MAHJONG pool filter on the Pawn shelf.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let RM, DATA, FM, UP, HL, HSTR, TYC, SH, STR, EV, RNG, CH;
before(async () => {
  RM = await load('src/game/rooms.ts');
  DATA = await load('src/game/data/rooms.ts');
  FM = await load('src/game/modifiers.types.ts');
  UP = await load('src/game/data/upgrades.ts');
  HL = await load('src/game/hotline.ts');
  HSTR = (await load('src/game/hotline.strings.ts')).default;
  TYC = await load('src/game/tycoon/index.ts');
  SH = await load('src/game/shop.ts');
  STR = (await load('src/game/rooms.strings.ts')).default;
  EV = await load('src/core/events.ts');
  RNG = await load('src/core/rng.ts');
  CH = await load('src/game/charms/engine.ts');
});

const noop = () => {};
/** A wing source over a fixed run: `o.opened` zones, `o.keys` Wing Keys, `o.manager` the Manager's Key. */
const src = (o = {}) => ({ opened: () => o.opened ?? [], keys: () => o.keys ?? 0, managerKey: () => !!o.manager });
const base = () => RM.roomsStart();
const opts = (o = {}) => ({ seed: 42, night: 2, tickets: 10, charms: [], ...o });

// ── Keyring grants ──────────────────────────────────────────────────────────────────────────────────────
test('Dawn grants one Wing Key on Nights 1 to 6 and none after', () => {
  for (let n = 1; n <= 6; n++) assert.equal(RM.dawnKeys(n), 1, `night ${n}`);
  assert.equal(RM.dawnKeys(0), 0);
  assert.equal(RM.dawnKeys(7), 0);
  assert.equal(RM.dawnKeys(8), 0);
});

test('a boss beaten on Night 3, 6 or 8 grants a Wing Key; a lost boss or another Night grants none', () => {
  for (const n of [3, 6, 8]) assert.equal(RM.bossKeys(n, true), 1, `night ${n}`);
  for (const n of [3, 6, 8]) assert.equal(RM.bossKeys(n, false), 0, `lost night ${n}`);
  for (const n of [1, 2, 4, 5, 7]) assert.equal(RM.bossKeys(n, true), 0, `night ${n}`);
});

test('the Manager\'s Key drops only from a beaten Night 6 boss', () => {
  assert.equal(RM.managerKeyDrop(6, true), true);
  assert.equal(RM.managerKeyDrop(6, false), false);
  assert.equal(RM.managerKeyDrop(3, true), false);
  assert.equal(RM.managerKeyDrop(8, true), false);
});

test('the Parlour opens by itself once Night 3 is paid, and only once', () => {
  assert.equal(RM.parlourAutoOpens(2, []), false);
  assert.equal(RM.parlourAutoOpens(3, []), true);
  assert.equal(RM.parlourAutoOpens(4, []), true);
  assert.equal(RM.parlourAutoOpens(3, ['parlour']), false);
});

// ── wing state and grille options (the shared contract) ─────────────────────────────────────────────────
test('wingState is sealed, key ready or open from the run\'s keys and opened zones', () => {
  assert.equal(RM.wingState('cards', src()), 'sealed');
  assert.equal(RM.wingState('cards', src({ keys: 1 })), 'keyReady');
  assert.equal(RM.wingState('cards', src({ keys: 3, opened: ['cards'] })), 'open');
  assert.equal(RM.wingState('cards', src({ opened: ['cards'] })), 'open', 'an open room is open with no keys');
});

test('the Counting Room is key ready only with the Manager\'s Key, never with Wing Keys', () => {
  assert.equal(RM.wingState('counting', src({ keys: 5 })), 'sealed');
  assert.equal(RM.wingState('counting', src({ manager: true })), 'keyReady');
  assert.equal(RM.wingState('counting', src({ manager: true, opened: ['counting'] })), 'open');
});

test('wingState reads the bound source when none is passed, and is sealed when unbound', () => {
  RM.bindWingSource(src({ keys: 1 }));
  try {
    assert.equal(RM.wingState('wheels'), 'keyReady');
  } finally {
    RM.bindWingSource(null);
  }
  assert.equal(RM.wingState('wheels'), 'sealed');
});

test('a closed grille offers Spend KEY and BUY at 1.5 times the quota', () => {
  assert.deepEqual(RM.grilleOptions('laundry', 100, src({ keys: 1 })), [{ id: 'key', cost: 1 }, { id: 'buy', cost: 150 }]);
  assert.deepEqual(RM.grilleOptions('laundry', 100, src()), [{ id: 'buy', cost: 150 }], 'no key: only BUY');
  assert.deepEqual(RM.grilleOptions('laundry', 100, src({ opened: ['laundry'], keys: 4 })), [], 'an open room offers nothing');
});

test('the counting grille is key only, and absent without a key', () => {
  assert.deepEqual(RM.grilleOptions('counting', 100, src()), []);
  assert.deepEqual(RM.grilleOptions('counting', 100, src({ manager: true })), [{ id: 'key', cost: 1 }]);
});

test('BUY price is 1.5 times the quota, rounded as the tycoon rounds it', () => {
  assert.equal(RM.buyPrice(100), 150);
  assert.equal(RM.buyPrice(33), 50);
  assert.equal(RM.buyPrice(0), 0);
});

test('the Locksmith opens the first closed wing in LOCKSMITH_ORDER, and none once all are open', () => {
  assert.equal(RM.locksmithZone((z) => z === 'cards' ? false : true), 'cards');
  assert.equal(RM.locksmithZone((z) => z === 'cards' ? true : z !== 'laundry'), 'laundry');
  assert.equal(RM.locksmithZone(() => true), null);
  assert.equal(RM.locksmithZone(() => false), 'cards');
});

// ── room rules as zone-scoped ModEffects ─────────────────────────────────────────────────────────────────
const jadeMachine = { machineId: 'baccarat', zone: 'cards', tags: [] };
const boilerMachine = { machineId: 'craps', zone: 'boiler', tags: [] };

test('no room rule applies while its room is closed', () => {
  assert.deepEqual(RM.roomRules([]), []);
  assert.deepEqual(RM.roomRules(['laundry', 'midway']), []);
});

test('the Jade Room pays CARDS x1.10 and cuts the max bet to x0.7, in the Jade Room only', () => {
  const effs = RM.roomRules(['cards']);
  assert.equal(effs.length, 2);
  const pay = effs.filter((e) => e.hook === 'payout.mult' && FM.scopeMatches(e.scope, jadeMachine));
  const max = effs.filter((e) => e.hook === 'bet.maxMult' && FM.scopeMatches(e.scope, jadeMachine));
  assert.equal(pay.length, 1);
  assert.equal(max.length, 1);
  assert.ok(Math.abs(FM.foldEffects('payout.mult', 100, pay) - 110) < 1e-9);
  assert.equal(FM.foldEffects('bet.maxMult', 1, max), 0.7);
  assert.equal(effs.some((e) => FM.scopeMatches(e.scope, boilerMachine)), false, 'a boiler machine is not touched');
});

test('the boiler pays x(1 + P/100), capped at x2, and only while pressure is above zero', () => {
  assert.deepEqual(RM.boilerEffects(0), []);
  assert.equal(FM.foldEffects('payout.mult', 10, RM.boilerEffects(50)), 15);
  assert.equal(FM.foldEffects('payout.mult', 10, RM.boilerEffects(100)), 20);
  assert.equal(FM.foldEffects('payout.mult', 10, RM.boilerEffects(150)), 20, 'P clamps at 100, so x2 at most');
  assert.ok(RM.boilerEffects(30).every((e) => FM.scopeMatches(e.scope, boilerMachine) && !FM.scopeMatches(e.scope, jadeMachine)));
});

test('the rooms provider adds the open rooms\' rules, and the boiler payout only when the Boiler is open', () => {
  const run = (opened, p = 0) => {
    const out = [];
    RM.roomsProvider({ opened: () => opened, rooms: () => ({ ...base(), p }) }).collect({}, out);
    return out;
  };
  assert.deepEqual(run([]), [], 'no open room, no source');
  const cards = run(['cards']);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].kind, 'rule');
  assert.equal(cards[0].effects.length, 2, 'only the Jade rules');
  const both = run(['cards', 'boiler'], 40);
  assert.equal(both[0].effects.length, 3, 'Jade rules plus the boiler payout');
  assert.equal(FM.foldEffects('payout.mult', 1, both[0].effects.filter((e) => e.hook === 'payout.mult' && FM.scopeMatches(e.scope, boilerMachine))), 1.4);
  const boilerOnly = run(['boiler'], 0);
  assert.deepEqual(boilerOnly, [], 'boiler open at pressure 0 adds nothing');
});

// ── boiler ───────────────────────────────────────────────────────────────────────────────────────────────
test('each pull adds 5 pressure, and the pull that reaches 100 blows the room', () => {
  let s = base();
  for (let i = 0; i < 19; i++) {
    const r = RM.boilerPull(s);
    assert.equal(r.ok, true);
    assert.equal(r.blew, false);
    s = r.state;
  }
  assert.equal(s.p, 95);
  const blow = RM.boilerPull(s);
  assert.equal(blow.ok, true);
  assert.equal(blow.blew, true);
  assert.equal(blow.state.p, 100);
  assert.equal(blow.state.blown, true);
});

test('a blown boiler takes no pulls until the next Watch', () => {
  const blown = { ...base(), p: 100, blown: true };
  const r = RM.boilerPull(blown);
  assert.equal(r.ok, false);
  assert.equal(r.state, blown);
  const next = RM.boilerNextWatch(blown);
  assert.deepEqual({ p: next.p, blown: next.blown }, { p: 0, blown: false });
  assert.equal(RM.boilerPull(next).ok, true);
});

test('the Vent lever resets pressure and costs 1 pull; it is refused at zero or while blown', () => {
  const v = RM.boilerVent({ ...base(), p: 40 });
  assert.equal(v.ok, true);
  assert.equal(v.pulls, 1);
  assert.equal(v.state.p, 0);
  assert.equal(RM.boilerVent(base()).ok, false);
  assert.equal(RM.boilerVent({ ...base(), p: 100, blown: true }).ok, false);
});

test('the boiler payout follows the pressure through a run of pulls', () => {
  let s = base();
  for (let i = 0; i < 10; i++) s = RM.boilerPull(s).state;
  assert.equal(s.p, 50);
  assert.equal(FM.foldEffects('payout.mult', 1, RM.boilerEffects(s.p)), 1.5);
});

// ── lockers ──────────────────────────────────────────────────────────────────────────────────────────────
test('a locker number outside 1 to 12 is refused', () => {
  for (const n of [0, 13, 2.5, -1]) {
    const r = RM.openLocker(base(), n, opts());
    assert.equal(r.ok, false, `n=${n}`);
    assert.equal(r.reason, 'range');
  }
});

test('opening a locker needs a Ticket, and a refused opening changes nothing', () => {
  const r = RM.openLocker(base(), 3, opts({ tickets: 0 }));
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'tickets');
  assert.deepEqual(r.state.lockers, []);
});

test('a locker opens once per Night: the second try is refused as used', () => {
  const a = RM.openLocker(base(), 3, opts());
  assert.equal(a.ok, true);
  assert.equal(a.tickets, 9, 'one Ticket spent');
  const b = RM.openLocker(a.state, 3, opts({ tickets: a.tickets }));
  assert.equal(b.ok, false);
  assert.equal(b.reason, 'used');
  assert.equal(b.tickets, 9);
});

test('locker results are seeded by (seed, Night, number): the same inputs give the same result', () => {
  for (let n = 1; n <= 12; n++) {
    const a = RM.openLocker(base(), n, opts({ seed: 9, night: 4, charms: ['felt_square', 'dealers_button'] }));
    const b = RM.openLocker(base(), n, opts({ seed: 9, night: 4, charms: ['felt_square', 'dealers_button'] }));
    assert.deepEqual(a.result, b.result, `locker ${n}`);
  }
});

test('every locker kind is reachable and well formed, and coins and blank JackIDs pay their fixed amounts', () => {
  const kinds = new Set();
  for (let seed = 1; seed <= 400; seed++) {
    for (const n of [1, 5, 9]) {
      const r = RM.openLocker(base(), n, opts({ seed, night: 3, charms: ['felt_square'] }));
      if (!r.ok) continue;
      kinds.add(r.result.k);
      if (r.result.k === 'coins') assert.equal(r.result.n, DATA.LOCKER.coinBase + DATA.LOCKER.coinPerNight * 3);
      if (r.result.k === 'blank') assert.equal(r.result.obols, DATA.LOCKER.blankObols);
      if (r.result.k === 'charm') assert.equal(r.result.id, 'felt_square');
    }
  }
  assert.deepEqual([...kinds].sort(), ['blank', 'charm', 'coins', 'note']);
});

test('with no charms on the table, a locker never holds a charm', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const r = RM.openLocker(base(), 2, opts({ seed, charms: [] }));
    assert.notEqual(r.result?.k, 'charm');
  }
});

test('the 4th and later lockers of one Night each trigger the Dread beat', () => {
  let s = base();
  const dread = [];
  for (const n of [1, 2, 3, 4, 5]) {
    const r = RM.openLocker(s, n, opts());
    assert.equal(r.ok, true);
    dread.push(r.dread);
    s = r.state;
  }
  assert.deepEqual(dread, [0, 0, 0, DATA.LOCKER.dread, DATA.LOCKER.dread]);
});

test('a new Night starts a fresh tally: the Dread beat and the used lockers reset', () => {
  let s = base();
  for (const n of [1, 2, 3, 4]) s = RM.openLocker(s, n, opts({ night: 2 })).state;
  const next = RM.openLocker(s, 1, opts({ night: 3 }));
  assert.equal(next.ok, true, 'locker 1 is open again on Night 3');
  assert.equal(next.dread, 0);
  assert.equal(RM.lockersLeft(next.state, 3), 11);
  assert.equal(RM.lockersLeft(s, 2), 8);
});

test('restoreRooms keeps valid values only, and a missing save is the start state', () => {
  assert.deepEqual(RM.restoreRooms(null), RM.roomsStart());
  assert.deepEqual(RM.restoreRooms('junk'), RM.roomsStart());
  const r = RM.restoreRooms({ p: 250, blown: true, lockerNight: 4, lockers: [3, 3, 0, 13, 12, 'x'] });
  assert.equal(r.p, 100);
  assert.equal(r.blown, true);
  assert.equal(r.lockerNight, 4);
  assert.deepEqual(r.lockers, [3, 12]);
});

// ── back office and collector ────────────────────────────────────────────────────────────────────────────
test('the Back Office pays 1 Obol for every 3 Tickets and keeps the rest', () => {
  assert.deepEqual(RM.backOffice(7), { obols: 2, tickets: 1 });
  assert.deepEqual(RM.backOffice(2), { obols: 0, tickets: 2 });
  assert.deepEqual(RM.backOffice(9), { obols: 3, tickets: 0 });
  assert.deepEqual(RM.backOffice(-4), { obols: 0, tickets: 0 });
});

test('the Collector sells a charm for 2 times its sell value, at least 1 Obol', () => {
  assert.equal(RM.collectorPrice(5), 10);
  assert.equal(RM.collectorPrice(2.5), 5);
  assert.equal(RM.collectorPrice(0), 1);
});

// ── WING_DEFS rewrite ───────────────────────────────────────────────────────────────────────────────────
test('WING_DEFS lists the six Keyring rooms at the 1.5 times quota BUY price, and no parlour or counting', () => {
  const zones = UP.WING_DEFS.map((w) => w.zone);
  assert.deepEqual(zones, ['midway', 'cards', 'laundry', 'boiler', 'gallery', 'wheels']);
  assert.ok(UP.WING_DEFS.every((w) => w.priceQuotaMult === 1.5 && !w.requires));
  for (const w of UP.WING_DEFS) {
    assert.ok(STR.en[w.strings.en.name.slice('rooms.'.length)], `EN name ${w.zone}`);
    assert.ok(STR.tr[w.strings.tr.desc.slice('rooms.'.length)], `TR desc ${w.zone}`);
  }
});

test('every room string is present in both languages', () => {
  for (const k of Object.keys(STR.en)) assert.ok(k in STR.tr, `TR has ${k}`);
  for (const k of Object.keys(STR.tr)) assert.ok(k in STR.en, `EN has ${k}`);
});

// ── tycoon grille: doZone key flag, parlour, Counting Room, host grant ────────────────────────────────────
/** A tycoon over a fake run: `o.keys` Wing Keys, `o.manager` the Manager's Key, `o.coins` the wallet. */
function tycoonOf(o = {}) {
  const log = { spent: [], earned: [] };
  const k = { keys: o.keys ?? 0, manager: !!o.manager };
  let coins = o.coins ?? 1000;
  const run = {
    selfId: 1, night: () => o.night ?? 3, wallet: () => coins,
    spend: (cur, n) => {
      if (cur !== 'coin') return true;
      if (coins < n) return false;
      coins -= n; log.spent.push(n); return true;
    },
    earn: (cur, n) => { log.earned.push([cur, n]); }, balance: () => 0, dread: () => 0, addDread: noop,
    mod: (h, m, b) => b, mods: { touch: noop }, buffs: {}, stat: () => 0, charms: () => [],
  };
  const keys = {
    takeKeys: (n) => { if (k.keys < n) return false; k.keys -= n; return true; },
    takeManagerKey: () => { if (!k.manager) return false; k.manager = false; return true; },
  };
  const tyc = TYC.createTycoon({ run: () => run, seed: 7, isHost: () => true, quotaDue: () => o.quota ?? 100, keys, now: () => 0 });
  return { tyc, log, k, run };
}

test('doZone with key:true opens a Keyring room for one Wing Key and no coins', () => {
  const { tyc, log, k } = tycoonOf({ keys: 2 });
  const opened = [];
  const off = EV.bus.on('room:opened', (e) => opened.push(e.zone));
  try {
    assert.equal(tyc.apply({ op: 'zone', zone: 'cards', key: true }), null);
    assert.ok(tyc.state().zones.includes('cards'));
    assert.equal(k.keys, 1);
    assert.deepEqual(log.spent, []);
    assert.deepEqual(opened, ['cards']);
  } finally { off(); }
});

test('doZone with key:true and no Wing Key is refused as locked, and opens nothing', () => {
  const { tyc, k } = tycoonOf({ keys: 0 });
  assert.equal(tyc.apply({ op: 'zone', zone: 'cards', key: true }), 'locked');
  assert.equal(tyc.state().zones.includes('cards'), false);
  assert.equal(k.keys, 0);
});

test('doZone without key buys the room at 1.5 times the quota and holds the price', () => {
  const { tyc, log } = tycoonOf({ quota: 100, coins: 1000 });
  assert.equal(tyc.apply({ op: 'zone', zone: 'laundry' }), null);
  assert.deepEqual(log.spent, [150]);
  assert.ok(tyc.state().zones.includes('laundry'));
  assert.equal(tyc.state().holdings, 150);
});

test('a buy the pocket cannot pay is refused as funds, and the room stays shut', () => {
  const { tyc } = tycoonOf({ quota: 100, coins: 10 });
  tyc.apply({ op: 'zone', zone: 'boiler' });
  assert.equal(tyc.state().zones.includes('boiler'), false);
});

test('the Parlour is not for sale; it opens by itself once Night 3 is paid', () => {
  const { tyc } = tycoonOf({ keys: 5 });
  assert.equal(tyc.apply({ op: 'zone', zone: 'parlour' }), 'invalid');
  assert.equal(tyc.onNightPaid(2), false);
  assert.equal(tyc.onNightPaid(3), true);
  assert.ok(tyc.state().zones.includes('parlour'));
  assert.equal(tyc.onNightPaid(3), false, 'it opens once');
});

test('the Counting Room takes the Manager\'s Key only, never a Wing Key or coins', () => {
  const { tyc, log, k } = tycoonOf({ keys: 4, manager: false });
  assert.equal(tyc.apply({ op: 'zone', zone: 'counting', key: true }), 'locked', 'no Manager\'s Key');
  assert.equal(tyc.apply({ op: 'zone', zone: 'counting' }), 'locked', 'never bought');
  assert.equal(k.keys, 4, 'Wing Keys are not spent on it');
  k.manager = true;
  assert.equal(tyc.apply({ op: 'zone', zone: 'counting', key: true }), null);
  assert.ok(tyc.state().zones.includes('counting'));
  assert.equal(k.manager, false, 'the Manager\'s Key is spent');
  assert.deepEqual(log.spent, []);
  assert.equal(tyc.apply({ op: 'zone', zone: 'counting', key: true }), 'invalid', 'open already');
});

test('the host can open a room for free, once (the hotline Locksmith and Stoker)', () => {
  const { tyc, log } = tycoonOf({ keys: 0 });
  assert.equal(tyc.grantZone('boiler'), true);
  assert.ok(tyc.state().zones.includes('boiler'));
  assert.equal(tyc.grantZone('boiler'), false);
  assert.deepEqual(log.spent, []);
});

test('unlockZone passes the key flag through to the grille', () => {
  const { tyc, k } = tycoonOf({ keys: 1 });
  assert.equal(tyc.unlockZone('gallery', true), true);
  assert.equal(k.keys, 0);
  assert.ok(tyc.state().zones.includes('gallery'));
});

// ── hotline: Locksmith and Stoker ────────────────────────────────────────────────────────────────────────
function dealCtx(o = {}) {
  const log = { dread: [], opened: [] };
  const closed = new Set(o.closed ?? ['cards', 'laundry', 'boiler', 'midway', 'gallery', 'wheels']);
  const host = o.noOpen ? {} : {
    wingClosed: (z) => closed.has(z),
    openWing: (z) => { log.opened.push(z); if (o.refuse) return false; closed.delete(z); return true; },
  };
  const run = { addDread: (d) => { log.dread.push(d); }, wallet: () => 100, spend: () => true, earn: noop };
  return { ctx: { run, host, night: o.night ?? 2, cost: (x) => x, rng: RNG.createRng(3) }, log };
}
const deal = (id) => HL.DEALS.find((d) => d.id === id);

test('the Locksmith and Stoker are hotline deals from Night 2, and need the room hooks', () => {
  assert.equal(deal('locksmith').minNight, 2);
  assert.equal(deal('stoker').minNight, 2);
  assert.equal(deal('locksmith').eligible(dealCtx({ noOpen: true }).ctx), false);
  assert.equal(deal('stoker').eligible(dealCtx({ noOpen: true }).ctx), false);
});

test('the Locksmith offers the first closed wing for 15 Dread and opens it on take, with no key', () => {
  const { ctx, log } = dealCtx();
  const d = deal('locksmith');
  assert.equal(d.eligible(ctx), true);
  const v = d.offer(ctx);
  assert.equal(v.z, 'cards');
  assert.equal(v.d, 15);
  const out = d.apply(ctx, v);
  assert.equal(out.ok, true);
  assert.deepEqual(log.opened, ['cards']);
  assert.deepEqual(log.dread, [15]);
});

test('the Locksmith moves to the next closed wing once the first is open', () => {
  const { ctx } = dealCtx({ closed: ['laundry', 'midway'] });
  assert.equal(deal('locksmith').offer(ctx).z, 'laundry');
});

test('the Locksmith is off once every wing is open', () => {
  const { ctx } = dealCtx({ closed: [] });
  assert.equal(deal('locksmith').eligible(ctx), false);
});

test('a refused Locksmith opens nothing and takes no Dread', () => {
  const { ctx, log } = dealCtx({ refuse: true });
  const out = deal('locksmith').apply(ctx, deal('locksmith').offer(ctx));
  assert.equal(out.ok, false);
  assert.deepEqual(log.dread, []);
});

test('the Stoker opens the Boiler for 10 Dread, and is off once the Boiler is open', () => {
  const { ctx, log } = dealCtx();
  const d = deal('stoker');
  assert.equal(d.eligible(ctx), true);
  const v = d.offer(ctx);
  assert.equal(v.z, 'boiler');
  assert.equal(v.d, 10);
  assert.equal(d.apply(ctx, v).ok, true);
  assert.deepEqual(log.opened, ['boiler']);
  assert.deepEqual(log.dread, [10]);
  const again = dealCtx({ closed: [] });
  assert.equal(deal('stoker').eligible(again.ctx), false);
});

test('the Locksmith and Stoker strings exist in both languages', () => {
  for (const id of ['locksmith', 'stoker']) {
    for (const part of ['name', 'boon', 'cost']) {
      assert.ok(HSTR.en[`deal.${id}.${part}`], `en ${id}.${part}`);
      assert.ok(HSTR.tr[`deal.${id}.${part}`], `tr ${id}.${part}`);
    }
  }
  for (const k of ['note.opened', 'note.noWing']) assert.ok(HSTR.en[k] && HSTR.tr[k], k);
});

// ── Old Lin's pool filter ────────────────────────────────────────────────────────────────────────────────
test('Old Lin stocks CARDS and MAHJONG charms only (tag match is case-insensitive)', () => {
  const f = SH.oldLinPoolFilter;
  assert.equal(f({ tag: 'CARDS' }), true);
  assert.equal(f({ tag: 'cards' }), true);
  assert.equal(f({ tags: ['mahjong'] }), true);
  assert.equal(f({ tag: 'REELS' }), false);
  assert.equal(f({ tag: 'WHEELS', tags: ['LEDGER'] }), false);
  assert.equal(f({}), false);
  assert.equal(DATA.linPoolAccepts({ tag: 'CARDS' }), true);
});

test('the Pawn shelf draws only Old Lin\'s charms while the filter is on', () => {
  const rng = RNG.createRng(91);
  const host = {
    selfId: 1, rng: () => rng, night: () => 6, watch: () => 0, open: () => true, si: () => 1,
    held: () => [], heldIds: [], canTake: () => true, pegsFree: () => 9, wallet: () => 1000, tickets: () => 20,
    spendTickets: () => true, freeRerolls: () => 0, useFreeReroll: () => false, buyCharm: () => true, sellCharm: () => true,
    sellValue: () => 1, removeCurse: () => true, bias: () => false, meta: () => true, mostPlayed: () => null,
    launchOnly: () => false, poolFilter: () => SH.oldLinPoolFilter, mod: (h, b) => b, discount: () => 0,
  };
  const pawn = new SH.Pawn(host);
  const stock = pawn.stock(1).filter(Boolean);
  assert.ok(stock.length > 0, 'the shelf is not empty');
  for (const s of stock) {
    const def = CH.allCharmDefs().find((d) => d.id === s.charmId);
    assert.ok(def, `known charm ${s.charmId}`);
    assert.equal(SH.oldLinPoolFilter(def), true, `${s.charmId} is a Jade charm`);
  }
});
