// Wave 75 floor events (events lane): SINGLE LIGHT, STAGE AUCTION, CRATE DROP, WHEEL SPIN and LAST CALL DARE. Covers the Night 2
// gate, the seeded rolls, the timing (fixed lengths, the dare arming on the Watch clock), the effects, the outcomes the run applies,
// the save round trip, degrade without a floor, and the Compere lines.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let R, WE, SL, AU, CR, WH, DA, CP, I18N, STR;
before(async () => {
  R = await load('src/core/rng.ts');
  WE = await load('src/game/watchEvents.ts');
  SL = await load('src/game/events/singleLight.ts');
  AU = await load('src/game/events/stageAuction.ts');
  CR = await load('src/game/events/crateDrop.ts');
  WH = await load('src/game/events/wheelSpin.ts');
  DA = await load('src/game/events/lastCallDare.ts');
  CP = await load('src/game/events/compere.ts');
  I18N = await load('src/core/i18n.ts');
  STR = (await load('src/game/watchEvents.strings.ts')).default;
  I18N.registerStrings(STR.prefix, { en: STR.en, tr: STR.tr });
});

const NEW = ['single_light', 'stage_auction', 'crate_drop', 'wheel_spin', 'last_call_dare'];
const FLOOR = { machines: ['coinflip', 'bigone', 'scratch'], spotlight: 'scratch', lobby: { x: 0, z: 0 } };

/** A fresh WatchEvents with a host that counts touches. `floor` may be null (no floor facts at all). */
function makeWE(floor = FLOOR) {
  const host = { isHot: () => false, touch: () => {}, floor: floor ? () => floor : undefined };
  return new WE.WatchEvents(host);
}

/** Begins Watches until `id` rolls on `night`, ending each miss. Deterministic: the seeds are fixed. */
function beginUntil(we, id, night = 3) {
  for (let w = 0; w < 6000; w++) {
    const rng = R.createRng(20261018).fork(`try.${id}.${night}.${w}`);
    const def = we.begin(rng, night, w, false);
    if (def && def.id === id) return def;
    we.end();
    we.takeOutcomes();
  }
  throw new Error(`never rolled ${id}`);
}

// ── the gate and the rolls ─────────────────────────────────────────────────────────────────────────────────
test('the five wave 75 events are on the list from Night 2, and Night 1 never rolls one', () => {
  for (const id of NEW) {
    const d = WE.WATCH_EVENTS.find((x) => x.id === id);
    assert.ok(d, `${id} is in WATCH_EVENTS`);
    assert.equal(d.minNight, 2, `${id} starts on Night 2`);
  }
  const rng = R.createRng(75);
  for (let k = 0; k < 2000; k++) {
    const r = WE.rollWatchEvent(rng.fork(`n1.${k}`), 1);
    if (r) assert.ok(!NEW.includes(r.def.id), `Night 1 rolled ${r.def.id}`);
  }
});

test('Night 2 rolls every wave 75 event, and the older events still roll', () => {
  const rng = R.createRng(20261018);
  const seen = new Set();
  for (let k = 0; k < 4000; k++) {
    const r = WE.rollWatchEvent(rng.fork(`n2.${k}`), 2);
    if (r) seen.add(r.def.id);
  }
  for (const id of NEW) assert.ok(seen.has(id), `Night 2 never rolled ${id}`);
  assert.ok(seen.has('happy_minute'), 'an older event still rolls on Night 2');
});

test('fixed lengths: SINGLE LIGHT 40 s, STAGE AUCTION 20 s, WHEEL SPIN 30 s, LAST CALL DARE 20 s; CRATE DROP keeps the seeded 45-60 s', () => {
  const want = { single_light: 40, stage_auction: 20, wheel_spin: 30, last_call_dare: 20 };
  const rng = R.createRng(77);
  for (const [id, s] of Object.entries(want)) {
    let got = null;
    for (let k = 0; k < 4000 && got === null; k++) {
      const r = WE.rollWatchEvent(rng.fork(`len.${id}.${k}`), 3);
      if (r && r.def.id === id) got = r.secs;
    }
    assert.equal(got, s, `${id} length`);
  }
  for (let k = 0; k < 200; k++) {
    const r = WE.rollWatchEvent(rng.fork(`crate.${k}`), 3);
    if (r && r.def.id === 'crate_drop') assert.ok(r.secs >= 45 && r.secs <= 60, `crate ${r.secs} s`);
  }
});

