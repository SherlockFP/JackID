/**
 * THE BANK (wave 27, bank-econ; director wave 41): pure maths behind the Debt Terminal's DEPOSIT / WITHDRAW / QUOTA screens. No
 * state, no bus, no three: `run.ts` owns the state and calls these, the terminal reads the results, the tests check them.
 *
 * The model, in one paragraph. Coins in the bank count toward tonight's quota and earn interest at every Settle (the end of a
 * Watch) until Dawn. Deposits keep working after the quota is met: the surplus stays in the bank and keeps earning, and Dawn
 * returns `bank - quota` to the pocket (no early release, director decision 2). WITHDRAW takes coins back to the pocket at any
 * time before the Watch is settled, except the coins above the quota: the SEAL holds those until Dawn (`sealCoins`, decision D2),
 * and BREAK SEAL takes them out at the price of the overpay tiers. The tiers read the principal (pocket coins), not interest (D1).
 * A withdrawn coin stops counting and stops earning, and a coin that went out and came back in
 * the same Watch (`churn`) earns nothing that Watch, so the bank cannot be used as a free pocket-shuffle. Only coins that really
 * came from the pocket plus interest can be withdrawn: quota credit that never was cash (deposit bonus, phone credit, a kit's
 * pre-deposit: `granted`) stays in the bank.
 */
import { ACTIVITY_MIN_PULLS, OVERSHOOT_TIERS, interestFor } from './data/schedule';

export interface BankInput {
  /** Total held in the bank toward tonight's quota (`run.debtPaid`: deposits, interest; the surplus stays here until Dawn). */
  debtPaid: number;
  /** Quota credit that never was pocket cash (deposit bonus, phone credit, kit pre-deposit). */
  granted: number;
  /** Tonight's quota (loan-inflated). */
  due: number;
  /** Live interest rate per Settle (0.9 = 90 %). */
  rate: number;
  /** Pulls made this Watch (the activity clause needs ACTIVITY_MIN_PULLS). */
  watchPulls: number;
  /** Coins that went out and came back in this Watch: they earn nothing until the next Watch. */
  churn: number;
  /**
   * The overpay principal: the pocket coins put in this Night and not taken back out (interest and quota credit left out). The
   * overpay tiers read it (director decision D1). Optional: absent = `debtPaid`, the whole bank.
   */
  principal?: number;
}

/** Coins counted in the bank (quota credit included). What a WITHDRAW can touch is `withdrawable`. */
export function bankBalance(i: Pick<BankInput, 'debtPaid'>): number {
  return Math.max(0, Math.floor(i.debtPaid));
}

/** Coins a withdraw may take now (balance minus the quota credit that never was cash). */
export function withdrawable(i: Pick<BankInput, 'debtPaid' | 'granted'>): number {
  return Math.max(0, bankBalance(i) - Math.max(0, Math.floor(i.granted)));
}

/**
 * The coins the SEAL holds: the bank above tonight's quota that a WITHDRAW could take (0 when there is no quota). A seal is only
 * a lock on these coins: they keep earning interest, and BREAK SEAL takes them out at the price of the overpay tiers (decision D2).
 */
export function sealCoins(i: Pick<BankInput, 'debtPaid' | 'granted' | 'due'>): number {
  const due = Math.max(0, Math.floor(i.due));
  if (due <= 0) return 0;
  return Math.min(Math.max(0, bankBalance(i) - due), withdrawable(i));
}

/** Coins that went out and back in the same Watch: min(withdrawn, redeposited). */
export function churnOf(withdrawnThisWatch: number, depositedThisWatch: number): number {
  return Math.max(0, Math.min(Math.floor(withdrawnThisWatch), Math.floor(depositedThisWatch)));
}

/** The deposit interest is paid on: the total minus the churned coins. */
export function interestBase(debtPaid: number, churn: number): number {
  return Math.max(0, Math.floor(debtPaid) - Math.max(0, Math.floor(churn)));
}

/** Interest the next Settle pays on this bank (ignores the activity clause: see `pullsToQualify`). */
export function interestNext(i: BankInput): number {
  return interestFor(interestBase(i.debtPaid, i.churn), i.due, i.rate);
}

/** Pulls still to make this Watch before the Settle pays interest (0 = it will). */
export function pullsToQualify(watchPulls: number): number {
  return Math.max(0, ACTIVITY_MIN_PULLS - Math.max(0, Math.floor(watchPulls)));
}

export interface WithdrawPreview {
  /** Coins that would reach the pocket (clamped to what can be withdrawn). */
  coins: number;
  /** Bank balance after. */
  bankAfter: number;
  /** Quota still owed after (0 = met). */
  leftAfter: number;
  /** True when the quota is met now and would not be after. */
  metLost: boolean;
  /** Interest the next Settle would lose, in coins. */
  interestLost: number;
  /** The highest overpay tier now reached that the withdraw would lose (`OVERSHOOT_TIERS` id), or null. */
  tierLost: string | null;
}

/** Overpay tier reached at `paid` of `due` (highest ratio reached), or null. */
export function tierReached(paid: number, due: number): string | null {
  if (due <= 0) return null;
  let best: { id: string; ratio: number } | null = null;
  for (const t of OVERSHOOT_TIERS) if (paid / due >= t.ratio && (best === null || t.ratio > best.ratio)) best = { id: t.id, ratio: t.ratio };
  return best?.id ?? null;
}

/** What taking `amount` out of the bank would do (what the player gives up). */
export function previewWithdraw(i: BankInput, amount: number): WithdrawPreview {
  const room = withdrawable(i);
  const coins = Math.max(0, Math.min(Math.floor(Number.isFinite(amount) ? amount : 0), room));
  const bank = bankBalance(i);
  const bankAfter = bank - coins;
  const after: BankInput = { ...i, debtPaid: bankAfter };
  const lostRaw = interestNext(i) - interestNext(after);
  // the overpay tiers read the principal: a withdraw takes principal first, and only then the interest it earned
  const principal = Math.max(0, Math.floor(i.principal ?? i.debtPaid));
  const before = tierReached(principal, i.due);
  const now = tierReached(Math.max(0, principal - coins), i.due);
  const rank = (id: string | null): number => (id === null ? -1 : OVERSHOOT_TIERS.findIndex((t) => t.id === id));
  return {
    coins,
    bankAfter,
    leftAfter: Math.max(0, Math.floor(i.due) - bankAfter),
    metLost: i.due > 0 && i.debtPaid >= i.due && bankAfter < i.due,
    interestLost: coins > 0 ? Math.max(0, lostRaw) : 0,
    tierLost: coins > 0 && rank(before) > rank(now) ? before : null,
  };
}
