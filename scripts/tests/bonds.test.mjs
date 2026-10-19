// BONDS (docs/STORY_BIBLE.md §10, src/game/bonds.ts): the 0..3 clamp, one pip per character per Night, a rival beaten clean and a win on
// Loki's hand, neglect, betrayal, Selim's seal loan and his forgetting, what each level unlocks, "bonds never gate an ending", the save
// round trip, and EN+TR strings for every line the module can return.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let B, RNG, STR;
before(async () => {
  B = await load('src/game/bonds.ts');
  RNG = await load('src/core/rng.ts');
  STR = (await load('src/game/bonds.strings.ts')).default;
});

const make = (seed = 7) => new B.Bonds(seed);
const ev = (b, night, kind, who) => b.apply(night, { kind, who });
const dawn = (b, night) => b.apply(night, { kind: 'dawn' });
const lvls = (b) => B.BOND_IDS.map((w) => b.level(w));
const RAISE = ['help', 'word', 'share', 'show', 'defend'];

test('values start at Selim 1, the rest 0, and stay inside 0..3', () => {
  const b = make();
  assert.deepEqual(lvls(b), [1, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual([B.clampBond(-4), B.clampBond(NaN), B.clampBond(9), B.clampBond(2.9)], [0, 0, 3, 2]);
  for (let night = 1; night <= 8; night++) {
    for (const w of B.BOND_IDS) { ev(b, night, 'help', w); assert.ok(b.level(w) <= 3); }
  }
  assert.deepEqual(lvls(b), [3, 3, 3, 3, 3, 3, 3]);
  assert.equal(ev(b, 9, 'share', 'selim').deltas.length, 0, 'at the cap a raise changes nothing');
  const z = make();
  for (let night = 1; night <= 12; night++) dawn(z, night);
  assert.deepEqual(lvls(z), [0, 0, 0, 0, 0, 0, 0], 'neglect stops at 0');
});

test('help, a kept word, a share, showing up and defending each raise a pip, once per character per Night', () => {
  for (const kind of RAISE) {
    const b = make();
    assert.deepEqual(ev(b, 2, kind, 'mira').deltas, [{ who: 'mira', from: 0, to: 1, why: kind, line: 'bonds.mira.up' }], kind);
    assert.equal(ev(b, 2, 'help', 'mira').deltas.length, 0, 'a second one the same Night is only a touch');
    assert.equal(ev(b, 2, 'help', 'tamsin').deltas.length, 1, 'another character the same Night still rises');
    assert.equal(ev(b, 3, kind, 'mira').deltas[0].to, 2, 'the next Night it rises again');
  }
});

test('a rival beaten clean starts at 1; a win on Loki\'s hand sets them to 0 without a betrayal; friends are not rivals', () => {
  const b = make();
  assert.equal(ev(b, 3, 'clean', 'lucan').deltas[0].to, 1);
  ev(b, 4, 'help', 'lucan');
  assert.equal(ev(b, 4, 'clean', 'lucan').deltas.length, 0, 'clean never lowers or doubles a pip');
  assert.equal(b.level('lucan'), 2);
  const l = ev(b, 5, 'loki', 'lucan');
  assert.deepEqual(l.deltas, [{ who: 'lucan', from: 2, to: 0, why: 'loki', line: 'bonds.lucan.loki' }]);
  assert.deepEqual(b.against(), [], 'a Loki win is not a betrayal');
  assert.equal(ev(b, 6, 'help', 'lucan').deltas[0].to, 1, 'it can be earned back');
  assert.equal(ev(b, 3, 'loki', 'selim').deltas.length + ev(b, 3, 'clean', 'mira').deltas.length, 0, 'only rivals');
  assert.equal(b.level('selim'), 1);
  assert.equal(b.level('mira'), 0);
  // "let it go" (Night 6, Selim): one pip, no betrayal, never below 0
  assert.deepEqual(ev(b, 6, 'drop', 'selim').deltas, [{ who: 'selim', from: 1, to: 0, why: 'drop', line: 'bonds.selim.down' }]);
  assert.equal(ev(b, 6, 'drop', 'selim').deltas.length, 0);
  assert.deepEqual(b.against(), []);
  assert.equal(B.bondOfRival('orrin'), 'collector');
  assert.deepEqual(['tamsin', 'lucan', 'mimosa', 'vell', 'kuro', 'constructor'].map(B.bondOfRival), ['tamsin', 'lucan', 'mimosa', 'vell', null, null]);
});

test('three Nights untouched cost a pip; a touch restarts the clock; each next pip needs three more', () => {
  const b = make();
  ev(b, 2, 'help', 'mira');
  ev(b, 2, 'help', 'selim');
  for (const n of [2, 3, 4]) assert.equal(dawn(b, n).deltas.length, 0, `Dawn ${n}`);
  const d = dawn(b, 5);
  assert.deepEqual(d.deltas.map((x) => [x.who, x.to, x.why, x.line]), [['selim', 1, 'neglect', 'bonds.selim.down'], ['mira', 0, 'neglect', 'bonds.mira.down']]);
  assert.ok(['mira.call', 'selim.food', 'selim.cover'].every((id) => d.locked.includes(id)));

  const t = make();
  dawn(t, 1); dawn(t, 2);
  ev(t, 2, 'talk', 'selim');
  assert.equal(ev(t, 2, 'talk', 'selim').deltas.length, 0, 'a talk raises nothing');
  assert.deepEqual([3, 4, 5].map((n) => { dawn(t, n); return t.level('selim'); }), [1, 1, 0]);

  const s = make();
  ev(s, 1, 'help', 'selim'); ev(s, 2, 'help', 'selim');
  assert.deepEqual([3, 4, 5, 6, 7, 8].map((n) => { dawn(s, n); return s.level('selim'); }), [3, 3, 2, 2, 2, 1]);
});

test('betrayal drops a bond to 0, marks them to act against you on Night 8, and winning them back does not clear it', () => {
  const b = make();
  for (const n of [3, 4, 5]) ev(b, n, 'help', 'tamsin');
  assert.deepEqual(b.floor(), ['tamsin']);
  const c = ev(b, 5, 'betray', 'tamsin');
  assert.deepEqual(c.deltas, [{ who: 'tamsin', from: 3, to: 0, why: 'betray', line: 'bonds.tamsin.betray' }]);
  assert.deepEqual([...c.locked].sort(), ['tamsin.early', 'tamsin.fair', 'tamsin.silence']);
  assert.deepEqual(b.against(), ['tamsin']);
  assert.deepEqual(b.floor(), []);
  assert.equal(ev(b, 5, 'betray', 'tamsin').deltas.length, 0, 'twice is still once');
  assert.equal(ev(b, 5, 'betray', 'mira').deltas.length, 1, 'a stranger at 0 is still marked');
  assert.deepEqual(b.against(), ['mira', 'tamsin']);
  for (const n of [6, 7, 8]) ev(b, n, 'help', 'tamsin');
  assert.equal(b.level('tamsin'), 3);
  assert.ok(b.against().includes('tamsin'));
  assert.ok(!b.floor().includes('tamsin'), 'the scar keeps them off the floor');
});

test('Selim lends a seal at bond 2+, once a Night, and the thing he forgets comes back when you pay', () => {
  const b = make();
  assert.equal(b.apply(1, { kind: 'lend' }).refused, 'bond');
  ev(b, 1, 'share', 'selim');
  const c = b.apply(1, { kind: 'lend' });
  assert.equal(c.refused, undefined);
  assert.equal(c.line, 'bonds.selim.lend');
  assert.ok(Number.isInteger(c.thing) && c.thing >= 0 && c.thing < B.SELIM_THINGS);
  assert.deepEqual(b.selim(), { seals: 1, owes: 1, forgot: false, still: false });
  assert.equal(b.apply(1, { kind: 'lend' }).refused, 'night');
  const r = b.apply(2, { kind: 'repay' });
  assert.equal(r.thing, c.thing);
  assert.equal(r.line, 'bonds.selim.repay');
  assert.deepEqual(b.selim(), { seals: 2, owes: 0, forgot: false, still: false });
  assert.equal(b.apply(2, { kind: 'repay' }).refused, 'none');
  assert.equal(b.level('selim'), 2, 'lending and paying back move no pip');
  const seen = new Set();
  for (let seed = 1; seed <= 20; seed++) { const x = make(seed); ev(x, 1, 'help', 'selim'); seen.add(x.apply(1, { kind: 'lend' }).thing); }
  assert.ok(seen.size > 1, 'the thing varies with the seed');
});

test('Selim\'s last seal makes him still: no pip, no repay, no more loans, and still is not a betrayal', () => {
  const b = make();
  ev(b, 1, 'help', 'selim');
  const first = b.apply(1, { kind: 'lend' });
  const second = b.apply(2, { kind: 'lend' });
  assert.notEqual(first.thing, second.thing, 'two loans forget two different things');
  assert.deepEqual(second.deltas, [{ who: 'selim', from: 2, to: 0, why: 'lend', line: 'bonds.selim.still' }]);
  assert.ok(['selim.cover', 'selim.tip'].every((id) => second.locked.includes(id)));
  assert.equal(b.selim().still, true);
  assert.equal(b.greeting('selim'), 'bonds.selim.still');
  assert.equal(b.apply(3, { kind: 'repay' }).refused, 'still');
  assert.equal(b.apply(3, { kind: 'lend' }).refused, 'still');
  assert.equal(ev(b, 3, 'help', 'selim').deltas.length, 0);
  assert.deepEqual(b.against(), []);
});

test('Selim forgets you when a loan is 3 Nights old or the last Night comes: 0, against you, no more loans', () => {
  const b = make();
  ev(b, 1, 'help', 'selim');
  b.apply(2, { kind: 'lend' });           // lent Night 2, due Night 5
  for (const n of [2, 3, 4]) { assert.equal(dawn(b, n).deltas.length, 0, `Dawn ${n}`); ev(b, n, 'talk', 'selim'); }
  assert.deepEqual(dawn(b, 5).deltas, [{ who: 'selim', from: 2, to: 0, why: 'forgot', line: 'bonds.selim.forgot' }]);
  assert.deepEqual(b.selim(), { seals: 1, owes: 1, forgot: true, still: false });
  assert.equal(b.greeting('selim'), 'bonds.selim.forgotYou');
  assert.deepEqual(b.against(), ['selim']);
  assert.equal(b.apply(5, { kind: 'repay' }).refused, 'forgot');
  assert.equal(b.apply(5, { kind: 'lend' }).refused, 'forgot');
  assert.equal(dawn(b, 6).deltas.length, 0, 'forgotten once');

  const paid = make();
  ev(paid, 1, 'help', 'selim');
  paid.apply(2, { kind: 'lend' });
  paid.apply(4, { kind: 'repay' });
  for (let n = 2; n <= 8; n++) { dawn(paid, n); ev(paid, n, 'talk', 'selim'); }
  assert.deepEqual(paid.selim(), { seals: 2, owes: 0, forgot: false, still: false });
  assert.equal(paid.level('selim'), 2, 'paid in time, he remembers');

  const late = make();
  ev(late, 1, 'help', 'selim');
  late.apply(7, { kind: 'lend' });         // 7 + 3 is past the end: Night 8 judges it
  assert.equal(dawn(late, 7).deltas.length, 0);
  assert.equal(dawn(late, 8).deltas[0].why, 'forgot');
  assert.ok(late.against().includes('selim'));
});

test('unlocks: none at 0, every level adds to the one below, and the table is the bible\'s', () => {
  for (const w of B.BOND_IDS) {
    assert.deepEqual(B.unlocksFor(w, 0), []);
    for (let l = 1; l <= 3; l++) {
      assert.ok(B.unlocksFor(w, l).length > B.unlocksFor(w, l - 1).length, `${w} gains something at ${l}`);
      assert.ok(B.unlocksFor(w, l - 1).every((id) => B.unlocksFor(w, l).includes(id)));
    }
  }
  assert.deepEqual(B.unlocksFor('selim', 2), ['selim.tip', 'selim.food', 'selim.cover']);
  assert.deepEqual(B.unlocksFor('mira', 2), ['mira.call', 'mira.pair']);
  assert.ok(B.unlocksFor('selim', 3).includes('selim.water'));
  assert.ok(B.unlocksFor('lucan', 2).includes('lucan.howAda'));
  assert.ok(B.unlocksFor('mimosa', 3).includes('mimosa.eye'));
  assert.ok(B.unlocksFor('collector', 2).includes('collector.deal'));
  const kinds = new Set(B.UNLOCKS.map((x) => x.kind));
  for (const k of ['tip', 'cover', 'help', 'pair']) assert.ok(kinds.has(k), k);
  assert.deepEqual(B.UNLOCKS.filter((x) => x.kind === 'pair').map((x) => [x.who, x.at]), [['selim', 3], ['mira', 2], ['lucan', 2]], 'the hidden kept-pair clues');
  assert.equal(new Set(B.UNLOCKS.map((x) => x.id)).size, B.UNLOCKS.length);
  assert.ok(B.UNLOCKS.every((x) => B.BOND_IDS.includes(x.who) && x.id.startsWith(`${x.who}.`)));

  const b = make();
  assert.deepEqual(ev(b, 1, 'help', 'selim').unlocked, ['selim.food', 'selim.cover']);
  assert.ok(b.has('selim.cover') && !b.has('selim.water'));
  assert.deepEqual(ev(b, 1, 'betray', 'selim').locked, ['selim.tip', 'selim.food', 'selim.cover']);
  assert.deepEqual(b.unlocked(), []);
});

test('bonds never gate an ending: nothing unlocked is an ending, and the worst state still answers, only with less colour', () => {
  assert.ok(B.UNLOCKS.every((x) => ['tip', 'perk', 'cover', 'help', 'clue', 'pair', 'floor'].includes(x.kind)));
  assert.ok(B.UNLOCKS.every((x) => !/ending|gate|route|kept|burn/i.test(x.id)));
  assert.ok(Object.getOwnPropertyNames(B.Bonds.prototype).every((n) => !/ending|gate|route|^can[A-Z]/i.test(n)), 'no way to ask whether an ending is open');

  const worst = make();
  ev(worst, 1, 'help', 'selim');
  worst.apply(1, { kind: 'lend' });
  worst.apply(2, { kind: 'lend' });
  for (const w of B.BOND_IDS) ev(worst, 3, 'betray', w);
  for (let n = 3; n <= 8; n++) dawn(worst, n);
  assert.deepEqual(worst.unlocked(), []);
  assert.deepEqual(worst.floor(), []);
  assert.deepEqual(worst.against(), [...B.BOND_IDS]);

  const best = make();
  for (let n = 1; n <= 3; n++) for (const w of B.BOND_IDS) ev(best, n, 'help', w);
  assert.deepEqual(best.floor(), [...B.BOND_IDS]);
  assert.deepEqual(best.against(), []);
  assert.equal(best.unlocked().length, B.UNLOCKS.length);
});

test('random play: bonds stay 0..3, a character rises once a Night, and every line returned is in the strings', () => {
  const rng = RNG.createRng(RNG.hashSeed('bonds.fuzz', 1));
  const kinds = [...RAISE, 'clean', 'loki', 'drop', 'betray', 'talk'];
  const known = (key) => { assert.ok(key.startsWith(STR.prefix), key); const k = key.slice(STR.prefix.length); assert.ok(STR.en[k] && STR.tr[k], key); };
  for (let seed = 1; seed <= 40; seed++) {
    const b = make(seed);
    for (let night = 1; night <= 8; night++) {
      const rose = new Set();
      const check = (c) => {
        for (const d of c.deltas) {
          assert.ok(Number.isInteger(d.from) && Number.isInteger(d.to) && d.from >= 0 && d.to <= 3 && d.to >= 0 && d.from <= 3, JSON.stringify(d));
          known(d.line);
          if ([...RAISE, 'clean'].includes(d.why)) { assert.ok(!rose.has(d.who), `${d.who} rose twice in Night ${night}`); rose.add(d.who); assert.equal(d.to, d.from + 1); }
        }
        if (c.line) known(c.line);
        if (c.thing !== undefined) known(`bonds.selim.thing.${c.thing}`);
      };
      for (let i = 0; i < 12; i++) {
        const r = rng.next();
        check(r < 0.1 ? b.apply(night, { kind: 'lend' }) : r < 0.2 ? b.apply(night, { kind: 'repay' }) : b.apply(night, { kind: rng.pick(kinds), who: rng.pick(B.BOND_IDS) }));
      }
      check(dawn(b, night));
      assert.ok(lvls(b).every((v) => Number.isInteger(v) && v >= 0 && v <= 3));
      const s = b.selim();
      assert.equal(s.seals + s.owes, B.SELIM_SEALS);
      if (s.still) assert.equal(b.level('selim'), 0);
      known(b.greeting(rng.pick(B.BOND_IDS)));
    }
  }
});

test('save round trip: JSON-safe, the same afterwards, and a damaged save falls back instead of throwing', () => {
  const a = make(11);
  ev(a, 1, 'help', 'selim');
  a.apply(1, { kind: 'lend' });
  ev(a, 2, 'help', 'mira');
  ev(a, 3, 'betray', 'lucan');
  dawn(a, 3);
  const snap = JSON.parse(JSON.stringify(a.snapshot()));
  const b = make(11);
  b.restore(snap);
  assert.deepEqual(b.snapshot(), a.snapshot());
  const steps = [[3, { kind: 'lend' }], [4, { kind: 'help', who: 'tamsin' }], [5, { kind: 'repay' }], [6, { kind: 'dawn' }], [8, { kind: 'dawn' }], [8, { kind: 'betray', who: 'vell' }]];
  for (const [n, e] of steps) assert.deepEqual(b.apply(n, e), a.apply(n, e), JSON.stringify(e));
  assert.deepEqual(b.snapshot(), a.snapshot());

  const f = make(3);
  ev(f, 1, 'help', 'selim'); f.apply(1, { kind: 'lend' }); dawn(f, 4);
  const g = make(3);
  g.restore(JSON.parse(JSON.stringify(f.snapshot())));
  assert.deepEqual(g.selim(), { seals: 1, owes: 1, forgot: true, still: false });
  assert.deepEqual(g.against(), ['selim']);

  const bad = [undefined, null, 'x', 7, [], {}, { b: 'x' }, { b: { selim: { v: 99, last: -1, up: 'x' } } }, { loans: [null, { night: 'x' }, { night: 1, thing: 99 }, { night: 1, thing: 1 }, { night: 2, thing: 2 }, { night: 3, thing: 3 }] }, { forgot: 'yes' }, { taken: -5 }];
  for (const x of bad) {
    const c = make();
    c.restore(x);
    assert.ok(lvls(c).every((v) => Number.isInteger(v) && v >= 0 && v <= 3), JSON.stringify(x));
    const s = c.selim();
    assert.equal(s.seals + s.owes, B.SELIM_SEALS);
    if (s.still) assert.equal(c.level('selim'), 0, 'two loans out comes back still');
  }
  const h = make(); h.restore(undefined);
  assert.deepEqual(h.snapshot(), make().snapshot(), 'an older save with no bonds reads as a fresh run');
});

test('strings: EN and TR for every line the module can return, no dashes, the same {thing}, Turkish diacritics', () => {
  const need = [];
  for (const w of B.BOND_IDS) for (const p of [0, 1, 2, 3, 'up', 'down', 'betray']) need.push(`${w}.${p}`);
  for (const w of ['tamsin', 'lucan', 'mimosa', 'vell', 'collector']) need.push(`${w}.loki`);
  need.push('selim.forgot', 'selim.forgotYou', 'selim.still', 'selim.lend', 'selim.repay');
  for (let i = 0; i < B.SELIM_THINGS; i++) need.push(`selim.thing.${i}`);
  assert.equal(STR.prefix, 'bonds.');
  assert.deepEqual(Object.keys(STR.en).sort(), [...need].sort(), 'no missing and no stray EN key');
  assert.deepEqual(Object.keys(STR.tr).sort(), [...need].sort(), 'no missing and no stray TR key');
  const slots = (s) => (s.match(/\{\w+\}/g) ?? []).sort().join();
  for (const k of need) {
    const en = STR.en[k]; const tr = STR.tr[k];
    assert.ok(typeof en === 'string' && en.length > 3 && typeof tr === 'string' && tr.length > 3, k);
    assert.ok(!/[—–]/.test(en + tr), `${k}: no em or en dashes`);
    assert.notEqual(en, tr, k);
    assert.equal(slots(en), slots(tr), `${k}: same placeholders`);
  }
  assert.equal(slots(STR.en['selim.lend']), '{thing}');
  assert.equal(B.lineKey('mira', 2), 'bonds.mira.2');
  const tr = Object.values(STR.tr).join('');
  for (const ch of 'çğıöşüİ') assert.ok(tr.includes(ch), `TR uses ${ch}`);
});
