// Overshoot depth: the two top overpay tiers (JACKPOT SEAL at 3x, HOUSE ENVY at 4x), the overshoot lock (coins above the
// quota cannot leave until Dawn, but they still earn interest at each Settle), and that Dawn returns the surplus.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { load, closeVite } from './_vite.mjs';

after(closeVite);

let RUN, SCH, BK, EV, REG;
before(async () => {
  RUN = await load('src/game/run.ts');
  SCH = await load('src/game/data/schedule.ts');
  BK = await load('src/game/bank.ts');
  EV = await load('src/core/events.ts');
  REG = await load('src/machines/_base/registry.ts');
  REG.load();
});

const LOWER = ['gratuity', 'favoured', 'uncommon', 'golden'];

/** Marks the tiers as already claimed this Night, so a Dawn grants only the tier under test. */
const claim = (run, ids) => { for (const id of ids) run.quota.claimed.push({ id, at: 0 }); };

test('the overpay ladder: JACKPOT SEAL (3x) and HOUSE ENVY (4x) sit above golden, with the rewards the design names', () => {
  const tiers = SCH.OVERSHOOT_TIERS;
  assert.deepEqual(tiers.map((t) => t.id), ['gratuity', 'favoured', 'uncommon', 'golden', 'seal', 'envy']);
  for (let i = 1; i < tiers.length; i++) assert.ok(tiers[i].ratio > tiers[i - 1].ratio, 'ratios climb tier by tier');
  const seal = tiers.find((t) => t.id === 'seal');
  assert.equal(seal.ratio, 3);
  assert.deepEqual(seal.reward.currencies, { coin: 0, ticket: 5, obol: 0 }, 'JACKPOT SEAL: 5 Tickets');
  assert.deepEqual(seal.reward.charm, { choose: 1, of: 2, rarity: 'legendary' }, 'and a Legendary charm, choose 1 of 2');
  const envy = tiers.find((t) => t.id === 'envy');
  assert.equal(envy.ratio, 4);
  assert.equal(envy.restoreMark, true, 'HOUSE ENVY restores a Soul Mark');
  assert.deepEqual(envy.reward.currencies, { coin: 0, ticket: 0, obol: 3 }, 'or pays 3 Obols when the card is full');
});

test('the bank reads the top tiers: 3x is JACKPOT SEAL, 4x is HOUSE ENVY, and the view names the next one to chase', () => {
  const due = 100;
  assert.equal(BK.tierReached(299, due), 'golden', 'just under 3x is still golden');
  assert.equal(BK.tierReached(300, due), 'seal');
  assert.equal(BK.tierReached(399, due), 'seal');
  assert.equal(BK.tierReached(400, due), 'envy');
  assert.equal(BK.tierReached(9000, due), 'envy', 'past the top tier it stays there');
  const run = RUN.createRun({ seed: 70, mode: 'debt' });
  const quotaDue = run.quota.due;
  run.debtPaid = 3 * quotaDue;
  run.syncQuota();
  const view = run.overshootView();
  assert.equal(view.tier, 'seal');
  assert.equal(view.next.id, 'envy');
  assert.equal(view.next.target, 4 * quotaDue, 'the first whole coin at 4x');
  run.dispose();
});

test('JACKPOT SEAL at Dawn on Night 1: 5 Tickets, and a choice of two (Rare: Legendary charms unlock at Night 5)', () => {
  const run = RUN.createRun({ seed: 72, mode: 'debt' });
  const due = run.quota.due;
  claim(run, LOWER);
  const tickets = run.balance('ticket');
  run.debtPaid = 3 * due;
  run.syncQuota();
  run.dawn();
  assert.equal(run.balance('ticket'), tickets + 5, 'five Tickets');
  const offer = run.overpayOffer();
  assert.ok(offer, 'the choice is queued, never lost');
  assert.equal(offer.rarity, 'rare', 'the Legendary pool is empty before Night 5, so the offer falls back to Rare');
  assert.equal(offer.candidates.length, 2, 'choose 1 of 2');
  assert.ok(offer.candidates.every((d) => d.rarity === 'rare'));
  run.dispose();
});

test('JACKPOT SEAL from Night 5: the choice of two is Legendary', () => {
  const run = RUN.createRun({ seed: 79, mode: 'debt' });
  run.index = 4;                                 // Night 5: crown_of_coins and understudy unlock
  const due = run.quota.due;
  claim(run, LOWER);
  run.debtPaid = 3 * due;
  run.syncQuota();
  run.dawn();
  const offer = run.overpayOffer();
  assert.equal(offer?.rarity, 'legendary');
  assert.equal(offer?.candidates.length, 2, 'choose 1 of 2 Legendary charms');
  assert.ok(offer.candidates.every((d) => d.rarity === 'legendary'));
  run.dispose();
});

