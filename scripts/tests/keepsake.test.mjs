// THE KEEPSAKE STAKE (src/game/keepsake.ts): one keepsake carried from home, one stake per Night at a seat, a win brings it back
// (+1 star), a loss gives it to the House (Harmony -1), the buy-back price, and the save round trip.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

const K = await load('src/game/keepsake.ts');

test('a fresh box holds all three keepsakes at home, none carried, none lost', () => {
  const k = K.createKeepsakes();
  assert.deepEqual(k.owned(), ['ring', 'watch', 'photo']);
  assert.deepEqual(k.lost(), []);
  assert.equal(k.carried(), null);
});

test('carry takes only an owned keepsake (or none)', () => {
  const k = K.createKeepsakes();
  assert.equal(k.carry('watch'), true);
  assert.equal(k.carried(), 'watch');
  assert.equal(k.carry(null), true);
  assert.equal(k.carried(), null);
  assert.equal(k.carry('ghost'), false);
  assert.equal(k.carried(), null);
});

test('no stake without a carried keepsake', () => {
  const k = K.createKeepsakes();
  assert.equal(k.arm('seat-1', 1), false);
  assert.equal(k.open('seat-1', 1), null);
  assert.equal(k.inRound('seat-1'), false);
});

test('arm, then the next bet at that seat opens the round with the keepsake', () => {
  const k = K.createKeepsakes();
  k.carry('ring');
  assert.equal(k.arm('seat-1', 1), true);
  assert.equal(k.pending('seat-1', 1), 'ring');
  assert.equal(k.pending('seat-2', 1), null, 'a stake is for the seat it was armed at');
  assert.equal(k.open('seat-1', 1), 'ring');
  assert.equal(k.inRound('seat-1'), true);
  assert.equal(k.pending('seat-1', 1), null, 'once opened, the arm is spent');
});

test('one keepsake stake per Night, the next Night allows one again', () => {
  const k = K.createKeepsakes();
  k.carry('photo');
  k.arm('seat-1', 1);
  k.open('seat-1', 1);
  k.settle('seat-1', true);
  assert.equal(k.arm('seat-2', 1), false, 'already staked tonight');
  k.newNight();
  assert.equal(k.arm('seat-2', 2), true, 'a new Night allows a stake again');
});

test('a waiting stake is dropped at a new Night and by a different carry', () => {
  const k = K.createKeepsakes();
  k.carry('ring');
  k.arm('seat-1', 1);
  k.newNight();
  assert.equal(k.pending('seat-1', 1), null);
  k.arm('seat-1', 2);
  k.carry('watch');
  assert.equal(k.pending('seat-1', 2), null, 'carrying another keepsake drops the armed one');
});

test('a second keepsake cannot go on a seat that already has a round', () => {
  const k = K.createKeepsakes();
  k.carry('watch');
  k.arm('seat-1', 1);
  k.open('seat-1', 1);
  assert.equal(k.arm('seat-1', 2), false, 'the round is still open at that seat');
});

test('a win returns the keepsake, keeps it carried, and gives one ŞANS star', () => {
  const k = K.createKeepsakes();
  k.carry('ring');
  k.arm('seat-1', 1);
  k.open('seat-1', 1);
  const out = k.settle('seat-1', true);
  assert.deepEqual(out, { state: 'won', id: 'ring', mid: 'seat-1', night: 1, star: K.KEEPSAKE_STAR, harmony: 0 });
  assert.equal(K.KEEPSAKE_STAR, 1);
  assert.ok(k.owned().includes('ring'));
  assert.equal(k.carried(), 'ring');
  assert.equal(k.inRound('seat-1'), false);
  assert.equal(k.settle('seat-1', true), null, 'a settled round cannot settle twice');
});

test('a loss gives the keepsake to the House: Harmony -1, not owned, carried cleared', () => {
  const k = K.createKeepsakes();
  k.carry('photo');
  k.arm('seat-1', 1);
  k.open('seat-1', 1);
  const out = k.settle('seat-1', false);
  assert.deepEqual(out, { state: 'lost', id: 'photo', mid: 'seat-1', night: 1, star: 0, harmony: K.KEEPSAKE_HARMONY_LOSS });
  assert.equal(K.KEEPSAKE_HARMONY_LOSS, -1);
  assert.equal(k.owned().includes('photo'), false);
  assert.deepEqual(k.lost(), ['photo']);
  assert.equal(k.carried(), null);
});

test('buy-back: a lost keepsake returns for its price, an owned one cannot be bought', () => {
  const k = K.createKeepsakes();
  assert.equal(k.buyBackPrice('ring'), null, 'owned: nothing to buy');
  assert.equal(k.buyBack('ring'), false);
  k.carry('ring');
  k.arm('seat-1', 1);
  k.open('seat-1', 1);
  k.settle('seat-1', false);
  assert.equal(k.buyBackPrice('ring'), K.KEEPSAKE_PRICE.ring);
  assert.equal(k.buyBack('ring'), true);
  assert.deepEqual(k.lost(), []);
  assert.ok(k.owned().includes('ring'));
  assert.equal(k.buyBackPrice('ring'), null);
});

test('prices are fixed per keepsake and positive', () => {
  for (const id of ['ring', 'watch', 'photo']) assert.ok(K.KEEPSAKE_PRICE[id] > 0, id);
});

test('the save round trip keeps owned, lost, carried, the once-a-Night mark and the open round', () => {
  const k = K.createKeepsakes();
  k.carry('watch');
  k.arm('seat-3', 4);
  k.open('seat-3', 4);
  k.settle('seat-3', false);
  k.carry('photo');
  const s = JSON.parse(JSON.stringify(k.snapshot()));
  const back = K.createKeepsakes();
  back.restore(s);
  assert.deepEqual(back.owned(), k.owned());
  assert.deepEqual(back.lost(), ['watch']);
  assert.equal(back.carried(), 'photo');
  assert.equal(back.arm('seat-9', 4), false, 'Night 4 already had its stake');
  assert.equal(back.arm('seat-9', 5), true, 'the next Night allows a stake');
  assert.equal(back.pending('seat-9', 5), 'photo');
  back.newNight();
  assert.equal(back.buyBack('watch'), true);
});

test('a damaged or missing slice reads as a fresh box', () => {
  for (const junk of [undefined, null, 42, 'x', { owned: 'ring', carried: 'nope', rounds: [{ id: 'ring' }] }]) {
    const k = K.createKeepsakes();
    k.restore(junk);
    assert.deepEqual(k.owned(), ['ring', 'watch', 'photo'], JSON.stringify(junk));
    assert.equal(k.carried(), null);
    assert.equal(k.inRound('seat-1'), false);
  }
});
