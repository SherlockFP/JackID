// Unit tests for the Pawn Window stock keeper (src/game/shop.ts, Wave 8 items 2 and 7) against a fake PawnHost.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let SH, R, E, CD;
before(async () => {
  SH = await load('src/game/shop.ts');
  R = await load('src/core/rng.ts');
  E = await load('src/game/charms/engine.ts');
  CD = await load('src/game/data/charms.ts');
});

/** A fake run: the Pawn only sees `host`; the tests poke the shared fixture state `h`. */
function pawnOf(o = {}) {
  const h = {
    nightIdx: o.night ?? 3, watchIdx: o.watch ?? 0, isOpen: true, si: o.si ?? 1,
    heldIds: [...(o.held ?? [])], coins: o.coins ?? 1000, tix: o.tickets ?? 20, free: o.free ?? 0, pegs: o.pegs ?? 9,
    biasOn: o.bias ?? true, machine: o.machine ?? null,
  };
  const metaOn = o.meta ?? false;
  const rng = R.createRng(o.seed ?? 1234);
  const price = (id) => Math.round(E.charmDef(id).price * h.si);
  const host = {
    selfId: 1,
    rng: () => rng, night: () => h.nightIdx, watch: () => h.watchIdx, open: () => h.isOpen, si: () => h.si,
    held: () => h.heldIds, canTake: (id) => !h.heldIds.includes(id), pegsFree: () => h.pegs - h.heldIds.length,
    wallet: () => h.coins, tickets: () => h.tix,
    spendTickets: (n) => { if (h.tix < n) return false; h.tix -= n; return true; },
    freeRerolls: () => h.free, useFreeReroll: () => { if (h.free <= 0) return false; h.free -= 1; return true; },
    buyCharm: (id, p) => {
      if (p > 0 && h.coins < p) return false;
      if (h.heldIds.length >= h.pegs) return false;
      h.coins -= p; h.heldIds.push(id); return true;
    },
    sellCharm: (id) => { const i = h.heldIds.indexOf(id); if (i < 0) return false; h.heldIds.splice(i, 1); h.coins += Math.floor(price(id) / 2); return true; },
    sellValue: (id) => (E.charmDef(id)?.rarity === 'cursed' ? 0 : Math.floor(price(id) / 2)),
    removeCurse: (id) => { const i = h.heldIds.indexOf(id); if (i < 0) return false; h.heldIds.splice(i, 1); return true; },
    bias: () => h.biasOn,
    meta: () => metaOn,
    mostPlayed: () => h.machine,
  };
  return { h, host, p: new SH.Pawn(host) };
}
const ids = (stock) => stock.map((s) => (s ? s.charmId : null));

test('stock is deterministic per seed and differs between seeds', () => {
  const a = pawnOf({ seed: 77 }), b = pawnOf({ seed: 77 }), c = pawnOf({ seed: 78 });
  assert.deepEqual(ids(a.p.stock(1)), ids(b.p.stock(1)));
  assert.notDeepEqual(ids(a.p.stock(1)), ids(c.p.stock(1)));
  assert.equal(a.p.stock(1).length, 4);
});

test('stock is drawn once per intermission: repeated reads never change it', () => {
  const { p } = pawnOf();
  const first = ids(p.stock(1));
  for (let i = 0; i < 5; i++) assert.deepEqual(ids(p.stock(1)), first);
});

test('closed window: no stock, no actions', () => {
  const { h, p } = pawnOf();
  h.isOpen = false;
  assert.deepEqual(p.stock(1), []);
  assert.equal(p.buy(1, 0).ok, false);
  assert.equal(p.reroll(), false);
});

