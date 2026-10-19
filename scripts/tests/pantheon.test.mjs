// THE PANTHEON (docs/BLESSINGS.md §2, wave B1): the seeded boon offer (deterministic, three distinct gods, gated by Night), the
// tier shapes, Favour 0..3, Rites at Favour 3, at most two duos, Loki's swap, the payout cap on the best build, the save round-trip,
// and EN+TR strings for every god, boon, Rite and duo.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let P, RNG, STR;
before(async () => {
  P = await load('src/game/pantheon.ts');
  RNG = await load('src/core/rng.ts');
  STR = (await load('src/game/pantheon.strings.ts')).default;
});

const offer = (seed, night, ctx) => P.pantheonOffer(RNG.createRng(RNG.hashSeed('pantheon', seed, night)), night, ctx);
const god = (id) => P.boonDef(id).god;
const make = (seed = 7) => new P.Pantheon(seed, () => {});

test('data: 5 boons + 1 Rite per owner, 4 for Loki, 6 duos, every duo a distinct pair', () => {
  for (const g of P.OWNERS) {
    assert.equal(P.BOONS.filter((b) => b.god === g && b.kind === 'boon').length, 5, g);
    assert.equal(P.BOONS.filter((b) => b.god === g && b.kind === 'rite').length, 1, g);
  }
  assert.equal(P.BOONS.filter((b) => b.god === 'loki').length, 4);
  const duos = P.BOONS.filter((b) => b.kind === 'duo');
  assert.equal(duos.length, 6);
  assert.equal(new Set(duos.map((d) => [d.god, d.god2].sort().join('+'))).size, 6);
  assert.equal(new Set(P.BOONS.map((b) => b.id)).size, P.BOONS.length);
});

test('the seeded offer is deterministic and varies with the seed', () => {
  for (let night = 1; night <= 8; night++) assert.deepEqual(offer(11, night), offer(11, night));
  const seen = new Set();
  for (let seed = 1; seed <= 30; seed++) seen.add(offer(seed, 1).join());
  assert.ok(seen.size > 5, 'offers vary across seeds');
  const a = make(5); const b = make(5);
  a.open(1); b.open(1);
  assert.deepEqual(a.offerView().candidates.map((c) => c.id), b.offerView().candidates.map((c) => c.id));
});

test('three cards from three distinct gods, never Loki, never a kept boon', () => {
  for (let seed = 1; seed <= 150; seed++) {
    for (let night = 1; night <= 4; night++) {
      const ids = offer(seed, night);
      assert.equal(ids.length, 3);
      const gods = ids.map(god);
      assert.equal(new Set(gods).size, 3, `${seed}/${night}: ${ids}`);
      assert.ok(!gods.includes('loki'));
      assert.ok(ids.every((id) => P.boonDef(id).kind === 'boon'));
    }
  }
  const kept = ['well_penny', 'well_soft', 'well_warm'];
  for (let seed = 1; seed <= 50; seed++) assert.ok(offer(seed, 2, { kept }).every((id) => !kept.includes(id)));
});

test('night gating: first offer at Night 1, Mirrors from 4, Rites and duos from 5', () => {
  const p = make();
  assert.equal(p.open(0), false);
  assert.equal(p.open(1), true, 'first offer at Night 1 Dawn');
  assert.equal(p.open(1), false, 'one offer at a time');
  let mirrors4 = 0;
  for (let seed = 1; seed <= 80; seed++) {
    for (let night = 1; night <= 3; night++) assert.ok(!offer(seed, night).some((id) => god(id) === 'mirrors'));
    if (offer(seed, 4).some((id) => god(id) === 'mirrors')) mirrors4++;
  }
  assert.ok(mirrors4 > 0, 'the Mirrors join on Night 4');
  // Even with everything earned, nothing but plain boons before Night 5.
  const rich = ['well_penny', 'well_soft', 'well_warm', 'ledg_compound', 'ledg_count', 'ledg_double', 'ash_minute', 'ash_hand', 'ash_cold'];
  for (let seed = 1; seed <= 80; seed++) {
    assert.ok(offer(seed, 4, { kept: rich, tier: 'seal' }).every((id) => P.boonDef(id).kind === 'boon'));
  }
  // A Rite shows from Night 5 for a god at Favour 3, in every seed.
  for (let seed = 1; seed <= 80; seed++) assert.ok(offer(seed, 5, { kept: ['well_penny', 'well_soft', 'well_warm'] }).includes('well_answer'));
});

