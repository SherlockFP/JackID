// Wave 24 integrator wiring inside run.ts: Wing Keys at Dawn and on bosses, the Manager's Key, the Parlour after Night 3,
// the grille's key spend, the Boiler lock, the Wash lockers and the save round trip.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let RUN, ROOMS, SAVE;
before(async () => {
  RUN = await load('src/game/run.ts');
  ROOMS = await load('src/game/rooms.ts');
  SAVE = await load('src/core/save.ts');
});

/** A run on Night `n` (1-based) whose quota is exactly paid, ready for `dawn()`. */
function paid(seed, n) {
  const run = RUN.createRun({ seed, mode: 'debt' });
  run.index = n - 1;
  run.recomputeQuota();
  run.debtPaid = run.quota.due;
  return run;
}

test('Dawn: Nights 1 to 6 each pay one Wing Key; Night 7 pays none', () => {
  for (const [n, want] of [[1, 1], [2, 1], [4, 1], [5, 1], [7, 0]]) {
    const run = paid(11, n);
    run.dawn();
    assert.equal(run.wingKeys, want, `Night ${n}`);
    run.dispose();
  }
});

test('boss Nights add a Key; the Night 6 boss drops the Manager\'s Key', () => {
  const r3 = paid(12, 3); r3.dawn();
  assert.equal(r3.wingKeys, 2, 'Night 3: Dawn key + boss key');
  assert.equal(r3.managerKey, false);
  r3.dispose();
  const r6 = paid(12, 6); r6.dawn();
  assert.equal(r6.wingKeys, 2, 'Night 6: Dawn key + boss key');
  assert.equal(r6.managerKey, true);
  r6.dispose();
});

test('the Parlour opens by itself once Night 3 is paid, and not before', () => {
  const r2 = paid(13, 2); r2.dawn();
  assert.ok(!r2.tycoon.state().zones.includes('parlour'));
  r2.dispose();
  const r3 = paid(13, 3); r3.dawn();
  assert.ok(r3.tycoon.state().zones.includes('parlour'));
  r3.dispose();
});

test('a grille spends one Key (the wing state reads keyReady, then open); with no key it refuses', () => {
  const run = RUN.createRun({ seed: 14, mode: 'debt' });
  assert.equal(ROOMS.wingState('cards'), 'sealed');
  assert.equal(run.tycoon.unlockZone('cards', true), false, 'no key in hand');
  run.wingKeys = 1;
  assert.equal(ROOMS.wingState('cards'), 'keyReady');
  assert.equal(run.tycoon.unlockZone('cards', true), true);
  assert.equal(run.wingKeys, 0);
  assert.equal(ROOMS.wingState('cards'), 'open');
  run.dispose();
});

test('the Counting Room needs the Manager\'s Key', () => {
  const run = RUN.createRun({ seed: 15, mode: 'debt' });
  assert.equal(run.tycoon.unlockZone('counting', true), false);
  run.managerKey = true;
  assert.equal(ROOMS.wingState('counting'), 'keyReady');
  assert.equal(run.tycoon.unlockZone('counting', true), true);
  assert.equal(run.managerKey, false);
  run.dispose();
});

test('Wash lockers: need the room open and a Ticket; a result is seeded and each opens once a Night', () => {
  const run = RUN.createRun({ seed: 16, mode: 'debt' });
  assert.equal(run.openLocker(1).ok, false, 'room closed');
  run.tycoon.grantZone('laundry');
  run.earn('ticket', 5, 't');
  const a = run.openLocker(2);
  assert.ok(a.ok && a.result);
  assert.equal(run.openLocker(2).reason, 'used');
  run.dispose();
  const run2 = RUN.createRun({ seed: 16, mode: 'debt' });
  run2.tycoon.grantZone('laundry');
  run2.earn('ticket', 5, 't');
  assert.deepEqual(run2.openLocker(2).result, a.result, 'same seed and Night give the same locker');
  run2.dispose();
});

test('Back Office: 3 Tickets become 1 Obol, the remainder stays', () => {
  const run = RUN.createRun({ seed: 17, mode: 'debt' });
  run.earn('ticket', 8, 't');
  const t0 = run.balance('ticket');
  const r = run.backOffice();
  assert.equal(r.obols, Math.floor(t0 / 3));
  assert.equal(run.balance('ticket'), t0 % 3);
  assert.equal(run.balance('obol'), r.obols);
  run.dispose();
});

test('the room state survives a snapshot and a resume', () => {
  const run = RUN.createRun({ seed: 18, mode: 'debt' });
  run.wingKeys = 3; run.managerKey = true;
  run.tycoon.grantZone('laundry');
  run.earn('ticket', 4, 't');
  run.openLocker(5);
  run.rooms = { ...run.rooms, p: 35 };
  const snap = JSON.parse(JSON.stringify(run.snapshot()));
  assert.equal(snap.wingKeys, 3);
  assert.equal(snap.boiler.p, 35);
  const save = { data: { ...SAVE.defaultSave(), resume: snap }, update(fn) { fn(this.data); }, flush() {} };
  const back = RUN.resumeRun(save);
  assert.ok(back, 'resumed');
  assert.equal(back.wingKeys, 3);
  assert.equal(back.managerKey, true);
  assert.equal(back.rooms.p, 35);
  assert.deepEqual(back.rooms.lockers, [5]);
  run.dispose(); back.dispose();
});
