// Unit tests for the HUD terms (src/game/terms.ts): the once-per-profile seen flags, the journal's terms page and the goal strip's line.
// Pure functions only: no DOM, no app.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let tm;
before(async () => {
  tm = await load('src/game/terms.ts');
});

test('a term is marked once per profile and listed in catalogue order', () => {
  const seen = {};
  assert.equal(tm.termMark(seen, 'luck'), true, 'the first time says so');
  assert.equal(tm.termMark(seen, 'luck'), false, 'the second time does not');
  tm.termMark(seen, 'quota');
  assert.deepEqual(tm.termsSeen(seen), ['quota', 'luck']);
  assert.equal(seen['term.luck'], 1, 'the flag lives in the save seen record');
});

test('only catalogue ids pass isTerm', () => {
  assert.ok(tm.isTerm('seal'));
  assert.ok(!tm.isTerm('machine'));
});

test('the goal line reads the quota, what is left, and the paid and sealed Nights', () => {
  assert.equal(tm.goalLine({ due: 0, deposited: 0, paid: false, sealed: false }), null, 'no quota set yet: no line');
  assert.deepEqual(tm.goalLine({ due: 24, deposited: 5, paid: false, sealed: false }), { key: 'term.goal.pay', n: 24, left: 19 });
  assert.equal(tm.goalLine({ due: 24, deposited: 30, paid: false, sealed: false }).key, 'term.goal.met', 'covered, waiting for dawn');
  assert.equal(tm.goalLine({ due: 24, deposited: 24, paid: true, sealed: false }).key, 'term.goal.paid');
  assert.equal(tm.goalLine({ due: 0, deposited: 0, paid: true, sealed: true }).key, 'term.goal.sealed');
});

test('the glossary page lists only the terms seen', () => {
  const tr = (k) => k;
  assert.equal(tm.glossBody({}, tr), '');
  assert.equal(tm.glossBody({ 'term.seal': 1 }, tr), 'term.seal.n\nterm.seal.d');
});