test('an event with no floor to play on (SINGLE LIGHT with no machine open) never starts, and the rest of the Watch runs on', () => {
  const we = makeWE(null);
  let started = 0;
  for (let w = 0; w < 800; w++) {
    const def = we.begin(R.createRng(9).fork(`nofloor.${w}`), 3, w, false);
    if (def && def.id === 'single_light') started++;
    we.end();
  }
  assert.equal(started, 0, 'SINGLE LIGHT needs a machine to light');
  const empty = makeWE({ machines: [] });
  for (let w = 0; w < 400; w++) {
    const def = empty.begin(R.createRng(2).fork(`empty.${w}`), 3, w, false);
    if (def) assert.notEqual(def.id, 'single_light', 'an empty floor never lights one machine');
    empty.end();
  }
});

// ── SINGLE LIGHT ──────────────────────────────────────────────────────────────────────────────────────────
test('SINGLE LIGHT: the spotlight machine is the lit one when it is open; otherwise a seeded pick; null on an empty floor', () => {
  const rng = R.createRng(5).fork('lit');
  assert.equal(SL.pickLitMachine(rng, FLOOR), 'scratch');
  assert.equal(SL.pickLitMachine(R.createRng(5).fork('lit'), { machines: ['coinflip', 'bigone'], spotlight: 'craps' }) !== 'craps', true, 'a spotlight off the floor is not lit');
  assert.equal(SL.pickLitMachine(rng, { machines: [] }), null);
  assert.equal(SL.pickLitMachine(R.createRng(5).fork('lit'), FLOOR), SL.pickLitMachine(R.createRng(5).fork('lit'), FLOOR), 'the pick is seeded');
});

test('SINGLE LIGHT: the gate lets only the lit machine play, and the bonus is scoped to it at ×1.5', () => {
  assert.equal(SL.singleLightAllows('scratch', 'scratch'), true);
  assert.equal(SL.singleLightAllows('scratch', 'bigone'), false);
  assert.equal(SL.singleLightAllows(null, 'bigone'), true, 'no lit machine means no gate');
  const fx = SL.singleLightEffects('scratch');
  assert.equal(fx.length, 1);
  assert.equal(fx[0].hook, 'payout.mult');
  assert.equal(fx[0].op, 'mult');
  assert.equal(fx[0].value, 1.5);
  assert.deepEqual(fx[0].scope, { machines: ['scratch'] });
});

test('SINGLE LIGHT in a Watch: the gate holds for 40 s of Watch clock and then lets every machine play again', () => {
  const we = makeWE();
  beginUntil(we, 'single_light');
  const lit = we.snapshot().aux.lit;
  assert.equal(lit, 'scratch');
  assert.equal(we.allowsPlay('scratch'), true);
  assert.equal(we.allowsPlay('bigone'), false);
  we.tick(39.5);
  assert.equal(we.allowsPlay('bigone'), false, 'still dark at 39.5 s');
  we.tick(0.6);
  assert.equal(we.view(), null, 'the event is over after 40 s');
  assert.equal(we.allowsPlay('bigone'), true, 'the floor is back');
});

// ── STAGE AUCTION ─────────────────────────────────────────────────────────────────────────────────────────
test('STAGE AUCTION: a bid must beat your own top bid, fit the pocket, and is charged as the raise over the top bid', () => {
  const s = AU.rollAuction(R.createRng(31).fork('a'));
  assert.equal(AU.bidAuction(s, 3, 2).ok, false, 'a bid the pocket cannot cover');
  assert.equal(AU.bidAuction(s, 3, 2).why, 'pocket');
  const first = AU.bidAuction(s, 5, 10);
  assert.deepEqual(first, { ok: true, charge: 5 });
  assert.equal(AU.bidAuction(s, 5, 10).why, 'low', 'not above your own top');
  const second = AU.bidAuction(s, 8, 4);
  assert.deepEqual(second, { ok: true, charge: 3 }, 'only the raise over 5 is charged');
  assert.equal(s.top, 8);
});