test('HOUSE ENVY at Dawn with a Soul Mark lost: the Mark goes back on the card and no Obols are paid', () => {
  const run = RUN.createRun({ seed: 73, mode: 'debt' });
  const due = run.quota.due;
  claim(run, [...LOWER, 'seal']);
  run.soulMarkCount = 1;
  run.markEscrow = 0;
  const obols = run.balance('obol');
  run.debtPaid = 4 * due;
  run.syncQuota();
  run.dawn();
  assert.equal(run.soulMarkCount, 2, 'one lost Mark is restored');
  assert.equal(run.balance('obol'), obols, 'the restore is the reward: no Obols');
  run.dispose();
});

test('HOUSE ENVY at Dawn with the card full: the reward pays 3 Obols and the card is unchanged', () => {
  const run = RUN.createRun({ seed: 74, mode: 'debt' });
  const due = run.quota.due;
  claim(run, [...LOWER, 'seal']);
  const full = run.soulMarkCount;
  run.markEscrow = 0;
  const obols = run.balance('obol');
  run.debtPaid = 4 * due;
  run.syncQuota();
  run.dawn();
  assert.equal(run.balance('obol'), obols + 3, 'three Obols');
  assert.equal(run.soulMarkCount, full, 'nothing to restore');
  run.dispose();
});

test('HOUSE ENVY counts a Mark on the table as not lost: the Obols pay and the table Mark returns at Dawn as before', () => {
  const run = RUN.createRun({ seed: 75, mode: 'debt' });
  const due = run.quota.due;
  claim(run, [...LOWER, 'seal']);
  run.soulMarkCount = 2;
  run.markEscrow = 1;
  const obols = run.balance('obol');
  run.debtPaid = 4 * due;
  run.syncQuota();
  run.dawn();
  assert.equal(run.balance('obol'), obols + 3, 'the card plus the table hold every Mark: Obols pay');
  assert.equal(run.soulMarkCount, 3, 'the Mark on the table comes back at Dawn');
  run.dispose();
});

test('overshoot lock: while the bank is above the quota, WITHDRAW is refused with the lock reason and nothing moves', () => {
  const run = RUN.createRun({ seed: 76, mode: 'debt' });
  const due = run.quota.due;
  run.coins = due + 40;
  assert.ok(run.deposit(due + 40, true));
  assert.equal(run.overshootLocked(), true, 'the 40 above the quota are locked');
  assert.equal(run.bank().withdrawable, 0);
  assert.equal(run.withdraw(1), 0, 'even one coin is refused');
  assert.equal(run.lastRefusal(), 'locked');
  assert.equal(run.coins, 0, 'the pocket is still empty: the whole deposit went in');
  assert.equal(run.debtPaid, due + 40, 'the bank is unchanged');
  run.coins = 10;
  assert.ok(run.deposit(10, true), 'deposits still go in while locked');
  assert.equal(run.debtPaid, due + 50);
  run.dispose();
});

test('overshoot lock: the locked coins still earn the Settle interest (more than the same bank at the quota)', () => {
  const interestAt = (overBy) => {
    const run = RUN.createRun({ seed: 77, mode: 'debt' });
    const due = run.quota.due;
    run.coins = due + overBy;
    assert.ok(run.deposit(due + overBy, true));
    run.watchPulls = 3;
    run.settleWatch();
    const got = run.stats.interest ?? 0;
    run.dispose();
    return got;
  };
  const atQuota = interestAt(0);
  const locked = interestAt(200);
  assert.ok(atQuota > 0, 'the quota bank earns interest');
  assert.ok(locked > atQuota, 'the overpay earns on top of it: the lock costs liquidity, not interest');
});

test('Dawn returns the surplus: the overpay and the interest it earned go back to the pocket once, and the lock lifts', () => {
  const run = RUN.createRun({ seed: 78, mode: 'debt' });
  const due = run.quota.due;
  run.coins = due + 200;
  assert.ok(run.deposit(due + 200, true));
  run.watchPulls = 3;
  run.settleWatch();
  const bank = run.debtPaid;
  assert.ok(bank > due + 200, 'the Settle interest joins the bank');
  const pocket = [];
  const off = EV.bus.on('eco:wallet', (e) => { if (e.reason === 'dawn:surplus') pocket.push(e.delta); });
  const coins = run.coins;
  run.dawn();
  off();
  assert.deepEqual(pocket, [bank - due], 'the whole surplus (overpay plus interest) returns, once');
  assert.equal(run.coins, coins + bank - due);
  assert.equal(run.debtPaid, 0, 'the next quota starts from zero');
  assert.equal(run.overshootLocked(), false, 'the lock lifts with the Night');
  run.dispose();
});
