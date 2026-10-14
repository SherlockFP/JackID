// Unit tests for SYMBOL STAMPS (src/game/stamps.ts): the Stamp board (seeded stock, prices as a share of the Night quota, reroll,
// lock, buy), the mod provider (Big One scoped effects on the hooks buildMods folds), snapshot / restore, getStampLevels, and
// the RTP acceptance of the economy: any single stamp moves the Big One by at most 4 points, the best build stays at 1.30 or less.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let ST, R, RNG, CORE, STR;
before(async () => {
  ST = await load('src/game/stamps.ts');
  R = await load('src/machines/bigone/rules.ts');
  RNG = await load('src/core/rng.ts');
  CORE = await load('src/core/stampLevels.ts');
  STR = (await load('src/game/stamps.strings.ts')).default;
});

/** A host with a wallet, tickets and a movable Night / Watch; the rng is shared and never advanced by the book. */
function mk(seed = 77, o = {}) {
  const st = { wallet: 1e6, tickets: 50, spent: 0, night: 0, watch: 0, open: true, base: 1000, touches: 0, ...o };
  const rng = RNG.createRng(seed);
  const host = {
    rng: () => rng,
    night: () => st.night,
    watch: () => st.watch,
    open: () => st.open,
    baseQuota: () => st.base,
    wallet: () => st.wallet,
    tickets: () => st.tickets,
    spend: (c) => { if (st.wallet < c) return false; st.wallet -= c; st.spent += c; return true; },
    spendTickets: (n) => { if (st.tickets < n) return false; st.tickets -= n; return true; },
    touch: () => { st.touches++; },
  };
  const book = new ST.StampBook(host);
  return { st, host, book };
}
const ids = (book) => book.offers().map((o) => (o ? `${o.kind}:${o.target}` : '-')).join(',');

test('the board has 3 distinct, valid offers; no Shift without a Gild, no locked patterns', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const { book } = mk(seed);
    book.sync();
    const offers = book.offers();
    assert.equal(offers.length, ST.OFFER_COUNT);
    const seen = new Set();
    for (const o of offers) {
      assert.ok(o, 'a full board at the start');
      const id = `${o.kind}:${o.target}`;
      assert.ok(!seen.has(id), `duplicate ${id}`);
      seen.add(id);
      assert.notEqual(o.kind, 'shift', 'a Shift needs a gilded symbol first');
      assert.ok(!ST.ETCH_LOCKED_BY_DEFAULT.has(o.target), `${o.target} is locked until the run earns it`);
      assert.notEqual(o.target, 'FULL');
    }
  }
});

test('same seed, same stock; a different seed or a different Night changes it', () => {
  const a = mk(2026), b = mk(2026), c = mk(2027);
  a.book.sync(); b.book.sync(); c.book.sync();
  assert.equal(ids(a.book), ids(b.book));
  // the same sequence of rerolls gives the same stock as well
  for (let i = 0; i < 4; i++) { a.book.reroll(); b.book.reroll(); assert.equal(ids(a.book), ids(b.book)); }
  const boards = new Set();
  for (let seed = 1; seed <= 30; seed++) { const m = mk(seed); m.book.sync(); boards.add(ids(m.book)); }
  assert.ok(boards.size > 20, `the seed matters (${boards.size} different boards in 30)`);
  const n0 = mk(5), n1 = mk(5, { night: 1 });
  n0.book.sync(); n1.book.sync();
  assert.notEqual(ids(n0.book), ids(n1.book), 'a new Night draws a new board');
});

test('the board is drawn once per intermission and not while the window is shut', () => {
  const { book, st } = mk(9, { open: false });
  book.sync();
  assert.deepEqual(book.offers(), [], 'shut: nothing on show');
  st.open = true;
  book.sync();
  const first = ids(book);
  book.sync();
  assert.equal(ids(book), first, 'a second sync in the same intermission changes nothing');
  st.watch = 1;
  book.sync();
  assert.notEqual(ids(book), first, 'the next Watch restocks');
});