test('buying does not reshuffle: the other slots are untouched, the bought slot goes empty', () => {
  const { h, p } = pawnOf({ coins: 100000 });
  const before = ids(p.stock(1));
  const i = before.findIndex((x, k) => x && k < 3);
  const r = p.buy(1, i);
  assert.deepEqual(r, { ok: true, why: '' });
  assert.ok(h.heldIds.includes(before[i]));
  const after = ids(p.stock(1));
  for (let k = 0; k < 4; k++) assert.equal(after[k], k === i ? null : before[k]);
  assert.equal(p.buy(1, i).ok, false, 'a sold slot cannot be bought twice');
});

test('buying with too few coins is refused and changes nothing', () => {
  const { h, p } = pawnOf({ coins: 0 });
  const st = p.stock(1);
  const i = st.findIndex((s) => s && s.price > 0);
  assert.equal(p.buy(1, i).why, 'funds');
  assert.equal(h.heldIds.length, 0);
  assert.deepEqual(ids(p.stock(1)), ids(st));
});

test('reroll replaces only unlocked, unsold slots and never repeats a replaced charm', () => {
  const { p } = pawnOf({ coins: 100000, tickets: 50 });
  const s0 = p.stock(1);
  p.buy(1, 1);                       // slot 1 sold
  assert.equal(p.lock(0), true);     // slot 0 locked
  const mid = ids(p.stock(1));
  assert.equal(p.reroll(), true);
  const s1 = p.stock(1);
  assert.equal(s1[0].charmId, s0[0].charmId, 'locked slot kept');
  assert.equal(s1[0].locked, true);
  assert.equal(s1[1], null, 'sold slot stays empty');
  for (const k of [2, 3]) if (s1[k]) assert.notEqual(s1[k].charmId, mid[k], 'a replaced charm is not handed back');
});

test('reroll cost: free rerolls first, then 1 Ticket, +1 each time', () => {
  const { h, p } = pawnOf({ tickets: 20, free: 2 });
  assert.equal(p.rerollCost(), 0);
  assert.equal(p.reroll(), true); assert.equal(h.free, 1); assert.equal(h.tix, 20);
  assert.equal(p.reroll(), true); assert.equal(h.free, 0); assert.equal(h.tix, 20);
  assert.equal(p.rerollCost(), 1);
  assert.equal(p.reroll(), true); assert.equal(h.tix, 19);
  assert.equal(p.rerollCost(), 2);
  assert.equal(p.reroll(), true); assert.equal(h.tix, 17);
  assert.equal(p.rerollCost(), 3);
});

test('reroll with no Tickets is refused and the stock stays', () => {
  const { p } = pawnOf({ tickets: 0 });
  const before = ids(p.stock(1));
  assert.equal(p.reroll(), false);
  assert.deepEqual(ids(p.stock(1)), before);
});

test('reroll streams are deterministic per seed', () => {
  const a = pawnOf({ seed: 5, tickets: 9 }), b = pawnOf({ seed: 5, tickets: 9 });
  a.p.stock(1); b.p.stock(1);
  a.p.reroll(); b.p.reroll(); a.p.reroll(); b.p.reroll();
  assert.deepEqual(ids(a.p.stock(1)), ids(b.p.stock(1)));
});

test('lock costs 1 Ticket, persists through rerolls and into the next intermission, max 2', () => {
  const { h, p } = pawnOf({ tickets: 10, coins: 100000 });
  const first = ids(p.stock(1));
  assert.equal(p.lock(0), true);
  assert.equal(h.tix, 9);
  assert.equal(p.lock(0), false, 'already locked');
  assert.equal(p.lock(1), true);
  assert.equal(p.lock(2), false, 'third lock refused');
  assert.equal(h.tix, 8);
  p.reroll();
  assert.equal(h.tix, 7);
  assert.equal(p.stock(1)[0].charmId, first[0]);
  assert.equal(p.stock(1)[1].charmId, first[1]);
  // next intermission: same two shelves, still locked, the rest is new
  h.watchIdx += 1;
  const next = p.stock(1);
  assert.equal(next[0].charmId, first[0]); assert.equal(next[0].locked, true);
  assert.equal(next[1].charmId, first[1]); assert.equal(next[1].locked, true);
  // and it survives a Night change too
  h.nightIdx += 1; h.watchIdx = 0;
  assert.equal(p.stock(1)[0].charmId, first[0]);
  // unlock is free; an unlocked shelf is redrawn at the next intermission
  assert.equal(p.unlock(0), true);
  assert.equal(h.tix, 7);
  assert.equal(p.stock(1)[0].locked, false);
});

