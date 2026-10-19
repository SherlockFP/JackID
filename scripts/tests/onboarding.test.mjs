// Onboarding (wave 72): the progressive-disclosure schedule by printed Night (src/menu/hud/disclose.ts), the objective line's
// choice of target (objectiveFor). The boon offer's Night gate lives in pantheon.test.mjs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let D;
before(async () => {
  D = await load('src/menu/hud/disclose.ts');
});

test('Night 1 shows only the basics: no payout, projection, Hot, Tilt, floor events, cards, tithe, spotlight or overshoot', () => {
  for (const what of ['payout', 'projection', 'hot', 'tilt', 'floorEvents', 'cards', 'tithe', 'spotlight', 'overshoot']) {
    assert.equal(D.revealed(1, what), false, `${what} must be hidden on Night 1`);
  }
});

test('Night 2 adds Hot, Tilt, payout, projection, floor events and Night Cards', () => {
  for (const what of ['payout', 'projection', 'hot', 'tilt', 'floorEvents', 'cards']) {
    assert.equal(D.revealed(2, what), true, `${what} must show on Night 2`);
  }
  assert.equal(D.revealed(2, 'tithe'), false);
  assert.equal(D.revealed(2, 'spotlight'), false);
});

test('Night 3 adds the tithe; Night 4 adds the spotlight and overshoot', () => {
  assert.equal(D.revealed(3, 'tithe'), true);
  assert.equal(D.revealed(3, 'spotlight'), false);
  assert.equal(D.revealed(3, 'overshoot'), false);
  assert.equal(D.revealed(4, 'spotlight'), true);
  assert.equal(D.revealed(4, 'overshoot'), true);
  assert.equal(D.revealed(9, 'overshoot'), true, 'once shown, later Nights keep it');
});

test('stake presets: SAFE from Night 1, BOLD from Night 2, BIG from Night 3', () => {
  assert.deepEqual(['safe', 'bold', 'big'].map((k) => D.presetRevealed(1, k)), [true, false, false]);
  assert.deepEqual(['safe', 'bold', 'big'].map((k) => D.presetRevealed(2, k)), [true, true, false]);
  assert.deepEqual(['safe', 'bold', 'big'].map((k) => D.presetRevealed(3, k)), [true, true, true]);
});

test('the objective line is on Nights 1 and 2 only', () => {
  assert.equal(D.objectiveShown(1), true);
  assert.equal(D.objectiveShown(2), true);
  assert.equal(D.objectiveShown(3), false);
});

test('tickets readout shows once a ticket has been held', () => {
  assert.equal(D.ticketsShown(false, 0), false);
  assert.equal(D.ticketsShown(false, 2), true);
  assert.equal(D.ticketsShown(true, 0), true, 'latched after the first ticket');
});

test('objective: win, then deposit, then ring the Bell, in a Watch', () => {
  const base = { phase: 'play', paid: false, rounds: 0, deposits: 0, pocket: 20 };
  assert.deepEqual(D.objectiveFor(base), { key: 'win', target: 'bigone' });
  assert.deepEqual(D.objectiveFor({ ...base, rounds: 3 }), { key: 'deposit', target: 'debt_terminal' });
  assert.deepEqual(D.objectiveFor({ ...base, rounds: 3, pocket: 0 }), { key: 'bell', target: null });
  assert.deepEqual(D.objectiveFor({ ...base, rounds: 3, deposits: 1 }), { key: 'bell', target: null });
});

test('objective: an empty pocket points at the first way out (bank, cashier, phone, loan, or the Bell)', () => {
  const base = { phase: 'play', paid: false, rounds: 2, deposits: 1, pocket: 0, owed: 20 };
  assert.deepEqual(D.objectiveFor({ ...base, broke: 'bank' }), { key: 'broke.bank', target: 'debt_terminal' });
  assert.deepEqual(D.objectiveFor({ ...base, broke: 'cashier' }), { key: 'broke.cashier', target: 'cashier' });
  assert.deepEqual(D.objectiveFor({ ...base, broke: 'phone' }), { key: 'broke.phone', target: null });
  assert.deepEqual(D.objectiveFor({ ...base, broke: 'loan' }), { key: 'broke.loan', target: null });
  assert.deepEqual(D.objectiveFor({ ...base, broke: 'bell' }), { key: 'bell', target: 'bell' });
  assert.deepEqual(D.objectiveFor({ ...base, broke: null }), { key: 'win', target: 'bigone' }, 'not broke: the normal chain');
  assert.deepEqual(D.objectiveFor({ ...base, phase: 'intermission', broke: 'bank' }), { key: 'dawn', target: null }, 'only in a Watch');
});

test('objective: paid Night says take the lift; between Watches with the quota open says due at Dawn', () => {
  assert.deepEqual(D.objectiveFor({ phase: 'play', paid: true, rounds: 0, deposits: 0, pocket: 0 }), { key: 'lift', target: 'lift' });
  assert.deepEqual(D.objectiveFor({ phase: 'intermission', paid: false, rounds: 4, deposits: 1, pocket: 0 }), { key: 'dawn', target: null });
  assert.deepEqual(D.objectiveFor({ phase: 'settle', paid: false, rounds: 4, deposits: 1, pocket: 0 }), { key: 'bell', target: null });
});