test('prices are a share of the Night base quota: Gild 18 / 30 / 45 %, Shift 15 %, Etch 12 % x pattern size', () => {
  assert.deepEqual([0, 1, 2].map((l) => ST.stampPrice('gild', 'MOTH', l, 1000)), [180, 300, 450]);
  assert.equal(ST.stampPrice('shift', 'SUN', 0, 1000), 150);
  assert.equal(ST.stampPrice('shift', 'SUN', 2, 1000), 150);
  assert.equal(ST.stampPrice('etch', 'RAIL', 0, 1000), 120);
  assert.equal(ST.stampPrice('etch', 'TREY', 0, 1000), 72, 'cheap on small patterns');
  assert.ok(ST.stampPrice('etch', 'HALO', 0, 1000) > ST.stampPrice('etch', 'RAIL', 0, 1000), 'dear on big ones');
  assert.ok(ST.stampPrice('etch', 'TWIN_RAILS', 0, 1000) > ST.stampPrice('etch', 'HALO', 0, 1000));
  assert.ok(ST.stampPrice('gild', 'MOTH', 0, 31) >= 1, 'a Night 1 quota still gives a whole-coin price');
  // the board shows the same figures
  const { book } = mk(3, { base: 2300 });
  book.sync();
  for (const o of book.offers()) assert.equal(o.price, ST.stampPrice(o.kind, o.target, o.level, 2300));
});

test('buying charges the exact price, raises the level and moves the Big One hooks', () => {
  let m = null;
  for (let seed = 11; seed < 80 && !m; seed++) { const c = mk(seed); c.book.sync(); if (c.book.offers().some((x) => x && x.kind === 'gild')) m = c; }
  assert.ok(m, 'some board offers a Gild');
  const { book, st } = m;
  const o = book.offers().find((x) => x && x.kind === 'gild');
  const target = o.target;
  const before = st.wallet;
  assert.deepEqual(book.buy(book.offers().findIndex((x) => x && x.kind === 'gild')), { ok: true, why: '' });
  assert.equal(before - st.wallet, o.price);
  assert.equal(book.levels().gild[target], 1);
  assert.equal(book.count(), 1);
  assert.ok(st.touches > 0, 'the modifier caches are told');
  const hook = ST.stampHook(book.levels());
  assert.equal(hook(`x.bigone.symbolValueAdd[${target}]`, 0), ST.GILD_STEP[target]);
  assert.equal(hook('x.bigone.symbolValueAdd[NOPE]', 0), 0, 'untouched hooks pass through');
});

test('refusals: short of coins, window shut, empty slot, book full — nothing is charged', () => {
  const { book, st } = mk(12, { wallet: 0 });
  book.sync();
  assert.deepEqual(book.buy(0), { ok: false, why: 'funds' });
  assert.equal(book.buy(2 + 1).why, 'none');
  st.wallet = 1e6; st.open = false;
  assert.equal(book.buy(0).why, 'closed');
  st.open = true;
  assert.equal(st.spent, 0);
  // fill the book through the 8 slots, then the board refuses
  const f = mk(13);
  f.book.sync();
  const pool = ['MOTH', 'TOOTH', 'KEY', 'CANDLE', 'RING', 'CROWN', 'SUN'];
  for (let i = 0; i < ST.STAMP_CAP; i++) assert.ok(f.book.grant('gild', pool[i % pool.length]));
  assert.equal(f.book.count(), ST.STAMP_CAP);
  assert.equal(f.book.grant('gild', 'MOTH'), false, 'the cap');
  assert.equal(f.book.grant('etch', 'EYE'), false, 'the cap');
  const idx = f.book.offers().findIndex((o) => o);
  if (idx >= 0) assert.equal(f.book.buy(idx).why, 'full');
});

test('levels are capped: Gild 3 and Shift 3 per symbol, Etch 4 per pattern, and a Shift needs a Gild first', () => {
  const { book } = mk(14);
  for (let i = 0; i < 5; i++) book.grant('gild', 'RING');
  assert.equal(book.levels().gild.RING, ST.GILD_MAX);
  assert.equal(book.grant('shift', 'KEY'), false, 'KEY is not a Shift target');
  assert.equal(book.grant('shift', 'CROWN'), false, 'no Gild on CROWN yet');
  for (let i = 0; i < 5; i++) book.grant('shift', 'RING');
  assert.equal(book.levels().shift.RING, ST.SHIFT_MAX);
  const e = mk(15);
  for (let i = 0; i < 6; i++) e.book.grant('etch', 'RAIL');
  assert.equal(e.book.levels().etch.RAIL, ST.ETCH_MAX);
  assert.equal(e.book.grant('etch', 'FULL'), false);
  assert.equal(e.book.grant('etch', 'TWIN_RAILS'), false, 'locked until the run earns it');
  assert.ok(e.book.count() <= ST.STAMP_CAP);
});