test('a locked charm that was bought leaves its shelf and the lock does not carry', () => {
  const { h, p } = pawnOf({ tickets: 10, coins: 100000 });
  const first = ids(p.stock(1));
  p.lock(0);
  assert.equal(p.buy(1, 0).ok, true);
  h.watchIdx += 1;
  const next = p.stock(1);
  assert.notEqual(next[0]?.charmId, first[0]);
  assert.notEqual(next[0]?.locked, true);
});

test('under-the-counter slot: absent on Night 1, then Rare/Legendary or Cursed (an Uncommon when none is unlocked)', () => {
  assert.equal(pawnOf({ night: 0 }).p.stock(1)[3], null);
  // Early Night, nothing rare unlocked: never an empty counter, never a Common.
  for (let seed = 1; seed <= 50; seed++) {
    const s = pawnOf({ night: 1, seed }).p.stock(1)[3];
    assert.ok(s, `seed ${seed}: an under-the-counter item`);
    assert.equal(s.underCounter, true);
    assert.notEqual(s.rarity, 'common');
  }
  // Late Night with the meta unlocks earned: both kinds appear, about 50 / 50.
  let cursed = 0, high = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const s = pawnOf({ night: 6, seed, meta: true }).p.stock(1)[3];
    assert.ok(s, `seed ${seed}: an under-the-counter item`);
    if (s.cursed) { cursed++; assert.ok(s.price < 0, 'cursed pays a sign-on fee'); }
    else { high++; assert.ok(s.rarity === 'rare' || s.rarity === 'legendary'); }
  }
  assert.ok(cursed > 40 && cursed < 160, `cursed share ${cursed}/200`);
  assert.ok(high > 40, `rare share ${high}/200`);
});

test('cursed charms need their meta unlock: off the shelf without it', () => {
  for (let seed = 1; seed <= 100; seed++) {
    for (const s of pawnOf({ night: 6, seed }).p.stock(1)) if (s) assert.equal(s.cursed, false);
  }
});

test('no duplicate charm on one shelf set, and nothing already owned', () => {
  const owned = ['brass_thimble', 'hot_coal', 'wax_seal'];
  for (let seed = 1; seed <= 100; seed++) {
    const { p } = pawnOf({ seed, held: owned });
    const got = ids(p.stock(1)).filter(Boolean);
    assert.equal(new Set(got).size, got.length, `seed ${seed}: unique`);
    for (const id of got) assert.ok(!owned.includes(id), `seed ${seed}: ${id} is owned`);
  }
});

test('only launch charms, never above the Night gate', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const { p } = pawnOf({ seed, night: 0 });
    for (const s of p.stock(1)) {
      if (!s) continue;
      assert.ok(CD.LAUNCH_CHARM_IDS.has(s.charmId));
      const u = E.charmDef(s.charmId).unlock ?? '';
      assert.ok(u === '' || (/^N(\d+)$/.test(u) && Number(u.slice(1)) <= 1), `${s.charmId} unlock ${u}`);
    }
  }
});

test('shelf bias: slot 0 leans x3 toward the key you hold most', () => {
  // Hold REELS charms; slot 0 should be REELS far more often than slot 1 (plain), and more than with bias off.
  const held = ['brass_thimble'];
  const key = SH.dominantKey(held.map((id) => E.charmDef(id)));
  assert.equal(key, 'reels');
  let on = 0, off = 0, plain = 0;
  const N = 600;
  for (let seed = 1; seed <= N; seed++) {
    const a = pawnOf({ seed, night: 3, held, bias: true }).p.stock(1);
    const b = pawnOf({ seed, night: 3, held, bias: false }).p.stock(1);
    const has = (s) => s && SH.defKeys(E.charmDef(s.charmId)).includes('reels');
    if (has(a[0])) on++;
    if (has(b[0])) off++;
    if (has(a[1])) plain++;
  }
  assert.ok(on > off * 1.3, `bias on ${on} vs off ${off}`);
  assert.ok(on > plain * 1.3, `biased slot ${on} vs plain slot ${plain}`);
});