test('tiers: uncommon shows 4, golden shows 4 and keeps 2, seal shows a Rite or a duo', () => {
  assert.equal(offer(3, 2, { tier: 'uncommon' }).length, 4);
  const p = make();
  assert.ok(p.open(1, { tier: 'golden' }));
  const v = p.offerView();
  assert.equal(v.candidates.length, 4);
  assert.equal(v.picks, 2);
  assert.ok(p.pick(v.candidates[0].id));
  assert.ok(p.pending(), 'one pick left');
  assert.ok(p.pick(v.candidates[1].id));
  assert.ok(!p.pending());
  assert.equal(p.list().length, 2);
  // Seal tier: a Rite when a god is at Favour 3, a duo when none is.
  const wellThree = ['well_penny', 'well_soft', 'well_warm'];
  for (let seed = 1; seed <= 40; seed++) assert.ok(offer(seed, 5, { kept: wellThree, tier: 'seal' }).includes('well_answer'));
  const twoTwo = ['well_penny', 'well_soft', 'ledg_compound', 'ledg_count'];
  for (let seed = 1; seed <= 40; seed++) assert.ok(offer(seed, 5, { kept: twoTwo, tier: 'seal' }).includes('duo_wishcoin'));
});

test('Your Name Back is offered only while a seal is missing', () => {
  const k = ['mir_print', 'mir_back', 'mir_tell'];
  for (let seed = 1; seed <= 40; seed++) {
    assert.ok(!offer(seed, 5, { kept: k }).includes('mir_name'));
    assert.ok(offer(seed, 5, { kept: k, sealsMissing: true }).includes('mir_name'));
  }
});

test('Favour never passes 3', () => {
  const p = make();
  assert.equal(p.addFavour('ash'), 1);
  assert.equal(p.addFavour('ash', 9), 3);
  assert.equal(p.addFavour('ash'), 3);
  p.restore({ kept: ['ash_minute', 'ash_hand', 'ash_cold', 'ash_short', 'ash_lastcall'] });
  assert.equal(p.favour('ash'), 3);
  assert.equal(p.addFavour('loki'), 0, 'Loki has no Favour');
  assert.equal(P.favourOf('well', ['well_penny', 'well_soft', 'well_warm', 'well_wish', 'well_lamps'], 2), 3);
});

test('at most two duos, in the offer loop and on a hand-fed pick', () => {
  let duoPicked = 0;
  for (let seed = 1; seed <= 25; seed++) {
    const p = make(seed);
    for (let night = 1; night <= 30; night++) {
      if (!p.open(night, { tier: 'seal' })) continue;
      const v = p.offerView();
      assert.ok(v.candidates.filter((c) => c.kind === 'duo').length <= 1, 'one duo an offer');
      const duo = v.candidates.find((c) => c.kind === 'duo');
      p.pick((duo ?? v.candidates[0]).id);
      p.settle();
      assert.ok(p.duos() <= 2);
    }
    duoPicked += p.duos();
  }
  assert.ok(duoPicked > 0, 'the loop does take duos');
  const q = make();
  q.restore({ kept: ['duo_wishcoin', 'duo_moon', 'duo_latefee'] });
  assert.equal(q.duos(), 2, 'a save cannot smuggle a third duo');
});

test('the payout cap holds for the best build', () => {
  const best = ['ledg_double', 'loki_tip', 'duo_stillface'];
  const c = P.payoutCap(best);
  assert.ok(c.rawPayout > P.PAYOUT_CAP, 'the raw build is over the cap');
  assert.ok(c.payout * c.atDread <= P.PAYOUT_CAP + 1e-9);
  const p = make();
  p.restore({ kept: best });
  const out = [];
  p.collect({}, out);
  const prod = (hook) => out.flatMap((s) => s.effects).filter((f) => f.hook === hook).reduce((a, f) => a * f.value, 1);
  assert.ok(prod('payout.mult') <= P.PAYOUT_CAP + 1e-9, `payout ${prod('payout.mult')}`);
  assert.ok(prod('payout.mult') * prod('x.payout.atDread') <= P.PAYOUT_CAP + 1e-9);
  // An uncapped build adds no correcting source.
  p.restore({ kept: ['ledg_double'] });
  const out2 = [];
  p.collect({}, out2);
  assert.ok(!out2.some((s) => s.id === 'pantheon.cap'));
  // Every payout boon in the data, taken together, stays capped too.
  const ca = P.payoutCap(P.BOONS.map((b) => b.id));
  assert.ok(ca.payout * ca.atDread <= P.PAYOUT_CAP + 1e-9);
});

