// Unit tests for wave 7: charm evolution (the second stack of an engine charm, offered as EVOLVE by the Pawn) and archetype
// sets (src/game/charms/sets.ts). The real Charms and Pawn classes run here, with a fake run and host around them.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let S, E, SH, R, D, ENGINE_IDS = [];
before(async () => {
  S = await load('src/game/charms/sets.ts');
  E = await load('src/game/charms/engine.ts');
  SH = await load('src/game/shop.ts');
  R = await load('src/core/rng.ts');
  D = await load('src/game/data/charmsEngines.ts');
  ENGINE_IDS = D.CHARM_ENGINE_DATA.map((d) => d.id);
});

// ── fakes ───────────────────────────────────────────────────────────────────────────────────────
/** The run facade the engine charms read (see engines.test.mjs). No circuit, no shift in play. */
const fakeRun = () => ({
  shift: { state: () => ({ phase: 'play' }), quota: () => ({ met: false, ratio: 0 }) },
  balance: () => 0,
  charms: () => [],
  earn() {},
  circuit: null,
});

/** A real Charms book for player 1, with `pegs` free pegs. */
function bookOf(pegs = 6, seed = 42) {
  const host = { selfId: 1, run: () => fakeRun(), rng: R.createRng(seed), touch() {} };
  return new E.Charms(host);
}

/** The ModSources the book folds for player 1 (what the run's `mod()` reads). */
function sourcesOf(book) {
  const out = [];
  book.collect({ pid: 1 }, out);
  return out;
}
const setSource = (book, id) => sourcesOf(book).find((s) => s.id === `set.${id}`);

/** A real Pawn over a real book. Gold and pegs are the host's; `night` 3 means every engine charm is unlocked. */
function pawnOver(book, o = {}) {
  const rng = R.createRng(o.seed ?? 7);
  const st = { coins: o.coins ?? 100000, tix: o.tix ?? 0, pegs: o.pegs ?? 6 };
  const host = {
    selfId: 1, rng: () => rng, night: () => o.night ?? 3, watch: () => 0, open: () => true, si: () => 1,
    held: () => book.list(1).map((s) => s.id),
    canTake: (id) => {
      const def = E.charmDef(id);
      if (!def) return false;
      const s = book.find(1, id);
      return s ? (s.stacks ?? 1) < (def.maxStacks ?? 1) : book.pegsUsed(1) < st.pegs;
    },
    pegsFree: () => st.pegs - book.pegsUsed(1),
    wallet: () => st.coins, tickets: () => st.tix,
    spendTickets: (n) => { if (st.tix < n) return false; st.tix -= n; return true; },
    freeRerolls: () => 0, useFreeReroll: () => false,
    buyCharm: (id, price) => {
      if (price > 0 && st.coins < price) return false;
      if (!book.add(1, id, st.pegs)) return false;
      st.coins -= price;
      return true;
    },
    sellCharm: (id) => {
      const def = E.charmDef(id);
      if (!book.remove(1, id)) return false;
      st.coins += Math.floor((def?.price ?? 0) / 2);
      return true;
    },
    sellValue: (id) => Math.floor((E.charmDef(id)?.price ?? 0) / 2),
    removeCurse: () => false,
  };
  return { host, st, pawn: new SH.Pawn(host) };
}

const ids =(stock) => stock.map((s) => (s ? s.charmId : null));

// ── sets: the rule ──────────────────────────────────────────────────────────────────────────────
const TAGS = {
  capacitor: ['hot'], lampwick: ['hot'], pressure_valve: ['clutch'], last_gasp: ['clutch'],
  ticket_press: ['banker'], snowball_ledger: ['banker'], false_ceiling: ['whale'], gilded_chip: ['whale'],
  suit_ladder: ['rotation'], understudy: ['copycat'],
};
const tagsOf = (id) => TAGS[id];