test('a pattern the run unlocked can be etched', () => {
  const m = mk(16);
  m.host.patternUnlocked = (p) => p === 'TWIN_RAILS';
  assert.ok(m.book.grant('etch', 'TWIN_RAILS'));
  assert.equal(m.book.grant('etch', 'CORNERSTONE'), false);
});

test('reroll: costs Tickets (1, +1 per further paid reroll), a failed reroll charges nothing, locks stay', () => {
  const { book, st } = mk(21, { tickets: 3 });
  book.sync();
  assert.equal(book.rerollCost(), 1);
  const before = ids(book).split(',');
  assert.ok(book.lock(1), 'lock costs a Ticket');
  assert.equal(st.tickets, 2);
  assert.ok(book.offers()[1].locked);
  assert.equal(book.lock(0), false, 'one lock at a time');
  assert.equal(st.tickets, 2);
  assert.equal(book.rerollCost(), 1);
  assert.ok(book.reroll());
  assert.equal(st.tickets, 1);
  assert.equal(book.rerollCost(), 2, 'each further paid reroll costs one more');
  const after = ids(book).split(',');
  assert.equal(after[1], before[1], 'the locked offer stays');
  assert.equal(book.reroll(), false, 'two Tickets needed, one left');
  assert.equal(st.tickets, 1, 'nothing charged');
  assert.ok(book.unlock(1));
  assert.equal(book.unlock(1), false);
  // the lock carries into the next intermission, and the price follows the new Night
  assert.ok(book.lock(1));
  const keep = ids(book).split(',')[1];
  st.night = 1; st.watch = 0; st.base = 2000;
  book.sync();
  assert.equal(ids(book).split(',')[1], keep, 'locked across intermissions');
  assert.equal(book.offers()[1].price, ST.stampPrice(book.offers()[1].kind, book.offers()[1].target, book.offers()[1].level, 2000));
  assert.equal(book.rerollCost(), 1, 'the escalation resets with the intermission');
});

test('a bought offer leaves the board; its slot stays empty until the next intermission', () => {
  const { book, st } = mk(23);
  book.sync();
  assert.ok(book.buy(0).ok);
  assert.equal(book.offers()[0], null);
  assert.ok(book.offers()[1] && book.offers()[2]);
  st.watch = 1;
  book.sync();
  assert.ok(book.offers().every((o) => o), 'a fresh board');
});

test('a Shift is offered once its symbol is gilded', () => {
  let seen = false;
  for (let seed = 1; seed <= 200 && !seen; seed++) {
    const { book, st } = mk(seed);
    book.grant('gild', 'SUN');
    for (let w = 0; w < 6; w++) {
      st.watch = w;
      book.sync();
      if (book.offers().some((o) => o && o.kind === 'shift')) { seen = true; assert.ok(book.offers().filter((o) => o?.kind === 'shift').every((o) => o.target === 'SUN')); }
    }
  }
  assert.ok(seen, 'a Shift on the gilded symbol shows up');
});

test('snapshot / restore: same levels, same board, and the same rerolls afterwards', () => {
  const a = mk(31);
  a.book.sync();
  a.book.buy(0);
  a.book.grant('gild', 'SUN');
  a.book.lock(2);
  a.book.reroll();
  const snap = JSON.parse(JSON.stringify(a.book.snapshot()));
  const b = mk(31);                       // a fresh host with the same run seed (the real run restores its rng too)
  b.st.tickets = a.st.tickets; b.st.wallet = a.st.wallet;
  b.book.restore(snap);
  assert.equal(ids(b.book), ids(a.book));
  assert.deepEqual(b.book.levels(), a.book.levels());
  assert.equal(b.book.rerollCost(), a.book.rerollCost());
  assert.deepEqual(b.book.snapshot(), a.book.snapshot());
  a.book.reroll(); b.book.reroll();
  assert.equal(ids(b.book), ids(a.book), 'the reroll stream continues where it stopped');
  // garbage in: restore ignores it and clamps what it can
  const c = mk(32);
  c.book.restore(null); c.book.restore({ v: 9 });
  assert.equal(c.book.count(), 0);
  c.book.restore({ v: 1, key: 3, rolls: -4, paid: 'x', gild: { MOTH: 99, SUN: -2 }, shift: {}, etch: { TREY: 2.7, FAKE: 4 }, offers: [{ kind: 'zap', target: 'MOTH' }, { kind: 'gild', target: 'nope' }, null] });
  assert.equal(c.book.levels().gild.MOTH, ST.GILD_MAX);
  assert.equal(c.book.levels().gild.SUN, 0);
  assert.equal(c.book.levels().etch.TREY, 2);
});

