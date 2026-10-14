// Integration tests for the Hollow Door inside run.ts: once-per-run triggers, the 3:33 call's answers, the Lord's run effects
// (quota forgiven, Soul Mark restored, the run taken with its Obols) and the Tickets a duel spends. Headless: no DOM, no world.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let RUN, BUS;
before(async () => {
  RUN = await load('src/game/run.ts');
  BUS = (await load('src/core/events.ts')).bus;
});

const mk = (seed = 7) => RUN.createRun({ seed, mode: 'debt' });

test('the door opens once per run, from any trigger; a second trigger is refused', () => {
  const run = mk();
  const opened = [];
  const off = BUS.on('hollow:open', (e) => opened.push(e.reason));
  try {
    assert.equal(run.hollowTrigger('knock'), true);
    assert.equal(run.hollowTrigger('loan'), false, 'already open');
    assert.equal(run.hollowTrigger('phone'), false, 'already open');
    assert.deepEqual(opened, ['crack']);
  } finally { off(); run.dispose(); }
});

test('the 3:33 call: go down opens the door as the phone, hang up spends the phone for the run', () => {
  const run = mk(11);
  const opened = [];
  const off = BUS.on('hollow:open', (e) => opened.push(e.reason));
  try {
    assert.equal(run.hollowRing(), true, 'the call rings from a fresh door');
    assert.equal(run.hollowAnswer('godown'), true);
    assert.deepEqual(opened, ['phone333']);
  } finally { off(); run.dispose(); }
  const run2 = mk(12);
  try {
    assert.equal(run2.hollowRing(), true);
    assert.equal(run2.hollowAnswer('hangup'), true);
    assert.equal(run2.hollowRing(), false, 'the phone never rings again for this run');
    assert.equal(run2.hollowTrigger('knock'), true, 'the other triggers stay possible');
  } finally { run2.dispose(); }
});

test('a Lord who forgives the quota sets the current Night to 0 (Ledgers: this Night and the next)', () => {
  const run = mk(21);
  try {
    const before = run.shift.quota().due;
    assert.ok(before > 0, 'Night 1 owes a quota');
    run.forgiveQuota(1);
    assert.equal(run.shift.quota().due, 0);
    run.forgiveQuota(2);
    assert.equal(run.shift.quota().due, 0, 'still forgiven this Night');
  } finally { run.dispose(); }
});

test('a correct Mirror call restores the Soul Mark that was staked', () => {
  const run = mk(31);
  try {
    const full = run.duel.soulMarks();
    assert.equal(run.duel.stakeSoulMark(), true);
    assert.equal(run.duel.soulMarks(), full - 1);
    run.restoreSoulMark();
    assert.equal(run.duel.soulMarks(), full);
  } finally { run.dispose(); }
});

test('taken: the run ends as a fall with the Obols multiplier, and the Tickets of the duel are the machine\'s to spend', () => {
  const run = mk(41);
  let summary = null;
  const off = BUS.on('run:end', (e) => { summary = e.summary; });
  try {
    const ticketsBefore = run.balance('ticket');
    assert.equal(run.spend('ticket', 1, 'lordstable'), true);
    assert.equal(run.balance('ticket'), ticketsBefore - 1);
    run.hollowBankObols(1.5);
    run.takeRun();
    assert.ok(summary, 'run:end was emitted');
    assert.equal(summary.result, 'fell');
    assert.equal(summary.ending, 'taken');
    assert.equal(typeof summary.obols, 'number');
  } finally { off(); run.dispose(); }
});