test('STAGE AUCTION: the House raises once at 10 s by its seeded step, and the new price is reported on that frame only', () => {
  const s = AU.rollAuction(R.createRng(32).fork('b'));
  const base = AU.auctionPrice(s);
  assert.equal(AU.tickAuction(s, 9.9).raised, null);
  const up = AU.tickAuction(s, 0.2);
  assert.equal(up.raised, base + s.raiseBy, 'the raise is announced with the new price');
  assert.equal(AU.tickAuction(s, 1).raised, null, 'once only');
  assert.ok(s.raiseBy >= 1 && s.raiseBy <= 3, 'a raise of 1 to 3');
  assert.ok(s.house >= 4 && s.house <= 10, 'an opening price of 4 to 10');
});

test('STAGE AUCTION: the top bid above the House price wins the boost; below it, the House keeps the coins and a Ticket is the consolation', () => {
  const s = AU.rollAuction(R.createRng(33).fork('c'));
  const price = AU.auctionPrice(s);
  const win = { ...s, raised: false, phase: 'bid', top: price + 1 };
  const won = AU.closeAuction(win);
  assert.equal(won.won, true);
  assert.deepEqual(won.award, s.boost);
  assert.equal(won.consolation, null);
  assert.equal(AU.bidAuction(win, 99, 99).why, 'closed', 'closed after the close');
  const lose = { ...s, raised: false, phase: 'bid', top: price };
  const lost = AU.closeAuction(lose);
  assert.equal(lost.won, false, 'a bid equal to the price does not beat it');
  assert.equal(lost.award, null);
  assert.deepEqual(lost.consolation, { kind: 'ticket', n: 1 });
});

test('STAGE AUCTION: the boost is one of the three kinds, rolled at the start', () => {
  const kinds = new Set();
  for (let k = 0; k < 300; k++) kinds.add(AU.rollAuction(R.createRng(40).fork(`k.${k}`)).boost.kind);
  assert.deepEqual([...kinds].sort(), ['ticket', 'time', 'tonic']);
  for (let k = 0; k < 300; k++) {
    const b = AU.rollAuction(R.createRng(41).fork(`t.${k}`)).boost;
    if (b.kind === 'tonic') assert.ok(AU.AUCTION_TONICS.includes(b.id));
    if (b.kind === 'time') assert.equal(b.s, AU.AUCTION_TIME_BOOST_S);
  }
});

test('STAGE AUCTION in a Watch: bids charge the pocket through the event, the raise is queued, and the close queues the outcome', () => {
  const we = makeWE();
  beginUntil(we, 'stage_auction');
  const v = we.view();
  assert.equal(v.id, 'stage_auction');
  assert.equal(v.info.key, 'event.watch.stage_auction.hud');
  const a = we.snapshot().aux.auction;
  const pocket = 100;
  const r = we.bidAuction(a.house + 5, pocket);
  assert.equal(r.ok, true);
  assert.equal(r.charge, a.house + 5);
  we.tick(10.5);
  const raised = we.takeOutcomes();
  assert.ok(raised.some((o) => o.kind === 'raise' && o.price === a.house + a.raiseBy), 'the raise is queued');
  we.tick(10);
  assert.equal(we.view(), null, 'the auction closes at 20 s');
  const out = we.takeOutcomes().find((o) => o.kind === 'auction');
  assert.ok(out, 'the auction outcome is queued');
  assert.equal(out.spent, a.house + 5);
  assert.equal(out.won, a.house + 5 > a.house + a.raiseBy);
  assert.equal(we.takeOutcomes().length, 0, 'the outbox drains');
});

// ── CRATE DROP ────────────────────────────────────────────────────────────────────────────────────────────
test('CRATE DROP: the reward is one of Ticket, tonic or charm, and the crate opens once, within reach, on a press', () => {
  const s = CR.rollCrate(R.createRng(50).fork('c'), FLOOR);
  assert.ok(['ticket', 'tonic', 'charm'].includes(s.reward.kind));
  assert.equal(CR.tryOpenCrate(s, { x: 0.5, z: 0 }, false), null, 'no press, no reward');
  assert.equal(CR.tryOpenCrate(s, { x: 9, z: 0 }, true), null, 'out of reach');
  const got = CR.tryOpenCrate(s, { x: 0.5, z: 0 }, true);
  assert.deepEqual(got, s.reward);
  assert.equal(CR.tryOpenCrate(s, { x: 0, z: 0 }, true), null, 'opens once');
});