test('dominantKey: most-held wins, ties go alphabetical, nothing held is null', () => {
  assert.equal(SH.dominantKey([]), null);
  assert.equal(SH.dominantKey([{ tag: 'DICE' }, { tag: 'CARDS' }, { tag: 'DICE' }]), 'dice');
  assert.equal(SH.dominantKey([{ tag: 'DICE' }, { tag: 'CARDS' }]), 'cards');
  assert.equal(SH.dominantKey([{ tag: 'REELS', tags: ['hot'] }, { tags: ['hot'] }]), 'hot');
});

test('FIT n: held charms sharing a key, +1 for the most-played machine', () => {
  const thimble = E.charmDef('brass_thimble');
  const heldReels = [E.charmDef('brass_thimble'), { id: 'x1', tag: 'REELS' }, { id: 'x2', tag: 'DICE' }];
  assert.equal(SH.fitOf(thimble, heldReels, null), 1, 'itself does not count, one other REELS charm does');
  const m = { machineId: 'bandit', tags: ['reels'] };
  assert.equal(SH.fitOf(thimble, heldReels, m), 2, 'it also boosts the main machine');
  assert.equal(SH.fitOf(thimble, heldReels, { machineId: 'plinko', tags: ['drops'] }), 1);
  assert.equal(SH.fitOf(thimble, [], null), 0);
});

test('stock carries fit, bias and slot flags', () => {
  const { p } = pawnOf({ night: 3, held: ['brass_thimble', 'hot_coal'] });
  const st = p.stock(1);
  assert.equal(st[0].bias, true);
  assert.equal(st[3].underCounter, true);
  for (const s of st) if (s) assert.ok(Number.isInteger(s.fit) && s.fit >= 0);
});

test('payout preview folds the new charm into the current breakdown', () => {
  const thimble = E.charmDef('brass_thimble');
  const bd = { hook: 'payout.mult', machineId: 'bandit', base: 1, result: 1.2, clamped: false,
    steps: [{ source: { kind: 'charm', id: 'x', owner: 1 }, op: 'inc', value: 0.2, stacks: 1, before: 1, after: 1.2 }] };
  const m = { machineId: 'bandit', tags: ['reels'] };
  const r = SH.previewPayout(bd, thimble, m, 0);
  assert.ok(r && Math.abs(r.from - 1.2) < 1e-9);
  assert.ok(r.to > r.from, `${r.from} -> ${r.to}`);
  assert.equal(SH.previewPayout(bd, thimble, { machineId: 'plinko', tags: ['drops'] }, 0), null, 'scope must reach the machine');
});

test('swap on full pegs: asks first, sells the replaced charm back at 50%, then buys', () => {
  const held = ['brass_thimble', 'billiard_chalk'];
  const { h, p } = pawnOf({ held, pegs: 2, coins: 100000 });
  const i = p.stock(1).findIndex((s) => s && !s.cursed && s.price > 0);
  assert.equal(p.needsSwap(1, i), true);
  assert.equal(p.buy(1, i).why, 'swap');
  assert.deepEqual(h.heldIds, held, 'nothing changed');
  const choices = p.swapChoices(1, i);
  assert.deepEqual(choices.map((c) => c.id).sort(), [...held].sort());
  assert.ok(choices.every((c) => c.refund === Math.floor(E.charmDef(c.id).price * h.si / 2)));
  const bought = p.stock(1)[i].charmId;
  const coins0 = h.coins, price = p.stock(1)[i].price, refund = choices.find((c) => c.id === 'brass_thimble').refund;
  assert.deepEqual(p.buy(1, i, 'brass_thimble'), { ok: true, why: '' });
  assert.deepEqual([...h.heldIds].sort(), ['billiard_chalk', bought].sort());
  assert.equal(h.coins, coins0 + refund - price);
  assert.equal(p.stock(1)[i], null);
  assert.equal(p.buy(1, i, 'x').ok, false);
});

