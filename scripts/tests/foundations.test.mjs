// Foundations (WAVE 7): the meta tree rules, the standalone prestige on a save, and the Pawn / sell hooks that the nodes
// and House Improvements feed. Each wired node is bought and the number it drives is read before and after.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let U, SH, R, E, FL, FS, RES;
before(async () => {
  U = await load('src/game/data/upgrades.ts');
  SH = await load('src/game/shop.ts');
  R = await load('src/core/rng.ts');
  E = await load('src/game/charms/engine.ts');
  FL = await load('src/menu/foundations.logic.ts');
  FS = await load('src/menu/foundations.strings.ts');
  RES = await load('src/menu/hud/results.strings.ts');
});

const fresh = (o = {}) => ({ obols: 0, spent: 0, nodes: {}, descents: 0, bestShift: 0, bestFloor: 0, unlocked: [], ...o });
/** A save with the one method the standalone prestige uses (update + flush), over a plain object. */
function saveOf(meta) {
  const data = { meta };
  return { data, update(fn) { fn(this.data); }, flush() {} };
}
const node = (id) => U.META_NODES.find((n) => n.id === id);

test('every Foundations node has a price for each level it can reach, and a unique id on its tree cell', () => {
  const ids = new Set();
  for (const n of U.META_NODES) {
    assert.equal(ids.has(n.id), false, `duplicate ${n.id}`);
    ids.add(n.id);
    assert.ok((n.cost.fixed ?? []).length >= n.maxLevel, `${n.id} needs ${n.maxLevel} prices`);
    assert.ok(n.pos[0] >= 0 && n.pos[0] <= 5, `${n.id} column`);
  }
});

test('H, L and T gate on meta.bestShift (Night 3, 5, 7), not on Descends; R needs a Night 8 win', () => {
  const rich = (o) => fresh({ obols: 1e9, ...o });
  // Descends alone no longer open the Hand.
  assert.equal(U.metaReqMissing(rich({ descents: 9 }), node('H1')), 'bestShift:2');
  assert.equal(U.metaBuyBlock(rich({ descents: 9, bestShift: 1 }), node('H1')), 'requires');
  assert.equal(U.metaBuyBlock(rich({ bestShift: 2 }), node('H1')), null);      // reached Night 3
  assert.equal(U.metaReqMissing(rich({ bestShift: 3 }), node('L1')), 'bestShift:4');
  assert.equal(U.metaBuyBlock(rich({ bestShift: 4 }), node('L1')), null);      // reached Night 5
  assert.equal(U.metaBuyBlock(rich({ bestShift: 5 }), node('T1')), 'requires');
  assert.equal(U.metaBuyBlock(rich({ bestShift: 6 }), node('T1')), null);      // reached Night 7
  // The Root: the five branch heads plus a recorded Night 8 win.
  const heads = { nodes: { V1: 1, F1: 1, H1: 1, L1: 1, T1: 1 } };
  assert.equal(U.metaReqMissing(rich({ ...heads, bestShift: 7 }), node('R1')), 'won:8');
  assert.equal(U.metaBuyBlock(rich({ ...heads, bestShift: 7, unlocked: ['won:8'] }), node('R1')), null);
});

test('a buy never takes Obols below zero and a refused buy changes nothing', () => {
  const save = saveOf(fresh({ obols: 4 }));
  const p = FL.createMetaPrestige(save);
  assert.equal(p.buyNode('V1'), false);                // V1 costs 5
  assert.equal(save.data.meta.obols, 4);
  assert.equal(save.data.meta.nodes.V1 ?? 0, 0);
  save.data.meta.obols = 5;
  assert.equal(p.buyNode('V1'), true);
  assert.equal(save.data.meta.obols, 0);
  assert.equal(save.data.meta.spent, 5);
});