test('CRATE DROP degrades: with no Lobby anchor it opens on any press', () => {
  const s = CR.rollCrate(R.createRng(51).fork('d'), { machines: [] });
  assert.equal(s.at, null);
  assert.ok(CR.tryOpenCrate(s, { x: 40, z: 40 }, true));
});

test('CRATE DROP in a Watch: the press queues the reward and ends the event', () => {
  const we = makeWE();
  beginUntil(we, 'crate_drop');
  assert.equal(we.openCrate({ x: 9, z: 9 }, true), null, 'out of reach in the Watch too');
  const award = we.openCrate({ x: 0.1, z: 0.1 }, true);
  assert.ok(award);
  assert.equal(we.view(), null, 'the crate is gone after it opens');
  assert.deepEqual(we.takeOutcomes(), [{ kind: 'crate', reward: award }]);
});

// ── WHEEL SPIN ────────────────────────────────────────────────────────────────────────────────────────────
test('WHEEL SPIN: four equal segments, each one a floor rule the fold already reads', () => {
  const rng = R.createRng(60);
  const seen = new Set();
  for (let k = 0; k < 400; k++) seen.add(WH.spinWheel(rng.fork(`w.${k}`)));
  assert.deepEqual([...seen].sort(), [...WH.WHEEL_SEGMENTS].sort());
  assert.equal(WH.WHEEL_SEGMENTS.length, 4);
  const hooks = (seg) => WH.wheelEffects(seg).map((e) => e.hook).join(',');
  assert.equal(hooks('extra_pull'), 'x.run.pullsAdd');
  assert.equal(hooks('hot_lamp'), 'x.lamp.hotMult');
  assert.equal(hooks('tilt_grace'), 'x.tilt.grace');
  assert.equal(hooks('payout_dip'), 'payout.mult');
  assert.equal(WH.wheelEffects('payout_dip')[0].value, 0.9);
  assert.equal(WH.wheelSpinning(0), true);
  assert.equal(WH.wheelSpinning(WH.WHEEL_SPIN_S), false);
});

test('WHEEL SPIN in a Watch: the rule holds for 30 s of Watch clock, then the floor is back to normal', () => {
  const we = makeWE();
  beginUntil(we, 'wheel_spin');
  const seg = we.snapshot().aux.seg;
  const out = [];
  we.collect({}, out);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].effects, WH.wheelEffects(seg));
  we.tick(29.5);
  assert.ok(we.view(), 'still on at 29.5 s');
  we.tick(0.6);
  assert.equal(we.view(), null, 'off after 30 s');
});

// ── LAST CALL DARE ────────────────────────────────────────────────────────────────────────────────────────
test('LAST CALL DARE: the coin is a seeded 50/50: a win is doubled or wiped; a loss stays a loss, and the dare is spent either way', () => {
  const d = DA.rollDare(R.createRng(70).fork('d'));
  assert.equal(DA.acceptDare(d), false, 'not armed yet');
  d.armed = true;
  assert.equal(DA.acceptDare(d), true);
  assert.equal(DA.acceptDare(d), false, 'once');
  assert.equal(DA.dareEffects(d)[0].value, d.doubles ? 2 : 0);
  assert.equal(DA.settleDare(d, false), 'loss');
  assert.deepEqual(DA.dareEffects(d), [], 'spent: no effect after the result');
  const yes = { armed: true, accepted: false, spent: false, doubles: true };
  DA.acceptDare(yes);
  assert.equal(DA.settleDare(yes, true), 'doubled');
  const no = { armed: true, accepted: false, spent: false, doubles: false };
  DA.acceptDare(no);
  assert.equal(DA.settleDare(no, true), 'wiped');
});