test('swap: the sellback counts toward affordability, a bogus or cursed replaceId is refused', () => {
  const held = ['brass_thimble', 'billiard_chalk'];
  const { h, p } = pawnOf({ held, pegs: 2, coins: 0, night: 3 });
  const i = p.stock(1).findIndex((s) => s && !s.cursed && s.price > 0);
  assert.equal(p.buy(1, i, 'brass_thimble').why, 'funds', 'refund alone does not cover it');
  assert.equal(p.buy(1, i, 'not_a_charm').why, 'limit');
  assert.deepEqual(h.heldIds, held);
  h.coins = p.stock(1)[i].price;       // enough on its own
  assert.equal(p.buy(1, i, 'brass_thimble').ok, true);
});

test('no swap when a peg is free or the charm is already held (stack)', () => {
  const { p } = pawnOf({ held: ['brass_thimble'], pegs: 3 });
  assert.equal(p.needsSwap(1, 0), false);
});

test('cursed charms are not swap choices; remove curse costs 5 Tickets and removes it', () => {
  const held = ['wet_ledger', 'brass_thimble'];
  const { h, p } = pawnOf({ held, pegs: 2, tickets: 6 });
  assert.deepEqual(p.swapChoices(1, 0).map((c) => c.id), ['brass_thimble']);
  assert.deepEqual(p.cursedOwned(1), ['wet_ledger']);
  assert.equal(p.removeCurse('brass_thimble'), false, 'not cursed');
  assert.equal(p.removeCurse('wet_ledger'), true);
  assert.equal(h.tix, 1);
  assert.deepEqual(h.heldIds, ['brass_thimble']);
  assert.equal(p.removeCurse('wet_ledger'), false);
});

test('discounts: shop.discount trims every positive price, discountSlot only slot 2, cursed pay stays', () => {
  const plain = pawnOf({ night: 4, seed: 9 });
  const base = plain.p.stock(1);
  const d = pawnOf({ night: 4, seed: 9 });
  d.host.discount = () => 0.25;
  d.host.discountSlot = () => 0.5;
  const got = d.p.stock(1);
  for (let k = 0; k < 4; k++) {
    if (!base[k]) continue;
    assert.equal(got[k].charmId, base[k].charmId);
    if (base[k].price <= 0) { assert.equal(got[k].price, base[k].price); continue; }
    const f = k === 2 ? 0.75 * 0.5 : 0.75;
    assert.equal(got[k].price, Math.max(1, Math.round(base[k].price * f)));
    assert.equal(got[k].discounted, true);
  }
});

test('snapshot / restore: same stock, same locks, no redraw, no reroll refund', () => {
  const a = pawnOf({ seed: 31, tickets: 10, coins: 100000 });
  a.p.stock(1);
  a.p.lock(2);
  a.p.reroll();
  a.p.buy(1, 0);
  const snap = JSON.parse(JSON.stringify(a.p.snapshot()));
  const b = pawnOf({ seed: 31, tickets: 10, coins: 100000 });
  b.h.heldIds = [...a.h.heldIds];
  b.p.restore(snap);
  assert.deepEqual(b.p.stock(1), a.p.stock(1));
  assert.equal(b.p.rerollCost(), a.p.rerollCost());
  assert.deepEqual(b.p.snapshot(), snap);
  // a reroll after loading draws the same stream a continuous session would
  a.p.reroll(); b.p.reroll();
  assert.deepEqual(ids(b.p.stock(1)), ids(a.p.stock(1)));
});