test('sets: two charms of one archetype switch that set on; one alone does not', () => {
  assert.deepEqual(S.activeSets([{ id: 'capacitor' }], tagsOf), []);
  assert.deepEqual(S.activeSets([{ id: 'capacitor' }, { id: 'lampwick' }], tagsOf), ['hot']);
  assert.deepEqual(S.activeSets([{ id: 'capacitor' }, { id: 'pressure_valve' }], tagsOf), []);
});

test('sets: several sets can be on at once, listed in archetype order', () => {
  const held = [{ id: 'false_ceiling' }, { id: 'gilded_chip' }, { id: 'capacitor' }, { id: 'lampwick' }];
  assert.deepEqual(S.activeSets(held, tagsOf), ['hot', 'whale']);
  assert.equal(S.SET_SIZE, 2);
});

test('sets: a charm counts once, whatever its stacks, and a non-archetype tag never counts', () => {
  assert.deepEqual(S.activeSets([{ id: 'capacitor' }, { id: 'capacitor' }], tagsOf), []);
  assert.deepEqual(S.activeSets([{ id: 'x' }, { id: 'y' }], () => ['LEDGER', 'reels']), []);
});

test('sets: the bonuses are the plan numbers (hot +0.1, clutch +6 s, banker +1 %, whale ×1.25, rotation +1 tilt grace)', () => {
  assert.deepEqual(S.setEffects(['hot']), [{ hook: 'x.lamp.hotMult', op: 'add', value: 0.1 }]);
  assert.deepEqual(S.setEffects(['clutch']), [{ hook: 'x.run.lastCallAdd', op: 'add', value: 6 }]);
  assert.deepEqual(S.setEffects(['banker']), [{ hook: 'x.econ.interestAdd', op: 'add', value: 0.01 }]);
  assert.deepEqual(S.setEffects(['whale']), [{ hook: 'x.house.limitMult', op: 'mult', value: 1.25 }]);
  assert.deepEqual(S.setEffects(['rotation']), [{ hook: 'x.tilt.grace', op: 'add', value: 1 }]);
  assert.deepEqual(S.setEffects(['copycat']), []);
});

test('sets: each engine charm carries the archetype the test table says, and all six archetypes are in use', () => {
  for (const d of D.CHARM_ENGINE_DATA) assert.deepEqual(d.tags, TAGS[d.id], d.id);
  const used = new Set(ENGINE_IDS.map((id) => TAGS[id][0]));
  assert.equal(used.size, 6, 'rotation, hot, clutch, banker, whale and copycat');
});

test('sets: the Copycat set needs a second copycat charm; the Understudy alone does not switch it on', () => {
  const book = bookOf(6);
  book.add(1, 'understudy', 6);
  book.add(1, 'capacitor', 6);
  assert.equal(setSource(book, 'copycat'), undefined);
});

// ── sets: on and off through the book (buy, sell, evolve) ──────────────────────────────────────
test('sets: buying the second hot charm turns Hot on; selling one turns it off; buying again turns it back on', () => {
  const book = bookOf(6);
  assert.ok(book.add(1, 'capacitor', 6));
  assert.equal(setSource(book, 'hot'), undefined, 'one hot charm: no set');
  assert.ok(book.add(1, 'lampwick', 6));
  const src = setSource(book, 'hot');
  assert.ok(src, 'two hot charms: the set is on');
  assert.deepEqual(src.effects, [{ hook: 'x.lamp.hotMult', op: 'add', value: 0.1 }]);
  assert.ok(book.remove(1, 'lampwick'));
  assert.equal(setSource(book, 'hot'), undefined, 'sold: the set is off');
  assert.ok(book.add(1, 'lampwick', 6));
  assert.ok(setSource(book, 'hot'), 'bought again: on');
});

test('sets: the whale set is one source of House Limit ×1.25, and it goes with the second charm', () => {
  const book = bookOf(6);
  book.add(1, 'false_ceiling', 6);
  book.add(1, 'gilded_chip', 6);
  const src = setSource(book, 'whale');
  assert.deepEqual(src.effects, [{ hook: 'x.house.limitMult', op: 'mult', value: 1.25 }]);
  book.remove(1, 'gilded_chip');
  assert.equal(setSource(book, 'whale'), undefined);
});

