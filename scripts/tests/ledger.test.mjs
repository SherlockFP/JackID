// Unit tests for the Wash ledger (THE SECOND NAME, quest 1): src/game/story/quests.ts (pure progress, locker offer and claim),
// its wrappers in src/game/rooms.ts (run state, save restore), the three ledger pages in src/game/story/notes.data.ts (Night
// and wing placement) and the quest strings (EN and TR keys match, placeholders agree).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let Q, RM, ND, QS;
before(async () => {
  Q = await load('src/game/story/quests.ts');
  RM = await load('src/game/rooms.ts');
  ND = await load('src/game/story/notes.data.ts');
  QS = (await load('src/game/story/quests.strings.ts')).default;
});

const CHARMS = ['lucky_coin', 'rabbit', 'ash_ring', 'mint', 'tin_dog', 'lamp', 'bell'];

test('ledger: the three pages, in reading order, fire once each', () => {
  assert.deepEqual([...Q.LEDGER_NOTES], ['n17', 'n18', 'n19']);
  let p = Q.ledgerStart();
  const a = Q.ledgerFind(p, 'n18');
  assert.equal(a.fresh, true);
  assert.equal(a.n, 1);
  assert.equal(a.total, 3);
  assert.equal(a.completed, false);
  p = a.progress;
  const again = Q.ledgerFind(p, 'n18');
  assert.equal(again.fresh, false, 'a repeat read is not a new find');
  assert.equal(again.progress, p, 'a repeat read changes nothing');
  p = Q.ledgerFind(p, 'n17').progress;
  const last = Q.ledgerFind(p, 'n19');
  assert.equal(last.fresh, true);
  assert.equal(last.n, 3);
  assert.equal(last.completed, true, 'the third page completes the ledger');
  assert.deepEqual(last.progress.found, ['n17', 'n18', 'n19'], 'reading order is table order, not find order');
  assert.equal(Q.ledgerDone(last.progress), true);
});

test('ledger: non-ledger notes change nothing', () => {
  const p = Q.ledgerStart();
  const r = Q.ledgerFind(p, 'n01');
  assert.equal(r.fresh, false);
  assert.equal(r.progress, p);
  assert.equal(r.n, 0);
});

test('ledger: restore drops junk, duplicates and an unearned claim', () => {
  const r = Q.restoreLedger({ found: ['n19', 'n19', 'zz', 7, 'n17'], claimed: true });
  assert.deepEqual(r.found, ['n17', 'n19'], 'ids kept once, in table order, unknowns dropped');
  assert.equal(r.claimed, false, 'a claim needs the whole ledger');
  const full = Q.restoreLedger({ found: ['n17', 'n18', 'n19'], claimed: true });
  assert.equal(full.claimed, true);
  assert.deepEqual(Q.restoreLedger(undefined), { found: [], claimed: false });
  assert.deepEqual(Q.restoreLedger('nope'), { found: [], claimed: false });
});

test('ledger: the offer is empty until the ledger is whole, then three distinct charms, deterministic per seed', () => {
  let p = Q.ledgerStart();
  assert.deepEqual(Q.ledgerChoices(p, 42, CHARMS), [], 'no offer before the ledger is whole');
  p = { found: ['n17', 'n18', 'n19'], claimed: false };
  const a = Q.ledgerChoices(p, 42, CHARMS);
  const b = Q.ledgerChoices(p, 42, [...CHARMS].reverse());
  assert.equal(a.length, 3);
  assert.equal(new Set(a).size, 3, 'three distinct charms');
  assert.ok(a.every((c) => CHARMS.includes(c)));
  assert.deepEqual(a, b, 'same pool and seed, same offer, whatever the pool order');
  assert.deepEqual(Q.ledgerChoices(p, 42, CHARMS), a, 'a repeat call gives the same offer');
  assert.deepEqual(Q.ledgerChoices(p, 42, ['only']), ['only'], 'a short pool offers what it has');
  assert.deepEqual(Q.ledgerChoices(p, 42, []), [], 'an empty pool offers nothing');
  assert.deepEqual(Q.ledgerChoices({ ...p, claimed: true }, 42, CHARMS), [], 'no offer once claimed');
  const seeds = new Set();
  for (let s = 1; s <= 20; s++) seeds.add(Q.ledgerChoices(p, s, CHARMS).join('|'));
  assert.ok(seeds.size > 1, 'the seed changes the offer');
});

test('ledger: a claim takes one offered charm, once', () => {
  const p = { found: ['n17', 'n18', 'n19'], claimed: false };
  const offer = Q.ledgerChoices(p, 9, CHARMS);
  const refused = Q.ledgerClaim(p, CHARMS.find((c) => !offer.includes(c)), 9, CHARMS);
  assert.equal(refused.ok, false, 'a charm outside the offer is refused');
  assert.equal(refused.progress, p);
  const got = Q.ledgerClaim(p, offer[1], 9, CHARMS);
  assert.equal(got.ok, true);
  assert.equal(got.charm, offer[1]);
  assert.equal(got.progress.claimed, true);
  assert.equal(Q.ledgerClaim(got.progress, offer[0], 9, CHARMS).ok, false, 'the locker gives one charm only');
});