test('restore ignores junk', () => {
  const { p } = pawnOf();
  p.restore(null);
  p.restore({ v: 9 });
  p.restore({ v: 1, key: 5, slots: [{ id: 'nope', locked: true }, null, null, null], rolls: -3, paid: 'x' });
  assert.equal(p.stock(1).length, 4);
});

test('a charm acquired elsewhere disappears from the shelf instead of failing at the counter', () => {
  const { h, p } = pawnOf();
  const st = p.stock(1);
  const id = st[0].charmId;
  h.heldIds.push(id);
  assert.equal(p.stock(1)[0], null);
});

test('canReroll is false when every slot is locked or sold', () => {
  const { p } = pawnOf({ night: 0, tickets: 9, coins: 100000 });
  const st = p.stock(1);
  const live = st.map((s, i) => (s ? i : -1)).filter((i) => i >= 0);
  assert.equal(p.canReroll(), true);
  live.slice(0, 2).forEach((i) => p.lock(i));
  live.slice(2).forEach((i) => p.buy(1, i));
  assert.equal(p.canReroll(), false);
  assert.equal(p.reroll(), false);
});

// ── Wave 20: Pawn prices scale to the run (price = def.price × SI × pawnPriceScale(night)) ─────────────────
let SCH;
before(async () => { SCH = await load('src/game/data/schedule.ts'); });

test('pawn prices scale to the quota: the cheapest charm is ~35 % of it, the dearest Common ~60 %, on every Night', () => {
  const rows = [];
  for (let night = 0; night < SCH.BASE_RUN_NIGHTS; night++) {
    const nd = SCH.nightDef(night);
    let cheapest = Infinity, commonTop = 0, rareTop = 0;
    for (let seed = 1; seed <= 120; seed++) {
      const { p } = pawnOf({ seed, night, si: nd.si, meta: true, held: [] });
      for (const s of p.stock(1)) {
        if (!s || s.cursed || s.price <= 0) continue;
        cheapest = Math.min(cheapest, s.price);
        if (s.rarity === 'common') commonTop = Math.max(commonTop, s.price);
        if (s.rarity === 'rare' || s.rarity === 'legendary') rareTop = Math.max(rareTop, s.price);
      }
    }
    rows.push({ night: night + 1, quota: nd.base, cheapest, commonTop, rareTop });
    // charmPrice rounds to two significant digits (up to +5 %), so the shares carry that much slack.
    assert.ok(cheapest <= 0.35 * nd.base * 1.05, `N${night + 1}: cheapest ${cheapest} vs quota ${nd.base}`);
    assert.ok(commonTop <= 0.6 * nd.base * 1.05, `N${night + 1}: dearest Common ${commonTop} vs quota ${nd.base}`);
  }
  console.log(JSON.stringify(rows));
});

test('pawn prices never rise above the stake price: the scale only lowers them', () => {
  for (let night = 0; night < SCH.BASE_RUN_NIGHTS; night++) {
    const si = SCH.nightDef(night).si;
    const { p } = pawnOf({ seed: 9, night, si, meta: true });
    for (const s of p.stock(1)) if (s && s.price > 0) assert.ok(s.price <= Math.round(E.charmDef(s.charmId).price * si) + 1, `${s.charmId} at N${night + 1}`);
  }
});

test('pawnPriceScale is 1 while the stake is low, and falls as the quota outgrows the stake', () => {
  assert.equal(SCH.pawnPriceScale(0, 1, 12), 1);
  assert.ok(SCH.pawnPriceScale(1, 3, 12) < 1, 'N2 at SI 3: the dearest Common would cost 36 of a 58 quota, so it is scaled');
  assert.ok(SCH.pawnPriceScale(3, 30, 12) < SCH.pawnPriceScale(2, 10, 12), 'later Nights cost less of their stake');
  assert.ok(SCH.pawnPriceScale(3, 30, 12) <= 1);
});