test('the book is a Big One scoped mod provider on the hooks buildMods folds', () => {
  const { book } = mk(41);
  const out = [];
  book.collect({}, out);
  assert.equal(out.length, 0, 'an empty book contributes nothing');
  book.grant('gild', 'MOTH'); book.grant('gild', 'RING'); book.grant('shift', 'RING'); book.grant('etch', 'TREY');
  book.collect({}, out);
  assert.equal(out.length, 1);
  const src = out[0];
  assert.equal(src.kind, 'upgrade');
  assert.equal(src.id, 'stamps');
  assert.ok(src.effects.length >= 5);
  for (const e of src.effects) {
    assert.deepEqual(e.scope.machines, ['bigone']);
    assert.equal(e.op, 'add');
    assert.ok(/^x\.bigone\.(symbolValueAdd|symbolWeight|patternMult)\[[A-Z_]+\]$/.test(e.hook), e.hook);
  }
  const hooks = new Set(src.effects.map((e) => e.hook));
  for (const h of ['x.bigone.symbolValueAdd[MOTH]', 'x.bigone.symbolValueAdd[RING]', 'x.bigone.symbolWeight[RING]', 'x.bigone.symbolWeight[KEY]', 'x.bigone.symbolWeight[CANDLE]', 'x.bigone.patternMult[TREY]']) assert.ok(hooks.has(h), h);
  // a Shift moves weight, it does not create it: the donors give exactly what the target takes
  const sum = src.effects.filter((e) => e.hook.startsWith('x.bigone.symbolWeight')).reduce((a, e) => a + e.value, 0);
  assert.ok(Math.abs(sum) < 1e-9, `weight is conserved (${sum})`);
  // the same source object is reused until the book changes, then rebuilt
  const again = []; book.collect({}, again);
  assert.deepEqual(again[0].effects, src.effects);
  book.grant('gild', 'SUN');
  const third = []; book.collect({}, third);
  assert.ok(third[0].effects.length > src.effects.length);
  // buildMods reads them: RING pays more, TREY multiplies more
  const mods = R.buildMods(ST.stampHook(book.levels()));
  assert.equal(mods.values[4], R.BASE_VALUE[4] + ST.GILD_STEP.RING);
  assert.equal(mods.patAdd.TREY, ST.ETCH_STEP.TREY);
  assert.equal(mods.weights[4], R.BASE_WEIGHT[4] + ST.SHIFT_WEIGHT.RING);
  assert.equal(mods.weights[2], R.BASE_WEIGHT[2] - ST.SHIFT_WEIGHT.RING / 2);
  assert.equal(mods.weights.reduce((a, b) => a + b, 0), R.BASE_WEIGHT.reduce((a, b) => a + b, 0), 'total weight is unchanged');
});

test('getStampLevels: the active book for visuals (also through the core registry), empty without one', () => {
  ST.setActiveStampBook(null);
  assert.equal(ST.getStampLevels().total, 0);
  assert.deepEqual(CORE.getStampLevels().gild, {});
  const { book } = mk(51);
  book.grant('gild', 'SUN'); book.grant('gild', 'SUN'); book.grant('etch', 'EYE');
  assert.equal(ST.getStampLevels(book).gild.SUN, 2);
  ST.setActiveStampBook(book);
  assert.equal(ST.getStampLevels().gild.SUN, 2);
  assert.equal(ST.getStampLevels().etch.EYE, 1);
  assert.equal(CORE.getStampLevels().gild.SUN, 2, 'a machine reads the same data from core');
  assert.equal(CORE.getStampLevels().total, 3);
  assert.equal(CORE.getStampLevels().cap, ST.STAMP_CAP);
  book.grant('gild', 'SUN');
  assert.equal(CORE.getStampLevels().gild.SUN, 3, 'live, not a copy');
  ST.setActiveStampBook(null);
  assert.equal(CORE.getStampLevels().total, 0);
});

test('strings: every key the stamps use exists in English and Turkish with the same placeholders', () => {
  const en = Object.keys(STR.en).sort(), tr = Object.keys(STR.tr).sort();
  assert.deepEqual(en, tr);
  const ph = (s) => (s.match(/\{[a-z]+\}/g) ?? []).sort().join();
  for (const k of en) { assert.ok(STR.tr[k].length > 0); assert.equal(ph(STR.en[k]), ph(STR.tr[k]), k); }
  for (const n of R.SYM_NAMES) assert.ok(`sym.${n}` in STR.en, n);
  for (const p of ST.ETCH_PATTERNS) assert.ok(`pat.${p}` in STR.en, p);
  for (const k of ['kind.gild', 'kind.shift', 'kind.etch', 'tab.charms', 'tab.stamps']) assert.ok(k in STR.en, k);
});