test('rooms: the ledger lives in RoomsState and survives a save round trip', () => {
  let s = RM.roomsStart();
  assert.deepEqual(s.ledger, { found: [], claimed: false });
  const r1 = RM.ledgerRead(s, 'n17');
  assert.equal(r1.fresh, true);
  s = r1.state;
  assert.deepEqual(s.ledger.found, ['n17']);
  assert.equal(RM.ledgerRead(s, 'n17').state, s, 'a repeat read keeps the same state object');
  s = RM.ledgerRead(s, 'n18').state;
  const last = RM.ledgerRead(s, 'n19');
  assert.equal(last.completed, true);
  s = last.state;
  const saved = JSON.parse(JSON.stringify(s));
  const back = RM.restoreRooms(saved);
  assert.deepEqual(back.ledger, s.ledger, 'the saved ledger comes back intact');
  assert.equal(RM.restoreRooms({ p: 0, blown: false, lockers: [] }).ledger.found.length, 0, 'an old save has no ledger');
  const offer = RM.ledgerOffer(back, 5, CHARMS);
  assert.equal(offer.length, 3);
  const pick = RM.ledgerPick(back, offer[0], 5, CHARMS);
  assert.equal(pick.ok, true);
  assert.equal(pick.state.ledger.claimed, true);
  assert.equal(back.ledger.claimed, false, 'the input state is not mutated');
  assert.equal(RM.ledgerPick(pick.state, offer[0], 5, CHARMS).ok, false);
});

test('rooms: a ledger page does not touch the locker tally', () => {
  const s = RM.roomsStart();
  const r = RM.ledgerRead(s, 'n19');
  assert.equal(r.state.lockerNight, s.lockerNight);
  assert.deepEqual(r.state.lockers, s.lockers);
});

test('notes: the ledger pages are placed on the open floor, n17 and n18 from Night 1, n19 from Night 3', () => {
  const closed = { zoneOpen: () => false, night: () => 1 };
  const n17 = ND.NOTES.find((d) => d.id === 'n17');
  const n18 = ND.NOTES.find((d) => d.id === 'n18');
  const n19 = ND.NOTES.find((d) => d.id === 'n19');
  assert.equal(ND.noteOpen(n17, closed), true, 'n17 shows with the Wash shut');
  assert.equal(ND.noteOpen(n18, closed), true, 'n18 shows with the Wash shut');
  assert.equal(ND.noteOpen(n19, closed), false, 'n19 waits for Night 3');
  const night3 = { zoneOpen: () => false, night: () => 3 };
  assert.equal(ND.noteOpen(n19, night3), true, 'all three placed by Night 3, wing shut');
  assert.equal(ND.noteOpen(n17, null), true, 'no gate: an always-placed Night 1 page shows');
  assert.equal(ND.noteOpen(n19, null), false, 'no gate: n19 still waits for Night 3');
  assert.equal(ND.noteOpen({ ...n17, always: undefined }, closed), false, 'without always a wing-gated note stays hidden');
  const ids = ND.NOTES.filter((d) => ND.noteOpen(d, night3)).map((d) => d.id);
  assert.ok(['n17', 'n18', 'n19'].every((id) => ids.includes(id)));
  for (const d of [n17, n18, n19]) {
    assert.ok(!/^note\./.test(d.anchor), `${d.id} sits on a floor anchor, not an unplaced note.* marker`);
  }
});

test('strings: quest keys exist in EN and TR, and their placeholders agree', () => {
  const en = QS.en, tr = QS.tr;
  assert.ok(tr, 'a TR table exists');
  assert.deepEqual(Object.keys(tr).sort(), Object.keys(en).sort(), 'the same keys in both languages');
  const holes = (s) => (s.match(/\{[a-z0-9]+\}/gi) ?? []).sort().join(',');
  for (const k of Object.keys(en)) {
    assert.equal(holes(tr[k]), holes(en[k]), `placeholders match for ${k}`);
    assert.ok(en[k].length > 0 && tr[k].length > 0, `${k} is not empty`);
  }
});

test('ledger: the journal line counts only while the quest runs (started, not claimed)', () => {
  assert.equal(Q.ledgerLine(Q.ledgerStart()), null);
  assert.deepEqual(Q.ledgerLine({ found: ['n17'], claimed: false }), { n: 1, total: Q.LEDGER.total });
  assert.deepEqual(Q.ledgerLine({ found: ['n17', 'n18', 'n19'], claimed: false }), { n: 3, total: Q.LEDGER.total });
  assert.equal(Q.ledgerLine({ found: ['n17', 'n18', 'n19'], claimed: true }), null);
});