test("Loki's swap: Night 3+, once an offer, 1 Ink, free with Stolen Coat", () => {
  const early = make(); early.open(2);
  assert.equal(early.swap(0), null, 'not before Night 3');
  const p = make(); p.open(3);
  const was = p.offerView().candidates.map((c) => c.id);
  assert.equal(p.swap(1), P.LOKI_SWAP_INK);
  const now = p.offerView().candidates.map((c) => c.id);
  assert.equal(god(now[1]), 'loki');
  assert.equal(now[0], was[0]);
  assert.equal(now[2], was[2]);
  assert.equal(p.swap(0), null, 'once per offer');
  const q = make(9); q.restore({ kept: ['loki_coat'] }); q.open(3);
  assert.equal(q.swap(0), 0, 'Stolen Coat makes it free');
  assert.equal(make().swap(0), null, 'no offer, no swap');
});

test('a Rite that fires once stops counting after spend()', () => {
  const p = make();
  p.restore({ kept: ['mir_name', 'well_penny'] });
  assert.equal(p.fx('sealAdd'), 1);
  p.spend('mir_name');
  assert.equal(p.fx('sealAdd'), 0);
  p.spend('well_penny');
  assert.equal(p.has('well_penny'), true, 'a plain boon is never spent');
});

test('the timer takes the leftmost card, and an old Night Card save is dropped', () => {
  const p = make();
  p.open(1);
  const first = p.offerView().candidates[0].id;
  assert.equal(p.tick(5), null);
  assert.deepEqual(p.tick(P.OFFER_TIMEOUT_SEC), [first]);
  assert.deepEqual([...p.list()], [first]);
  p.restore({ offer: { night: 2, ids: ['rush_night'], picks: 1, left: 9, swapped: false }, kept: ['double_down'] });
  assert.equal(p.pending(), false);
  assert.equal(p.list().length, 0);
});

test('save round-trip keeps the offer, kept list, spent Rites, extra Favour and the Dawn guard', () => {
  const p = make(21);
  p.open(1);
  p.pick(p.offerView().candidates[0].id);
  p.open(2, { tier: 'golden' });
  p.tick(7);
  p.swap(0);
  p.addFavour('mirrors');
  p.restore({ ...p.snapshot(), kept: [...p.list(), 'ledg_books'], spent: ['ledg_books'] });
  const snap = JSON.parse(JSON.stringify(p.snapshot()));
  const q = make(21);
  q.restore(snap);
  assert.deepEqual(q.snapshot(), snap);
  assert.deepEqual(q.offerView().candidates.map((c) => c.id), p.offerView().candidates.map((c) => c.id));
  assert.equal(q.favour('mirrors'), 1);
  assert.equal(q.has('ledg_books'), false);
  assert.equal(q.open(2), false, 'a reload cannot reopen the same Dawn');
  assert.equal(make().snapshot(), null);
});

test('strings: EN and TR name + desc for every god, boon, Rite and duo, with matching keys', () => {
  assert.deepEqual(Object.keys(STR.en).sort(), Object.keys(STR.tr).sort());
  for (const b of P.BOONS) for (const part of ['name', 'desc']) {
    assert.ok(STR.en[`${b.id}.${part}`], `en ${b.id}.${part}`);
    assert.ok(STR.tr[`${b.id}.${part}`], `tr ${b.id}.${part}`);
  }
  for (const g of ['well', 'ledgers', 'ash', 'mirrors', 'loki']) for (const part of ['name', 'tag']) {
    assert.ok(STR.en[`god.${g}.${part}`] && STR.tr[`god.${g}.${part}`], `${g}.${part}`);
  }
});