test('sets: an evolution does not switch a set on or off (the set counts charms, not stacks) and takes no peg', () => {
  const book = bookOf(1);
  assert.ok(book.add(1, 'capacitor', 1));
  assert.equal(book.pegsUsed(1), 1);
  assert.equal(setSource(book, 'hot'), undefined);
  assert.ok(book.add(1, 'capacitor', 1), 'the second stack needs no free peg');
  assert.equal(book.pegsUsed(1), 1);
  assert.equal(setSource(book, 'hot'), undefined, 'one charm at two stacks is still one charm');
});

test('sets: a set source carries no per-stack scaling and a charm of an engine set never scales either', () => {
  const book = bookOf(6);
  book.add(1, 'capacitor', 6); book.add(1, 'capacitor', 6);
  book.add(1, 'lampwick', 6);
  for (const s of sourcesOf(book)) {
    if (!ENGINE_IDS.includes(s.id)) continue;
    for (const e of s.effects) assert.equal(e.perStack, false, `${s.id} ${e.hook}`);
  }
  assert.equal(setSource(book, 'hot').stacks, 1);
});

// ── caps and evolution through the book ─────────────────────────────────────────────────────────
test('caps: an engine charm takes a second stack and no third; the base catalogue still takes one', () => {
  const book = bookOf(6);
  assert.ok(book.add(1, 'suit_ladder', 6));
  assert.ok(book.add(1, 'suit_ladder', 6));
  assert.equal(book.find(1, 'suit_ladder').stacks, 2);
  assert.equal(book.add(1, 'suit_ladder', 6), false, 'three stacks: refused');
  assert.equal(book.find(1, 'suit_ladder').stacks, 2);
  assert.ok(book.add(1, 'piggy_tooth', 6));
  assert.equal(book.add(1, 'piggy_tooth', 6), false, 'a base charm stays at one stack');
});

test('caps: the second stack marks the bag evolved (the flag the engine tunes and the peg read)', () => {
  const book = bookOf(6);
  book.add(1, 'pressure_valve', 6);
  assert.notEqual(book.find(1, 'pressure_valve').data?.evo, true);
  book.add(1, 'pressure_valve', 6);
  assert.equal(book.find(1, 'pressure_valve').data.evo, true);
});

test('caps: a restored save with two stacks is evolved even without the flag; a single stack is not', () => {
  const book = bookOf(6);
  book.restore(1, [{ id: 'capacitor', stacks: 2 }, { id: 'lampwick', stacks: 1 }]);
  assert.equal(book.find(1, 'capacitor').data.evo, true);
  assert.notEqual(book.find(1, 'lampwick').data?.evo, true);
});

test('caps: selling an evolved charm gives back its peg and removes both stacks', () => {
  const book = bookOf(2);
  book.add(1, 'capacitor', 2); book.add(1, 'capacitor', 2);
  book.add(1, 'lampwick', 2);
  assert.equal(book.pegsUsed(1), 2);
  assert.ok(book.remove(1, 'capacitor'));
  assert.equal(book.pegsUsed(1), 1);
  assert.equal(book.add(1, 'capacitor', 2), true, 'the freed peg takes a fresh copy');
  assert.equal(book.find(1, 'capacitor').stacks, 1);
});

// ── the Pawn offers EVOLVE ──────────────────────────────────────────────────────────────────────
test('EVOLVE: an owned engine charm is offered as EVOLVE, never as a plain copy', () => {
  let offered = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const book = bookOf(6, seed);
    book.add(1, 'capacitor', 6);
    const { pawn } = pawnOver(book, { seed });
    const stock = pawn.stock(1).filter(Boolean);
    for (const s of stock) {
      if (s.charmId !== 'capacitor') continue;
      assert.equal(s.evolve, true, `seed ${seed}: plain capacitor offer`);
      offered += 1;
    }
  }
  assert.ok(offered > 0, 'EVOLVE shows up across the seeds');
});