test('buying V1 and V2 changes the start pocket and the start tickets', () => {
  const save = saveOf(fresh({ obols: 100 }));
  const p = FL.createMetaPrestige(save);
  assert.equal(U.foldMeta(save.data.meta, 'x.start.pocket', 0), 0);
  assert.equal(p.buyNode('V1'), true);
  assert.equal(U.foldMeta(save.data.meta, 'x.start.pocket', 0), 10);
  assert.equal(p.buyNode('V1'), true);                 // level 2 costs the second price (10)
  assert.equal(U.foldMeta(save.data.meta, 'x.start.pocket', 0), 20);
  assert.equal(save.data.meta.obols, 100 - 5 - 10);
  assert.equal(U.foldMeta(save.data.meta, 'x.start.tickets', 0), 0);
  assert.equal(p.buyNode('V2'), true);
  assert.equal(U.foldMeta(save.data.meta, 'x.start.tickets', 0), 1);
});

test('the standalone prestige lists the tree, reports its state as a copy and never descends', async () => {
  const save = saveOf(fresh({ obols: 3 }));
  const p = FL.createMetaPrestige(save);
  assert.equal(p.nodes().length, U.META_NODES.length);
  const copy = p.state();
  copy.obols = 999;
  assert.equal(save.data.meta.obols, 3);
  await p.descend();
  assert.equal(save.data.meta.descents, 0);
});

test('V6 Pawnbroker\'s Friend: charms sell back at 60 % (70 % with a Pawn Ticket stays 70 %)', () => {
  const save = saveOf(fresh({ obols: 100 }));
  assert.equal(SH.sellRefund(100, U.foldMeta(save.data.meta, 'x.charm.sellValue', 0.5), false), 50);
  assert.equal(FL.createMetaPrestige(save).buyNode('V6'), true);
  const frac = U.foldMeta(save.data.meta, 'x.charm.sellValue', 0.5);
  assert.equal(SH.sellRefund(100, frac, false), 60);
  assert.equal(SH.sellRefund(100, frac, true), 70);
  assert.equal(SH.sellRefund(0, frac, false), 0);
  assert.equal(SH.sellRefund(100, 0.99, false), 90);   // the cap
});

test('the Pawn hooks: a fake host with the Pawn bell, the golden ticket and the second window', () => {
  const pawnOf = (meta, levels = {}, tickets = 20) => {
    const h = { tix: tickets, coins: 10000, free: 0, held: [] };
    const rng = R.createRng(42);
    const host = {
      selfId: 1,
      rng: () => rng, night: () => 3, watch: () => 0, open: () => true, si: () => 1,
      held: () => h.held, canTake: (id) => !h.held.includes(id), pegsFree: () => 9 - h.held.length,
      wallet: () => h.coins, tickets: () => h.tix,
      spendTickets: (n) => { if (h.tix < n) return false; h.tix -= n; return true; },
      freeRerolls: () => h.free, useFreeReroll: () => { if (h.free <= 0) return false; h.free -= 1; return true; },
      buyCharm: () => true, sellCharm: () => true, sellValue: () => 0, removeCurse: () => true,
      bias: () => false, meta: () => false, mostPlayed: () => null,
      mod: (hook, base) => U.foldHouse(levels, hook, U.foldMeta(meta, hook, base)),
    };
    return { h, p: new SH.Pawn(host) };
  };

  // Golden Ticket (T5): the first reroll of a visit is free, the next one costs a ticket.
  const save = saveOf(fresh({ obols: 100 }));
  let w = pawnOf(save.data.meta, {}, 5);
  w.p.stock(1);
  assert.equal(w.p.rerollCost(), 1);
  assert.equal(FL.createMetaPrestige(save).buyNode('T5') === false, true, 'T5 needs Night 7');
  save.data.meta.bestShift = 6;
  assert.equal(FL.createMetaPrestige(save).buyNode('T5'), true);
  w = pawnOf(save.data.meta, {}, 5);
  w.p.stock(1);
  assert.equal(w.p.rerollCost(), 0);
  assert.equal(w.p.reroll(), true);
  assert.equal(w.h.tix, 5);                       // the free one spent no ticket
  assert.equal(w.p.rerollCost(), 1);
  assert.equal(w.p.reroll(), true);
  assert.equal(w.h.tix, 4);

  // Pawn Bell (house improvement, +1 free reroll per visit per level): rerolls are free up to the count.
  const bell = pawnOf(fresh(), { 'upg.global.imp_pawn_bell': 2 }, 5);
  bell.p.stock(1);
  assert.equal(bell.p.freeRerolls(), 2);
  assert.equal(bell.p.reroll(), true);
  assert.equal(bell.p.freeRerolls(), 1);
  assert.equal(bell.p.reroll(), true);
  assert.equal(bell.p.freeRerolls(), 0);
  assert.equal(bell.h.tix, 5, 'the bell rerolls cost no tickets');
  assert.equal(bell.p.reroll(), true);
  assert.equal(bell.h.tix, 4);

  // Second Window (house improvement, +1 regular shelf per level): the stock grows from four to five.
  const win = pawnOf(fresh(), {});
  assert.equal(win.p.stock(1).length, 4);
  const win2 = pawnOf(fresh(), { 'upg.global.imp_second_window': 1 });
  const stock = win2.p.stock(1);
  assert.equal(stock.length, 5);
  assert.ok(stock[4] !== null, 'the new shelf is stocked');
});

