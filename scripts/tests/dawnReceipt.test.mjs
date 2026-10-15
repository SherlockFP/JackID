// The Dawn receipt (Night Cards panel): one snapshot taken in dawn() before the books reset. A paid Night's receipt equals the
// quota and the bank as they stood at Dawn, the interest and the tithes come from the same snapshot, and it is a copy.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let RUN, REG;
before(async () => {
  RUN = await load('src/game/run.ts');
  REG = await load('src/machines/_base/registry.ts');
  REG.load();
});

/** A debt run at the Dawn collection of Night 1, with `paid` coins in the bank and the given interest and missed tithes. */
function dawnRun(seed, { paid, interest = 0, tithe = 0 }) {
  const run = RUN.createRun({ seed, mode: 'debt' });
  run.phase = 'collection';
  if (tithe > 0) {
    // what a missed Watch tithe does: its shortfall joins tonight's quota and is kept on the tithe book
    run.tithe.added = tithe;
    run.quota.due += tithe;
  }
  run.debtPaid = run.quota.due + paid;
  run.nightInterest = interest;
  run.coins = 40;
  run.syncQuota();
  return run;
}

test('no receipt before the first paid Dawn', () => {
  const run = RUN.createRun({ seed: 81, mode: 'debt' });
  assert.equal(run.dawnReceipt(), null);
  run.dispose();
});

test('a paid Night receipt equals the quota and the bank at Dawn (24 due, 44 in the bank)', () => {
  const run = dawnRun(71, { paid: 20 });
  const dueAtDawn = run.bank().due;
  const balanceAtDawn = run.bank().balance;
  assert.equal(dueAtDawn, 24);
  assert.equal(balanceAtDawn, 44);
  run.dawn();
  const r = run.dawnReceipt();
  assert.ok(r, 'the Dawn left a receipt');
  assert.equal(r.night, 1);
  assert.equal(r.due, dueAtDawn, 'the receipt quota is the quota the Night closed against');
  assert.equal(r.paid + r.interest, balanceAtDawn, 'paid in plus interest is the bank at Dawn');
  assert.equal(r.paid, 44);
  assert.equal(r.interest, 0);
  assert.equal(r.tithe, 0);
  assert.equal(run.nightLedger().carried, balanceAtDawn - dueAtDawn, 'the surplus Dawn returned is the bank less the quota');
  run.dispose();
});

test('the receipt holds after the books reset: the next Night reads 0 of the bank, the receipt does not', () => {
  const run = dawnRun(72, { paid: 20 });
  run.dawn();
  const first = run.dawnReceipt();
  assert.equal(run.bank().balance, 0, 'the bank is reset at Dawn');
  assert.deepEqual(run.dawnReceipt(), first, 'the receipt still reads the Dawn snapshot');
  run.dispose();
});

test('paid is the bank at Dawn (interest included); interest is the part of it the bank paid', () => {
  const run = dawnRun(73, { paid: 32, interest: 12 });   // bank 56 = principal 44 + interest 12
  const dueAtDawn = run.bank().due;
  const balanceAtDawn = run.bank().balance;
  assert.equal(balanceAtDawn, 56);
  run.dawn();
  const r = run.dawnReceipt();
  assert.equal(r.due, dueAtDawn);
  assert.equal(r.paid, 56, 'bank at Dawn');
  assert.equal(r.interest, 12, 'interest');
  assert.ok(r.interest <= r.paid);
  run.dispose();
});

test('missed tithes show in the receipt as the quota they added (the "+N TITHE" line)', () => {
  const run = dawnRun(74, { paid: 10, tithe: 6 });   // quota 24 + 6 tithe = 30; the bank holds 30 + 10 = 40
  const dueAtDawn = run.bank().due;
  const balanceAtDawn = run.bank().balance;
  assert.equal(dueAtDawn, 30);
  assert.equal(balanceAtDawn, 40);
  run.dawn();
  const r = run.dawnReceipt();
  assert.equal(r.due, 30, 'the quota includes the tithe');
  assert.equal(r.tithe, 6, 'and the receipt names the 6 the tithes added');
  assert.equal(r.paid + r.interest, balanceAtDawn, 'paid in plus interest is the bank at Dawn');
  assert.equal(run.nightLedger().carried, 10, 'the surplus Dawn returned is the bank less the quota');
  run.dispose();
});

test('the receipt is a copy: changing it does not change the run', () => {
  const run = dawnRun(75, { paid: 20 });
  run.dawn();
  const r = run.dawnReceipt();
  r.due = 999;
  assert.equal(run.dawnReceipt().due, 24);
  run.dispose();
});
