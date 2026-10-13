// Unit tests for src/machines/_base/cards.ts (TECH_SPEC §3.7): shoe, card encoding, poker, blackjack and baccarat.
// Skipped until the module exists. CardId is 'RS' (rank then suit), e.g. 'AS', 'TD', with 'JK' for jokers.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite, hasModule } from './_vite.mjs';

after(closeVite);

const MOD = 'src/machines/_base/cards.ts';
const skip = hasModule(MOD) ? false : `${MOD} does not exist yet`;

const HANDS = {
  royal: ['AS', 'KS', 'QS', 'JS', 'TS'],
  straightFlush: ['9H', '8H', '7H', '6H', '5H'],
  quads: ['9S', '9H', '9D', '9C', '2S'],
  fullHouse: ['KS', 'KH', 'KD', '3C', '3S'],
  flush: ['2H', '5H', '9H', 'JH', 'KH'],
  straight: ['5S', '6H', '7D', '8C', '9S'],
  trips: ['7S', '7H', '7D', '2C', 'KS'],
  twoPair: ['4S', '4H', '8D', '8C', 'KS'],
  pair: ['4S', '4H', '8D', '7C', '9S'],
  high: ['AS', '9H', '6D', '4C', '2S'],
};
// Strongest first; jacks-or-better sits between pair and two pair and is not ordered against pair here.
const LADDER = ['royal', 'straightFlush', 'quads', 'fullHouse', 'flush', 'straight', 'trips', 'twoPair', 'pair', 'high'];

test('newShoe() holds decks x 52 cards, each exactly `decks` times', { skip }, async () => {
  const { newShoe } = await load(MOD);
  const { createRng } = await load('src/core/rng.ts');
  for (const decks of [1, 2, 6]) {
    const shoe = newShoe(decks, createRng(decks));
    assert.equal(shoe.length, 52 * decks);
    const counts = new Map();
    for (const c of shoe) counts.set(c, (counts.get(c) ?? 0) + 1);
    assert.equal(counts.size, 52);
    for (const n of counts.values()) assert.equal(n, decks);
  }
});

test('newShoe() is a pure function of the rng seed', { skip }, async () => {
  const { newShoe } = await load(MOD);
  const { createRng } = await load('src/core/rng.ts');
  assert.deepEqual(newShoe(2, createRng(31)), newShoe(2, createRng(31)));
});

test('rankOf() and suitOf() decode the CardId encoding', { skip }, async () => {
  const { rankOf, suitOf } = await load(MOD);
  assert.equal(rankOf('AS'), 14);
  assert.equal(rankOf('2C'), 2);
  assert.equal(rankOf('TD'), 10);
  assert.equal(rankOf('KC'), 13);
  assert.equal(suitOf('QH'), 'H');
  assert.equal(suitOf('3S'), 'S');
});

test('evalPoker5() names every hand category', { skip }, async () => {
  const { evalPoker5 } = await load(MOD);
  for (const [cat, cards] of Object.entries(HANDS)) {
    assert.equal(evalPoker5(cards).cat, cat, `${cards.join(' ')}`);
  }
  assert.equal(evalPoker5(['AS', '2H', '3D', '4C', '5S']).cat, 'straight', 'A-2-3-4-5 is a straight');
});

test('evalPoker5() scores fall as hands weaken', { skip }, async () => {
  const { evalPoker5 } = await load(MOD);
  const scores = LADDER.map((cat) => evalPoker5(HANDS[cat]).score);
  for (let i = 1; i < scores.length; i++) {
    assert.ok(scores[i - 1] > scores[i], `${LADDER[i - 1]} should beat ${LADDER[i]}`);
  }
  const wheel = evalPoker5(['AS', '2H', '3D', '4C', '5S']).score;
  const sixHigh = evalPoker5(['2S', '3H', '4D', '5C', '6S']).score;
  assert.ok(wheel < sixHigh, 'the five-high straight is the lowest straight');
});

test('evalPoker5() with { jacks: true } labels a pair of J or better as jacks, score unchanged', { skip }, async () => {
  const { evalPoker5 } = await load(MOD);
  const hi = evalPoker5(['JS', 'JH', '4D', '7C', '9S'], { jacks: true });
  const lo = evalPoker5(['4S', '4H', '8D', '7C', '9S'], { jacks: true });
  assert.equal(hi.cat, 'jacks');
  assert.equal(lo.cat, 'pair');
  assert.equal(hi.score, evalPoker5(['JS', 'JH', '4D', '7C', '9S']).score);
});

test('a joker is wild and can complete five of a kind', { skip }, async () => {
  const { evalPoker5 } = await load(MOD);
  assert.equal(evalPoker5(['JK', 'KS', 'KH', 'KD', 'KC']).cat, 'fiveKind');
  assert.equal(evalPoker5(['JK', 'KS', 'KH', 'KD', '3C']).cat, 'quads');
});

test('bestPoker() picks the strongest five of seven', { skip }, async () => {
  const { bestPoker, evalPoker5 } = await load(MOD);
  const seven = ['AS', 'KS', 'QS', 'JS', 'TS', '2D', '3C'];
  const r = bestPoker(seven);
  assert.equal(r.cat, 'royal');
  assert.equal(r.best.length, 5);
  assert.equal(evalPoker5(r.best).cat, 'royal');
  assert.equal(bestPoker(['2H', '2S', '2D', '2C', 'KD', '3S', '4H']).cat, 'quads');
});

test('bjTotal() counts aces soft and flags blackjack and bust', { skip }, async () => {
  const { bjTotal } = await load(MOD);
  assert.deepEqual(bjTotal(['AS', 'KD']), { total: 21, soft: true, bust: false, blackjack: true });
  assert.deepEqual(bjTotal(['AS', 'AD', '9C']), { total: 21, soft: true, bust: false, blackjack: false });
  assert.deepEqual(bjTotal(['AS', 'AD', 'AC', '8S']), { total: 21, soft: true, bust: false, blackjack: false });
  assert.deepEqual(bjTotal(['KS', 'QD', '5C']), { total: 25, soft: false, bust: true, blackjack: false });
  assert.deepEqual(bjTotal(['9S', '8D']), { total: 17, soft: false, bust: false, blackjack: false });
});

test('baccaratValue() keeps the last digit; tens and face cards count zero', { skip }, async () => {
  const { baccaratValue } = await load(MOD);
  assert.equal(baccaratValue(['KS', '9D']), 9);
  assert.equal(baccaratValue(['TS', '5D']), 5);
  assert.equal(baccaratValue(['AS', '9D']), 0);
  assert.equal(baccaratValue(['8S', '8D']), 6);
  assert.equal(baccaratValue(['7S', '8D', '9C']), 4);
});