test('LAST CALL DARE in a Watch: it does not count down until the Watch clock is in its last 20 s, and it only arms there', () => {
  const we = makeWE();
  beginUntil(we, 'last_call_dare');
  we.tick(5);
  assert.equal(we.view().leftS, 20, 'the timer waits while not armed');
  assert.equal(we.view().canAccept, false);
  we.watchLeft(35);
  assert.equal(we.view().canAccept, false, 'not yet at 35 s left');
  we.watchLeft(20);
  assert.equal(we.view().canAccept, true, 'armed at 20 s left');
  assert.equal(we.view().info.key, 'event.watch.last_call_dare.hud.ready');
  assert.equal(we.acceptDare(), true);
  assert.equal(we.view().info.key, 'event.watch.last_call_dare.hud.on');
});

test('LAST CALL DARE in a Watch: a taken dare doubles or wipes the next result only, then the event ends', () => {
  const we = makeWE();
  beginUntil(we, 'last_call_dare');
  const doubles = we.snapshot().aux.dare.doubles;
  we.watchLeft(20);
  assert.equal(we.acceptDare(), true);
  const out = [];
  we.collect({}, out);
  assert.deepEqual(out[0].effects, [{ hook: 'payout.mult', op: 'mult', value: doubles ? 2 : 0 }]);
  we.onPull('coinflip', true);
  const r = we.takeOutcomes();
  assert.deepEqual(r, [{ kind: 'dare', result: doubles ? 'doubled' : 'wiped' }]);
  assert.equal(we.view(), null, 'the dare ends with its result');
});

test('LAST CALL DARE: a loss on the dared result reports a loss', () => {
  const we = makeWE();
  beginUntil(we, 'last_call_dare');
  we.watchLeft(20);
  we.acceptDare();
  we.onPull('bigone', false);
  assert.deepEqual(we.takeOutcomes(), [{ kind: 'dare', result: 'loss' }]);
});

test('LAST CALL DARE: not taken, it passes at the Watch end with nothing queued', () => {
  const we = makeWE();
  beginUntil(we, 'last_call_dare');
  we.watchLeft(20);
  we.end();
  assert.equal(we.takeOutcomes().length, 0);
});

// ── save, restore, the Compere ──────────────────────────────────────────────────────────────────────────
test('the save carries the wave 75 state: a reload mid-auction keeps the top bid and the price', () => {
  const we = makeWE();
  beginUntil(we, 'stage_auction');
  const a = we.snapshot().aux.auction;
  we.bidAuction(a.house + 2, 50);
  const save = JSON.parse(JSON.stringify(we.snapshot()));
  const back = makeWE();
  back.restore(save);
  assert.equal(back.view().id, 'stage_auction');
  assert.equal(back.bidAuction(a.house + 1, 50).why, 'low', 'the top bid survives the reload');
  assert.deepEqual(back.view().info, { key: 'event.watch.stage_auction.hud', vars: { n: AU.auctionPrice(a) } });
});

test('a save from before wave 75 (no aux) restores the event without throwing', () => {
  const we = makeWE();
  we.restore({ id: 'crate_drop', leftS: 30, pulls: null, last: null, lastNight: 0 });
  assert.equal(we.view().id, 'crate_drop');
  assert.equal(we.view().info, null, 'no crate state, no line');
});

test('the Compere lines: every wave 75 event has an en and a tr line, and the Compere speaks through the subtitle voice', () => {
  for (const id of NEW) {
    for (const k of [`${id}.name`, `${id}.desc`, `${id}.announce`, `${id}.compere`]) {
      assert.ok(STR.en[k], `en ${k}`);
      assert.ok(STR.tr[k], `tr ${k}`);
    }
  }
  I18N.setLang('en');
  const line = CP.compereLine('crate_drop');
  assert.equal(line.text, I18N.t('event.watch.crate_drop.compere'));
  assert.equal(line.speaker, 'COMPERE');
  assert.equal(line.voice, 'compere');
  assert.equal(line.lane, 'ambient');
  I18N.setLang('tr');
  assert.equal(CP.compereLine('crate_drop').speaker, 'SUNUCU');
  I18N.setLang('en');
});

test('the wave 75 strings keep the same keys in en and tr', () => {
  const en = Object.keys(STR.en).sort();
  const tr = Object.keys(STR.tr).sort();
  assert.deepEqual(en, tr);
});