// ── the economy: RTP acceptance (headless Big One, stake 10, common random numbers) ─────────────────────────────
const SPINS = 250000;
function rtp(lv, n = SPINS, seed = 20261013) {
  const rng = RNG.createRng(seed);
  const mods = R.buildMods(ST.stampHook(lv));
  let g = 0;
  for (let i = 0; i < n; i++) {
    g += R.play(rng, 10, { mods, luck: 0, sinceCurse: rng.int(0, 9), wardOn: false, meter: R.SEED_STAKES * R.MAX_STAKE, maxStake: R.MAX_STAKE, prev: [], hold: -1 }).gross;
  }
  return g / (n * 10);
}
const lvl = (o) => ({ gild: o.gild ?? {}, shift: o.shift ?? {}, etch: o.etch ?? {} });

test('RTP: any single stamp moves the Big One by at most 4 points', () => {
  const base = rtp(lvl({}));
  assert.ok(base > 0.9 && base < 1.05, `the base game is about 0.98 (got ${base.toFixed(3)})`);
  const rows = [];
  for (const n of R.SYM_NAMES) rows.push([`GILD ${n}`, lvl({ gild: { [n]: 1 } })]);
  for (const n of ST.SHIFT_TARGETS) rows.push([`SHIFT ${n}`, lvl({ shift: { [n]: 1 } })]);
  for (const p of ['TREY', 'PILLAR', 'SLASH', 'QUAD', 'EYE', 'CLUSTER', 'RAIL']) rows.push([`ETCH ${p}`, lvl({ etch: { [p]: 1 } })]);
  let worst = 0;
  for (const [name, lv] of rows) {
    const d = (rtp(lv) - base) * 100;
    worst = Math.max(worst, Math.abs(d));
    assert.ok(Math.abs(d) <= ST.MAX_SINGLE_POINTS, `${name} moves RTP by ${d.toFixed(2)} points`);
  }
  assert.ok(worst > 2, `the strongest single stamp is worth buying (${worst.toFixed(2)} points)`);
});

test('RTP: stamps are worth it (Gild, Etch and a gilded Shift all pay) and the book stays under the 1.30 ceiling', () => {
  const base = rtp(lvl({}));
  // each kind raises the return when used as intended
  assert.ok(rtp(lvl({ gild: { MOTH: 1 } })) > base + 0.02);
  assert.ok(rtp(lvl({ etch: { TREY: 1 } })) > base + 0.02);
  assert.ok(rtp(lvl({ gild: { RING: 2 }, shift: { RING: 2 } })) > rtp(lvl({ gild: { RING: 2 } })) + 0.005, 'a Shift on a gilded symbol adds return');
  // the strongest builds under the cap (found by `node scripts/sim/run.mjs --stamp-report`, which searches them) are pinned here
  const builds = {
    'best found: Gild RING 3 + MOTH 2, Etch TREY 3': lvl({ gild: { RING: 3, MOTH: 2 }, etch: { TREY: 3 } }),
    'fillers: Gild MOTH 3 + TOOTH 3, Etch TREY 2': lvl({ gild: { MOTH: 3, TOOTH: 3 }, etch: { TREY: 2 } }),
    'full ring: Gild 3 + Shift 3, Etch TREY 2': lvl({ gild: { RING: 3 }, shift: { RING: 3 }, etch: { TREY: 2 } }),
    'short patterns: Etch TREY 4 + SLASH 4': lvl({ etch: { TREY: 4, SLASH: 4 } }),
    'mixed: Gild MOTH 3 + RING 3, Etch TREY 2': lvl({ gild: { MOTH: 3, RING: 3 }, etch: { TREY: 2 } }),
  };
  for (const [name, lv] of Object.entries(builds)) {
    const n = [lv.gild, lv.shift, lv.etch].reduce((a, t) => a + Object.values(t).reduce((x, y) => x + y, 0), 0);
    assert.ok(n <= ST.STAMP_CAP, `${name}: ${n} stamps`);
    const v = rtp(lv, 400000, 9917);
    assert.ok(v <= ST.MAX_BUILD_RTP, `${name}: RTP ${v.toFixed(3)} is over ${ST.MAX_BUILD_RTP}`);
  }
});