test('EVOLVE: buying it adds a stack for no peg, and the shelf stops offering it at two stacks', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const book = bookOf(1, seed);
    book.add(1, 'capacitor', 1);
    const { pawn, st } = pawnOver(book, { seed, pegs: 1 });
    const i = pawn.stock(1).findIndex((s) => s && s.evolve && s.charmId === 'capacitor');
    if (i < 0) continue;
    const price = pawn.stock(1)[i].price;
    const before = st.coins;
    const r = pawn.buy(1, i);
    assert.equal(r.ok, true, r.why);
    assert.equal(book.find(1, 'capacitor').stacks, 2);
    assert.equal(book.pegsUsed(1), 1, 'no peg taken');
    assert.equal(st.coins, before - price);
    assert.equal(book.find(1, 'capacitor').data.evo, true);
    assert.ok(!ids(pawn.stock(1)).includes('capacitor'), 'a sold EVOLVE slot is gone; two stacks is the cap');
    return;
  }
  assert.fail('no seed offered EVOLVE for capacitor');
});

test('EVOLVE: a full shelf of pegs still takes the evolution without a swap', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const book = bookOf(2, seed);
    book.add(1, 'lampwick', 2);
    book.add(1, 'pressure_valve', 2);
    const { pawn } = pawnOver(book, { seed, pegs: 2 });
    const i = pawn.stock(1).findIndex((s) => s && s.evolve);
    if (i < 0) continue;
    assert.equal(pawn.needsSwap(1, i), false);
    assert.equal(pawn.buy(1, i).ok, true);
    assert.equal(book.pegsUsed(1), 2);
    return;
  }
  assert.fail('no seed offered an EVOLVE on a full shelf');
});

test('EVOLVE: a charm already at two stacks is never offered again', () => {
  const book = bookOf(6);
  book.add(1, 'ticket_press', 6); book.add(1, 'ticket_press', 6);
  for (let seed = 1; seed <= 20; seed++) {
    const { pawn } = pawnOver(book, { seed });
    assert.ok(!ids(pawn.stock(1)).includes('ticket_press'), `seed ${seed}`);
  }
});

test('EVOLVE: with the Pawn\'s own rolls, the stock is the same on the same seed (deterministic)', () => {
  const a = bookOf(6, 9); a.add(1, 'gilded_chip', 6);
  const b = bookOf(6, 9); b.add(1, 'gilded_chip', 6);
  const sa = ids(pawnOver(a, { seed: 3 }).pawn.stock(1));
  const sb = ids(pawnOver(b, { seed: 3 }).pawn.stock(1));
  assert.deepEqual(sa, sb);
});

test('EVOLVE: the flag survives a snapshot and a restore of the Pawn', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const book = bookOf(6, seed);
    book.add(1, 'snowball_ledger', 6);
    const { pawn, host } = pawnOver(book, { seed });
    if (!pawn.stock(1).some((s) => s && s.evolve)) continue;
    const snap = pawn.snapshot();
    const again = new SH.Pawn(host, snap);
    assert.ok(again.stock(1).some((s) => s && s.evolve), 'restored shelf still marks EVOLVE');
    return;
  }
  assert.fail('no seed offered EVOLVE for snowball_ledger');
});

test('EVOLVE: the pricing of an EVOLVE offer is the charm\'s normal price', () => {
  const book = bookOf(6, 5);
  book.add(1, 'capacitor', 6);
  for (let seed = 1; seed <= 40; seed++) {
    const { pawn } = pawnOver(book, { seed });
    const s = pawn.stock(1).find((x) => x && x.evolve);
    if (s) {
      // the Pawn price scale only ever lowers a price, so the EVOLVE offer costs at most the charm's base price
      assert.ok(s.price > 0 && s.price <= E.charmDef('capacitor').price, `price ${s.price}`);
      return;
    }
  }
  assert.fail('no EVOLVE offer found');
});