test('the Pawn snapshot keeps the bell count and the spent Golden Ticket across a reload', () => {
  const meta = fresh({ bestShift: 6, nodes: { T5: 1 } });
  const make = (levels = { 'upg.global.imp_pawn_bell': 1 }) => {
    const rng = R.createRng(7);
    const host = {
      selfId: 1, rng: () => rng, night: () => 3, watch: () => 0, open: () => true, si: () => 1,
      held: () => [], canTake: () => true, pegsFree: () => 9, wallet: () => 1000, tickets: () => 9,
      spendTickets: () => true, freeRerolls: () => 0, useFreeReroll: () => false, buyCharm: () => true,
      sellCharm: () => true, sellValue: () => 0, removeCurse: () => true, bias: () => false, meta: () => false,
      mostPlayed: () => null, mod: (hook, base) => U.foldHouse(levels, hook, U.foldMeta(meta, hook, base)),
    };
    return new SH.Pawn(host);
  };
  const a = make();
  a.stock(1);
  a.reroll();
  const snap = JSON.parse(JSON.stringify(a.snapshot()));
  const b = make();
  b.restore(snap);
  assert.equal(b.freeRerolls(), a.freeRerolls());
  assert.equal(b.freeRerolls(), 1);                  // the Pawn Bell has one left
  assert.equal(b.rerollCost(), 0);
});

test('a house-bought shelf reaches a Pawn that is already open, and the four launch shelves are unchanged', () => {
  const levels = {};
  const meta = fresh();
  const rng = R.createRng(9);
  const host = {
    selfId: 1, rng: () => rng, night: () => 3, watch: () => 0, open: () => true, si: () => 1,
    held: () => [], canTake: () => true, pegsFree: () => 9, wallet: () => 1000, tickets: () => 9,
    spendTickets: () => true, freeRerolls: () => 0, useFreeReroll: () => false, buyCharm: () => true,
    sellCharm: () => true, sellValue: () => 0, removeCurse: () => true, bias: () => false, meta: () => false,
    mostPlayed: () => null, mod: (hook, base) => U.foldHouse(levels, hook, U.foldMeta(meta, hook, base)),
  };
  const p = new SH.Pawn(host);
  assert.equal(p.stock(1).length, 4);
  levels['upg.global.imp_second_window'] = 2;
  assert.equal(p.stock(1).length, 6);
  assert.equal(p.slotCount(), 6);
  assert.equal(SH.SLOT_EXTRA_MAX, 2);
});

test('House Improvement levels fold through their own curves (pit-wide, by template id)', () => {
  assert.equal(U.foldHouse({}, 'x.pawn.freeRerolls', 0), 0);
  assert.equal(U.foldHouse({ 'upg.global.imp_pawn_bell': 3 }, 'x.pawn.freeRerolls', 0), 3);
  assert.equal(U.foldHouse({ 'upg.global.imp_second_window': 2 }, 'x.pawn.slots', 0), 2);
});

test('the receipt labels rescue loans in both languages, and the Foundations strings mirror en in tr', () => {
  const en = RES.default.en, tr = RES.default.tr;
  assert.ok(en['stat.rescue.loans'] && tr['stat.rescue.loans']);
  assert.notEqual(en['stat.rescue.loans'], 'rescue.loans');
  const keys = (o) => Object.keys(o).sort().join('|');
  assert.equal(keys(FS.default.en), keys(FS.default.tr));
});
