// Overshoot depth: the two top overpay tiers (JACKPOT SEAL at 3x, HOUSE ENVY at 4x), the seal (coins above the quota cannot
// leave until Dawn, but they still earn interest at each Settle; BREAK SEAL takes them out and forfeits the tiers), that the
// tiers read the principal (the coins put in, not interest: D1), and that Dawn returns the surplus.
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
  assert.ok(tiers.every((t) => !t.reward.charm), 'no tier picks a charm: the tiers shape the boon offer (docs/BLESSINGS.md §2.1)');
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

test('JACKPOT SEAL at Dawn on Night 1: 5 Tickets, and the boon offer shows four cards', () => {
  const run = RUN.createRun({ seed: 72, mode: 'debt' });
  const due = run.quota.due;
  claim(run, LOWER);
  const tickets = run.balance('ticket');
  run.debtPaid = 3 * due;
  run.syncQuota();
  run.dawn();
  assert.equal(run.balance('ticket'), tickets + 5, 'five Tickets');
  const offer = run.boonOffer();
  assert.ok(offer, 'the paid Dawn opens the boon offer');
  assert.equal(offer.candidates.length, 4, 'the seal tier shows four cards');
  assert.equal(offer.picks, 1);
  run.dispose();
});

test('the overpay tiers shape the offer: 1.5x shows four cards, 2x keeps two, under 1.5x shows three', () => {
  const at = (seed, ratio, claimed) => {
    const run = RUN.createRun({ seed, mode: 'debt' });
    claim(run, claimed);
    run.debtPaid = Math.ceil(ratio * run.quota.due);
    run.syncQuota();
    run.dawn();
    const o = run.boonOffer();
    run.dispose();
    return o;
  };
  assert.equal(at(90, 1, []).candidates.length, 3, 'a plain paid Dawn: three cards');
  const unc = at(91, 1.5, ['gratuity', 'favoured']);
  assert.equal(unc.candidates.length, 4);
  assert.equal(unc.picks, 1);
  const gold = at(92, 2, ['gratuity', 'favoured', 'uncommon']);
  assert.equal(gold.picks, 2, 'golden: keep two');
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

/** Puts `amount` coins into the bank from the pocket (the real deposit path, so the principal is the player's own cash). */
const fund = (run, amount) => { run.coins += amount; assert.ok(run.deposit(amount, true)); };

test('D1: the overpay tiers ignore interest: a bank that the Settle interest carries past 1.5x claims no tier at Dawn', () => {
  const run = RUN.createRun({ seed: 80, mode: 'debt' });
  const due = run.quota.due;
  fund(run, due);                              // exactly the quota put in by hand: the principal is the quota
  run.watchPulls = 3;
  run.settleWatch();                           // the interest lifts the bank well past the uncommon tier
  assert.ok(run.debtPaid >= Math.ceil(1.5 * due), 'the bank alone would read as uncommon');
  assert.equal(run.overshootView().balance, due, 'the tiers read the principal, not the bank');
  assert.equal(run.overshootView().tier, null, 'so no tier is reached');
  const tickets = run.balance('ticket');
  run.dawn();
  assert.deepEqual(run.quota.claimed, [], 'Dawn claims nothing');
  assert.equal(run.balance('ticket'), tickets, 'no Gratuity either');
  assert.equal(run.boonOffer()?.candidates.length, 3, 'and the plain three-card offer');
  run.dispose();
});

test('D1: the principal is the pocket cash put in: a 1.5x deposit earns uncommon with the interest on top', () => {
  const run = RUN.createRun({ seed: 83, mode: 'debt' });
  const due = run.quota.due;
  fund(run, Math.ceil(1.5 * due));
  run.watchPulls = 3;
  run.settleWatch();
  assert.equal(run.overshootView().balance, Math.ceil(1.5 * due), 'the principal stays the coins put in');
  assert.equal(run.overshootView().tier, 'uncommon');
  run.dawn();
  assert.ok(run.quota.claimed.some((c) => c.id === 'uncommon'), 'Dawn pays the tier on the principal');
  run.dispose();
});

test('D2: BREAK SEAL releases the coins above the quota and forfeits every overpay tier of the Night', () => {
  const run = RUN.createRun({ seed: 81, mode: 'debt' });
  const due = run.quota.due;
  fund(run, 3 * due);                          // a 3x overpay: JACKPOT SEAL would pay at Dawn
  assert.equal(run.overshootLocked(), true, 'the seal holds the coins above the quota');
  assert.equal(run.withdraw(1), 0, 'WITHDRAW is refused');
  assert.equal(run.lastRefusal(), 'locked');
  assert.equal(run.bank().sealed, true);
  assert.equal(run.bank().sealCoins, 2 * due, 'the seal holds everything above the quota');
  const tickets = run.balance('ticket');
  const pocket = run.coins;
  assert.equal(run.breakSeal(), 2 * due, 'BREAK SEAL moves the held coins to the pocket');
  assert.equal(run.coins, pocket + 2 * due, 'the pocket has them');
  assert.equal(run.overshootLocked(), false, 'the seal is broken for the Night');
  assert.equal(run.bank().sealBroken, true);
  assert.equal(run.overshootView(), null, 'no overshoot is left to chase');
  run.dawn();
  assert.deepEqual(run.quota.claimed, [], 'the Dawn pays no overpay tier: they are forfeit');
  assert.equal(run.balance('ticket'), tickets, 'no JACKPOT SEAL Tickets');
  assert.equal(run.boonOffer()?.candidates.length, 3, 'and the plain three-card offer');
  run.dispose();
});

test('D2: a Watch with an empty pocket is never a dead end: the broke help offers the seal, and BREAK SEAL funds the pocket', () => {
  const run = RUN.createRun({ seed: 82, mode: 'debt' });
  const due = run.quota.due;
  run.coins = due + 60;                        // every coin went in: the pocket is empty, the seal holds 60
  assert.ok(run.deposit(due + 60, true));
  run.phase = 'play';
  run.pullCount = 5;
  run.tickets = 0;
  assert.equal(run.coins, 0);
  const help = run.brokeHelp();
  assert.ok(help, 'an empty pocket is broke');
  assert.equal(help.steps.find((s) => s.id === 'bank')?.coins, 60, 'the bank step counts the sealed coins');
  assert.equal(run.withdraw(10), 0, 'WITHDRAW alone is refused by the seal');
  assert.equal(run.breakSeal(), 60, 'BREAK SEAL takes them out');
  assert.equal(run.coins, 60, 'the pocket can play again');
  assert.equal(run.brokeHelp(), null, 'so the broke help goes');
  run.dispose();
});

test('D2: with the seal broken the coins above the quota are free to WITHDRAW, and BREAK SEAL is refused once nothing is held', () => {
  const run = RUN.createRun({ seed: 84, mode: 'debt' });
  const due = run.quota.due;
  fund(run, due + 30);
  assert.equal(run.breakSeal(), 30);
  assert.equal(run.breakSeal(), 0, 'nothing left to break: refused');
  assert.equal(run.lastRefusal(), 'noSeal');
  fund(run, 20);                               // the broken seal does not come back for the Night
  assert.equal(run.withdraw(20), 20, 'WITHDRAW takes them back out');
  run.dispose();
});

test('D1/D2 save: the interest split and a broken seal survive a save and a resume (the forfeit cannot be undone by reloading)', () => {
  const run = RUN.createRun({ seed: 85, mode: 'debt' });
  const due = run.quota.due;
  fund(run, due + 50);
  run.watchPulls = 3;
  run.settleWatch();                           // interest on top of the principal
  const principal = run.overshootView().balance;
  assert.equal(principal, due + 50, 'the principal excludes the interest');
  assert.ok(run.breakSeal() > 0, 'the seal breaks');
  const store = { data: {}, update(fn) { fn(this.data); } };
  store.data.resume = JSON.parse(JSON.stringify(run.snapshot()));
  const back = RUN.resumeRun(store);
  assert.ok(back, 'the save resumes');
  assert.equal(back.bank().sealBroken, true, 'the broken seal is kept');
  assert.equal(back.overshootView(), null, 'so are the forfeited tiers');
  assert.equal(back.bank().balance, run.bank().balance, 'the bank is the same');
  back.dispose();
  run.dispose();
});

test('D4: the JACKPOT SEAL label says what the tier pays: 5 Tickets and a boon offer (EN and TR)', async () => {
  const PLAN = await load('src/menu/hud/plan.strings.ts');
  const en = PLAN.default.en['ov.seal'];
  const tr = PLAN.default.tr['ov.seal'];
  assert.match(en, /5 TICKETS/, 'the label names the Tickets');
  assert.match(en, /BOON/, 'the seal tier feeds the boon offer (pantheon), not a charm pick');
  assert.match(tr, /LÜTUF/, 'the Turkish label names the boon offer');
  assert.deepEqual(Object.keys(PLAN.default.en).sort(), Object.keys(PLAN.default.tr).sort(), 'EN and TR keep the same keys');
});
